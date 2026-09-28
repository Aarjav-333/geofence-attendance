import type { GeofenceStatus } from "@/lib/geo";

export interface Submission {
  id: string;
  name: string;
  department: string;
  memberId: string;
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
  userAgent: string | null;
  createdAt: Date;
}

export type NewSubmission = Omit<Submission, "id" | "createdAt" | "userAgent"> & {
  userAgent: string | null;
  ipHash: string | null;
};

export interface SubmissionFilters {
  q?: string;
  department?: string;
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

/** Response of POST /api/submissions */
export type SubmitResponse =
  | {
      ok: true;
      submission: {
        id: string;
        distanceMeters: number;
        status: GeofenceStatus;
        lowAccuracy: boolean;
        radiusMeters: number;
        createdAt: string;
      };
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
