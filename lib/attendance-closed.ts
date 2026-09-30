import { hasErrorCode } from "./pg-errors";

/** Shared by the store (lib/db.ts), the service and the API: one code, one message. */
export const ATTENDANCE_CLOSED = "ATTENDANCE_CLOSED" as const;

export const ATTENDANCE_CLOSED_MESSAGE = "Attendance is currently closed. Please check with your administrator.";

export function isAttendanceClosedError(err: unknown): boolean {
  return hasErrorCode(err, ATTENDANCE_CLOSED);
}

export function attendanceClosedError(): Error & { code: typeof ATTENDANCE_CLOSED } {
  return Object.assign(new Error("Attendance is closed"), { code: ATTENDANCE_CLOSED });
}
