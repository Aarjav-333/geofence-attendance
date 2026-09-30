/**
 * Integration tests against a real PostgreSQL database.
 *
 * Opt-in: set TEST_DATABASE_URL (e.g. in .env.local) to a DISPOSABLE local database
 * whose name ends in "_test", then run `npm run test:db`:
 *
 *   TEST_DATABASE_URL=postgres://geofence:geofence@localhost:5433/geofence_test
 *
 * The database is created if missing and its schema is DROPPED and rebuilt from
 * database/schema.sql — which is why only local hosts and *_test names are accepted.
 * Without TEST_DATABASE_URL these tests are skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isLocalDatabase } from "@/lib/db-options";
import type { NewSubmission } from "@/types/submission";

// Next.js deliberately ignores .env.local when NODE_ENV=test, so read this one value directly.
const envLocal = join(process.cwd(), ".env.local");
const TEST_URL =
  process.env.TEST_DATABASE_URL ||
  (existsSync(envLocal) ? (parseEnv(readFileSync(envLocal, "utf8")) as Record<string, string>).TEST_DATABASE_URL : undefined);

/** Database name as PostgreSQL sees it (URL paths are percent-encoded). */
const databaseName = (url: string) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));

/** Only a local host (same rule the app uses for "local") and a *_test database name. */
function assertDisposable(url: string) {
  const dbName = databaseName(url);
  if (!isLocalDatabase(url) || !dbName.endsWith("_test")) {
    throw new Error(`Refusing to run destructive DB tests against ${new URL(url).hostname}/${dbName} (need a local *_test database)`);
  }
  return dbName;
}

