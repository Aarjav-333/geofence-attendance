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

const COLUMNS = (sql: postgres.Sql) => sql`
  id, name, designation, institution, email, mobile, department, member_id,
  latitude, longitude, accuracy_m, position_captured_at, distance_m, geofence_status, low_accuracy,
  target_latitude, target_longitude, radius_m, client_distance_m, verification_id, user_agent, created_at`;

export async function insertSubmission(s: NewSubmission): Promise<Submission> {
  const sql = db();
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

export async function listInstitutions(): Promise<string[]> {
  const rows = await db()<{ institution: string }[]>`
    SELECT DISTINCT institution FROM submissions WHERE institution IS NOT NULL ORDER BY institution`;
  return rows.map((r) => r.institution);
}
