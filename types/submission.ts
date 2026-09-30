import type { GeofenceStatus } from "@/lib/geo";

/**
 * One attendance record (table `submissions`).
 * Check-ins fill name/designation/institution/email/mobile. Records created by the
 * earlier registration form have department/memberId instead (legacy, kept as-is).
 */
export interface Submission {
  id: string;
  name: string;
  designation: string | null;
  institution: string | null;
  email: string | null;
  mobile: string | null;
  department: string | null;
  memberId: string | null;
  latitude: number;
  longitude: number;
  accuracyM: number;
  positionCapturedAt: Date | null;
  distanceM: number;
  geofenceStatus: GeofenceStatus;
  lowAccuracy: boolean;
  targetLatitude: number;
  targetLongitude: number;
  radiusM: number;
  clientDistanceM: number | null;
  verificationId: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export type NewSubmission = Omit<Submission, "id" | "createdAt" | "department" | "memberId"> & {
  ipHash: string | null;
  /** When the location verification expires; kept in used_verifications until then (replay guard). */
  verificationExpiresAt: Date | null;
};

export interface SubmissionFilters {
  q?: string;
  institution?: string;
  status?: GeofenceStatus;
  sort?: "newest" | "oldest";
  page?: number;
  pageSize?: number;
}

export interface SubmissionStats {
  total: number;
  within: number;
  outside: number;
  today: number;
}

/** Response of POST /api/attendance/verify */
export type VerifyResponse =
  | {
      ok: true;
      status: GeofenceStatus;
      distanceMeters: number;
      radiusMeters: number;
      accuracyMeters: number;
      lowAccuracy: boolean;
      /** Present only when status is WITHIN_RANGE. Required to check in. */
      verificationToken?: string;
      expiresAt?: string;
    }
  | {
      ok: false;
      error: string;
      code?: "POOR_ACCURACY" | "STALE_FIX" | "INVALID" | "ATTENDANCE_CLOSED";
      fieldErrors?: Record<string, string>;
    };

/** Response of POST /api/attendance/check-in */
export type CheckInResponse =
  | {
      ok: true;
      checkIn: { id: string; name: string; distanceMeters: number; radiusMeters: number; createdAt: string };
    }
  | {
      ok: false;
      error: string;
      code?: "VERIFICATION_REQUIRED" | "OUTSIDE_RANGE" | "ALREADY_USED" | "INVALID" | "ATTENDANCE_CLOSED";
      fieldErrors?: Record<string, string>;
      distanceMeters?: number;
    };
