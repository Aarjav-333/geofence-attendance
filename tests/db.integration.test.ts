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
import type { NewSubmission } from "@/types/submission";

// Next.js deliberately ignores .env.local when NODE_ENV=test, so read this one value directly.
const envLocal = join(process.cwd(), ".env.local");
const TEST_URL =
  process.env.TEST_DATABASE_URL ||
  (existsSync(envLocal) ? (parseEnv(readFileSync(envLocal, "utf8")) as Record<string, string>).TEST_DATABASE_URL : undefined);

function assertDisposable(url: string) {
  const u = new URL(url);
  const dbName = u.pathname.replace(/^\//, "");
  if (!["localhost", "127.0.0.1", "::1", "[::1]", "db"].includes(u.hostname) || !dbName.endsWith("_test")) {
    throw new Error(`Refusing to run destructive DB tests against ${u.hostname}/${dbName} (need a local *_test database)`);
  }
  return dbName;
}

describe.skipIf(!TEST_URL)("database (integration)", () => {
  let admin: postgres.Sql;
  let dbmod: typeof import("@/lib/db");

  beforeAll(async () => {
    const url = TEST_URL!;
    const dbName = assertDisposable(url);

    // Create the test database if needed (connect to the server's maintenance DB)
    const server = postgres(url.replace(/\/[^/?]+(\?|$)/, "/postgres$1"), { max: 1, onnotice: () => {} });
    const [{ exists }] = await server`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS exists`;
    if (!exists) await server.unsafe(`CREATE DATABASE "${dbName}"`);
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
      const started = Date.now();
      const deleted = await Promise.race([
        dbmod.clearAllSubmissions("master"),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("clear blocked by a reader")), 3000)),
      ]);
      expect(deleted).toBe(2);
      expect(Date.now() - started).toBeLessThan(3000);
      // …and a check-in right after still goes through while the reader is open
      await dbmod.insertSubmission(checkIn());
    });
    expect(await count("submissions")).toBe(1);
  });

  it("getLastClearAll returns null when nothing has been cleared", async () => {
    expect(await dbmod.getLastClearAll()).toBeNull();
  });
});
