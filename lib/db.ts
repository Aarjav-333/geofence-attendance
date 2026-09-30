import "server-only";
import postgres from "postgres";
import { getDatabaseUrl, getDisplayTimezone } from "./config";
import { connectionOptions } from "./db-options";
import type { NewSubmission, Submission, SubmissionFilters, SubmissionStats } from "@/types/submission";

/**
 * Postgres access layer. All queries use tagged-template parameters
 * (never string concatenation), so user input cannot inject SQL.
 */

const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!globalForDb.sql) {
    const url = getDatabaseUrl();
    globalForDb.sql = postgres(url, {
      ...connectionOptions(url),
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      transform: postgres.camel, // snake_case columns → camelCase fields
    });
  }
  return globalForDb.sql;
}

const MAX_PAGE_SIZE = 200;

const COLUMNS = (sql: postgres.Sql | postgres.TransactionSql) => sql`
  id, name, designation, institution, email, mobile, department, member_id,
  latitude, longitude, accuracy_m, position_captured_at, distance_m, geofence_status, low_accuracy,
  target_latitude, target_longitude, radius_m, client_distance_m, verification_id, user_agent, created_at`;

/**
 * Store a check-in. The verification is first claimed in `used_verifications`
 * (same transaction), so a verification can never be used twice — even after
 * "Clear All Data" empties `submissions`. A second claim raises 23505.
 */
export async function insertSubmission(s: NewSubmission): Promise<Submission> {
  return db().begin(async (sql) => {
    if (s.verificationId) {
      await sql`DELETE FROM used_verifications WHERE expires_at < now() - interval '1 hour'`;
      await sql`
        INSERT INTO used_verifications (verification_id, expires_at)
        VALUES (${s.verificationId}, ${s.verificationExpiresAt ?? new Date(Date.now() + 10 * 60 * 1000)})`;
    }
    return insertSubmissionRow(sql, s);
  }) as Promise<Submission>;
}

async function insertSubmissionRow(sql: postgres.TransactionSql, s: NewSubmission): Promise<Submission> {
  const [row] = await sql<Submission[]>`
    INSERT INTO submissions (
      name, designation, institution, email, mobile,
      latitude, longitude, accuracy_m, position_captured_at,
      distance_m, geofence_status, low_accuracy, target_latitude, target_longitude, radius_m,
      client_distance_m, verification_id, user_agent, ip_hash
    ) VALUES (
      ${s.name}, ${s.designation}, ${s.institution}, ${s.email}, ${s.mobile},
      ${s.latitude}, ${s.longitude}, ${s.accuracyM}, ${s.positionCapturedAt},
      ${s.distanceM}, ${s.geofenceStatus}, ${s.lowAccuracy},
      ${s.targetLatitude}, ${s.targetLongitude}, ${s.radiusM},
      ${s.clientDistanceM}, ${s.verificationId}, ${s.userAgent}, ${s.ipHash}
    )
    RETURNING ${COLUMNS(sql)}`;
  return row;
}

function whereClause(sql: postgres.Sql, f: SubmissionFilters) {
  const conditions = [];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    conditions.push(sql`(
      name ILIKE ${like} OR designation ILIKE ${like} OR institution ILIKE ${like}
      OR email ILIKE ${like} OR mobile ILIKE ${like}
      OR member_id ILIKE ${like} OR department ILIKE ${like}
    )`);
  }
  if (f.institution) conditions.push(sql`institution = ${f.institution}`);
  if (f.status) conditions.push(sql`geofence_status = ${f.status}`);
  if (conditions.length === 0) return sql``;
  return sql`WHERE ${conditions.reduce((acc, c) => sql`${acc} AND ${c}`)}`;
}

