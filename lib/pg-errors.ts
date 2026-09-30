/** Error codes used across the app (PostgreSQL SQLSTATEs + our own). */
export const PG = {
  UNDEFINED_TABLE: "42P01", // schema migration not applied
  UNIQUE_VIOLATION: "23505",
  LOCK_NOT_AVAILABLE: "55P03", // lock_timeout expired
} as const;

/** The `code` of an error thrown by postgres.js (or by us), if any. */
export function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export function hasErrorCode(err: unknown, code: string): boolean {
  return errorCode(err) === code;
}