/** Same server and credentials, but the "postgres" maintenance database. */
function maintenanceUrl(url: string) {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

describe.skipIf(!TEST_URL)("database (integration)", () => {
  let admin: postgres.Sql;
  let dbmod: typeof import("@/lib/db");

  beforeAll(async () => {
    const url = TEST_URL!;
    const dbName = assertDisposable(url);

    // Create the test database if needed (connect to the server's maintenance DB)
    const server = postgres(maintenanceUrl(url), { max: 1, onnotice: () => {} });
    const [{ exists }] = await server`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS exists`;
    if (!exists) await server`CREATE DATABASE ${server(dbName)}`; // identifier safely quoted
    await server.end();

    // Fresh schema from the real migration file
    admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await admin.unsafe(readFileSync(join(process.cwd(), "database", "schema.sql"), "utf8"));

    // Point the app's DB layer at the test database, then load it
    process.env.DATABASE_URL = url;
    dbmod = await import("@/lib/db");
  });

  afterAll(async () => {
    await admin?.end();
    await (globalThis as { sql?: postgres.Sql }).sql?.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE submissions, used_verifications, admin_audit_log`;
  });

  let n = 0;
  function checkIn(overrides: Partial<NewSubmission> = {}): NewSubmission {
    n++;
    return {
      name: "Test Person",
      designation: "Lecturer",
      institution: "CET",
      email: `person${n}@example.com`,
      mobile: "+919876543210",
      latitude: 8.5458,
      longitude: 76.9063,
      accuracyM: 8,
      positionCapturedAt: new Date(),
      distanceM: 12.5,
      geofenceStatus: "WITHIN_RANGE",
      lowAccuracy: false,
      targetLatitude: 8.5458387,
      targetLongitude: 76.9062601,
      radiusM: 100,
      clientDistanceM: null,
      verificationId: crypto.randomUUID(),
      verificationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      userAgent: "vitest",
      ipHash: "test",
      ...overrides,
    };
  }

  const count = async (table: string) => (await admin.unsafe(`SELECT count(*)::int AS c FROM ${table}`))[0].c as number;

  it("stores a check-in and claims its verification", async () => {
    const row = await dbmod.insertSubmission(checkIn({ name: "Anita Menon" }));
    expect(row).toMatchObject({ name: "Anita Menon", geofenceStatus: "WITHIN_RANGE", distanceM: 12.5 });
    expect(await count("submissions")).toBe(1);
    expect(await count("used_verifications")).toBe(1);
  });

  it("rejects a second check-in with the same verification (23505)", async () => {
    const first = checkIn();
    await dbmod.insertSubmission(first);
    await expect(dbmod.insertSubmission({ ...checkIn(), verificationId: first.verificationId })).rejects.toMatchObject({
      code: "23505",
    });
    expect(await count("submissions")).toBe(1); // the failed insert left nothing behind
  });

  it("clearAllSubmissions deletes every record, returns the exact count and writes an audit entry", async () => {
    for (let i = 0; i < 3; i++) await dbmod.insertSubmission(checkIn());
    const deleted = await dbmod.clearAllSubmissions("master");
    expect(deleted).toBe(3);
    expect(await count("submissions")).toBe(0);

    const last = await dbmod.getLastClearAll();
    expect(last).toMatchObject({ actor: "master", details: { deleted: 3 } });
    expect(last!.at).toBeInstanceOf(Date);
    expect(await dbmod.getStats()).toMatchObject({ total: 0, within: 0, outside: 0 });
  });

  it("a used verification stays used after Clear All Data (replay guard survives)", async () => {
    const used = checkIn();
    await dbmod.insertSubmission(used);
    await dbmod.clearAllSubmissions("admin");
    await expect(dbmod.insertSubmission({ ...checkIn(), verificationId: used.verificationId })).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("is all-or-nothing: if the audit entry fails, nothing is deleted", async () => {
    await dbmod.insertSubmission(checkIn());
    await dbmod.insertSubmission(checkIn());
    // actor must be 1–64 chars (CHECK constraint) → the audit insert fails
    await expect(dbmod.clearAllSubmissions("x".repeat(65))).rejects.toBeTruthy();
    expect(await count("submissions")).toBe(2);
    expect(await count("admin_audit_log")).toBe(0);
  });

  it("Clear All Data doesn't wait on (or block) concurrent readers — no table-exclusive lock", async () => {
    await dbmod.insertSubmission(checkIn());
    await dbmod.insertSubmission(checkIn());
    // A reader with an open transaction (e.g. a slow dashboard/export query) holds an
    // ACCESS SHARE lock. TRUNCATE / LOCK TABLE would queue behind it (and then block every
    // check-in); a row-level DELETE must not.
    await admin.begin(async (tx) => {
      const [{ c }] = await tx`SELECT count(*)::int AS c FROM submissions`;
      expect(c).toBe(2);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deleted = await Promise.race([
        dbmod.clearAllSubmissions("master"),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("clear blocked by a reader")), 3000);
        }),
      ]).finally(() => clearTimeout(timer));
      expect(deleted).toBe(2); // resolved before the 3 s deadline → it did not wait on the reader
      // …and a check-in right after still goes through while the reader is open
      await dbmod.insertSubmission(checkIn());
    });
    expect(await count("submissions")).toBe(1);
  });

  it("attendance is open by default, and closing/reopening is persisted and audited", async () => {
    await admin`DELETE FROM app_settings`;
    expect(await dbmod.getAttendanceStatus()).toEqual({ open: true, updatedAt: null, updatedBy: null });

    await dbmod.setAttendanceOpen(false, "master");
    expect(await dbmod.getAttendanceStatus()).toMatchObject({ open: false, updatedBy: "master" });

    await dbmod.setAttendanceOpen(true, "admin");
    expect(await dbmod.getAttendanceStatus()).toMatchObject({ open: true, updatedBy: "admin" });

    const log = await admin`SELECT actor, action FROM admin_audit_log ORDER BY id`;
    expect(log.map((r) => `${r.actor}:${r.action}`)).toEqual(["master:attendance_closed", "admin:attendance_opened"]);
  });

  const resetSetting = () =>
    admin`INSERT INTO app_settings (key, value, updated_by) VALUES ('attendance_open', 'true'::jsonb, 'system')
          ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, updated_by = 'system'`;

  it("the attendance switch is all-or-nothing with its audit entry", async () => {
    await resetSetting();
    // Make only the SECOND statement (the audit insert) fail, so a missing transaction would show
    await admin`ALTER TABLE admin_audit_log ADD CONSTRAINT test_block_close CHECK (action <> 'attendance_closed')`;
    try {
      await expect(dbmod.setAttendanceOpen(false, "master")).rejects.toBeTruthy();
    } finally {
      await admin`ALTER TABLE admin_audit_log DROP CONSTRAINT test_block_close`;
    }
    expect((await dbmod.getAttendanceStatus()).open).toBe(true); // setting write was rolled back too
  });

  it("the migration's default row counts as open and 'never changed'", async () => {
    await resetSetting();
    expect(await dbmod.getAttendanceStatus()).toEqual({ open: true, updatedAt: null, updatedBy: null });
  });

  it("reads the setting strictly: a non-boolean value is treated as closed", async () => {
    await admin`UPDATE app_settings SET value = '"false"'::jsonb, updated_by = 'manual' WHERE key = 'attendance_open'`;
    expect((await dbmod.getAttendanceStatus()).open).toBe(false);
    await resetSetting();
  });

  it("while closed, insertSubmission refuses check-ins and doesn't consume the verification", async () => {
    await dbmod.setAttendanceOpen(false, "master");
    const c = checkIn();
    await expect(dbmod.insertSubmission(c)).rejects.toMatchObject({ code: "ATTENDANCE_CLOSED" });
    expect(await count("submissions")).toBe(0);
    expect(await count("used_verifications")).toBe(0);
    await resetSetting();
  });

  it("no race: a check-in in flight when attendance is closed is refused, not stored", async () => {
    await resetSetting();
    let insertSettled = false;
    let pendingInsert!: Promise<unknown>;
    await admin.begin(async (tx) => {
      // The admin's close is in progress (row updated, not yet committed)…
      await tx`UPDATE app_settings SET value = 'false'::jsonb, updated_by = 'master' WHERE key = 'attendance_open'`;
      // …when a check-in arrives: it must wait for the decision instead of reading the old value.
      pendingInsert = dbmod.insertSubmission(checkIn()).finally(() => (insertSettled = true));
      await new Promise((r) => setTimeout(r, 500));
      expect(insertSettled).toBe(false); // blocked on the setting row
    }); // commit the close
    await expect(pendingInsert).rejects.toMatchObject({ code: "ATTENDANCE_CLOSED" });
    expect(await count("submissions")).toBe(0);
    await resetSetting();
  });

  it("getLastClearAll returns null when nothing has been cleared", async () => {
    expect(await dbmod.getLastClearAll()).toBeNull();
  });
});