export async function listSubmissions(
  f: SubmissionFilters,
): Promise<{ rows: Submission[]; total: number; page: number; pageSize: number }> {
  const sql = db();
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), MAX_PAGE_SIZE);
  const page = Math.max(f.page ?? 1, 1);
  const where = whereClause(sql, f);
  const order = f.sort === "oldest" ? sql`created_at ASC` : sql`created_at DESC`;

  const [rows, [{ count }]] = await Promise.all([
    sql<Submission[]>`
      SELECT ${COLUMNS(sql)}
      FROM submissions ${where}
      ORDER BY ${order}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    sql<{ count: number }[]>`SELECT count(*)::int AS count FROM submissions ${where}`,
  ]);
  return { rows, total: count, page, pageSize };
}

/** All matching rows (for CSV export), capped to keep memory bounded. */
export async function exportSubmissions(f: SubmissionFilters, limit = 50_000): Promise<Submission[]> {
  const sql = db();
  const order = f.sort === "oldest" ? sql`created_at ASC` : sql`created_at DESC`;
  return sql<Submission[]>`
    SELECT ${COLUMNS(sql)}
    FROM submissions ${whereClause(sql, f)}
    ORDER BY ${order}
    LIMIT ${limit}`;
}

export async function getStats(tz = getDisplayTimezone()): Promise<SubmissionStats> {
  const [row] = await db()<SubmissionStats[]>`
    SELECT count(*)::int                                                    AS total,
           count(*) FILTER (WHERE geofence_status = 'WITHIN_RANGE')::int    AS within,
           count(*) FILTER (WHERE geofence_status = 'OUTSIDE_RANGE')::int   AS outside,
           count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})::int AS today
    FROM submissions`;
  return row;
}

/**
 * Permanently delete every attendance record (the `submissions` table only) and
 * write a permanent audit entry — in one transaction: either both happen or neither.
 *
 * A plain DELETE (not TRUNCATE) on purpose: it takes only row-level locks, so check-ins
 * and dashboard reads keep working while it runs; it is MVCC-safe for concurrent
 * readers; it needs no TRUNCATE privilege; and its row count is exact. Dead rows are
 * reclaimed by autovacuum. Schema, used_verifications (replay guard), admin accounts
 * and settings are untouched.
 */
export async function clearAllSubmissions(actor: string): Promise<number> {
  return db().begin(async (sql) => {
    // Fail after 10 s instead of hanging if another session holds row locks (e.g. a stuck
    // transaction). Plain check-in INSERTs never lock existing rows, so they don't trigger this.
    await sql`SET LOCAL lock_timeout = '10s'`;
    const { count } = await sql`DELETE FROM submissions`;
    await sql`
      INSERT INTO admin_audit_log (actor, action, details)
      VALUES (${actor}, 'clear_all_attendance', ${sql.json({ deleted: count })})`;
    return count;
  }) as Promise<number>;
}

export interface AuditEntry {
  at: Date;
  actor: string;
  details: { deleted?: number };
}

/** The most recent "Clear All Data", for display on the dashboard. */
export async function getLastClearAll(): Promise<AuditEntry | null> {
  const [row] = await db()<AuditEntry[]>`
    SELECT at, actor, details FROM admin_audit_log
    WHERE action = 'clear_all_attendance'
    ORDER BY at DESC LIMIT 1`;
  return row ?? null;
}

export async function listInstitutions(): Promise<string[]> {
  const rows = await db()<{ institution: string }[]>`
    SELECT DISTINCT institution FROM submissions WHERE institution IS NOT NULL ORDER BY institution`;
  return rows.map((r) => r.institution);
}

export interface AttendanceStatus {
  open: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * Whether check-ins are currently accepted (admin-controlled). Defaults to open when
 * the setting has never been changed — or when the app_settings table doesn't exist
 * yet (migration not applied), so an un-migrated database keeps working as before.
 */
export async function getAttendanceStatus(): Promise<AttendanceStatus> {
  try {
    const [row] = await db()<{ value: unknown; updatedAt: Date; updatedBy: string }[]>`
      SELECT value, updated_at, updated_by FROM app_settings WHERE key = 'attendance_open'`;
    if (!row) return { open: true, updatedAt: null, updatedBy: null };
    return { open: row.value !== false, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return { open: true, updatedAt: null, updatedBy: null };
    throw err;
  }
}

/** Open or close attendance, with an audit log entry — in one transaction. */
export async function setAttendanceOpen(open: boolean, actor: string): Promise<void> {
  await db().begin(async (sql) => {
    await sql`
      INSERT INTO app_settings (key, value, updated_at, updated_by)
      VALUES ('attendance_open', ${sql.json(open)}, now(), ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
    await sql`
      INSERT INTO admin_audit_log (actor, action, details)
      VALUES (${actor}, ${open ? "attendance_opened" : "attendance_closed"}, ${sql.json({ open })})`;
  });
}
