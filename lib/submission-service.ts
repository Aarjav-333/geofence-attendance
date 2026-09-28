import { evaluateGeofence, type GeofenceConfig } from "./geo";
import { fieldErrors, submissionSchema } from "./validation";
import type { NewSubmission, Submission } from "@/types/submission";

/**
 * Core server-side submission logic, free of framework/database imports so it
 * can be unit-tested. The route handler injects config and persistence.
 */

export interface SubmissionDeps {
  geofence: GeofenceConfig;
  lowAccuracyThreshold: number;
  insert: (s: NewSubmission) => Promise<Submission>;
  now?: () => number;
}

export interface RequestMeta {
  userAgent: string | null;
  ipHash: string | null;
}

export type ProcessResult =
  | { ok: true; submission: Submission }
  | { ok: false; status: 400; error: string; fieldErrors: Record<string, string> };

/** GPS fixes older than this (or from the future) are rejected as stale/forged. */
const MAX_FIX_AGE_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

export async function processSubmission(
  body: unknown,
  meta: RequestMeta,
  deps: SubmissionDeps,
): Promise<ProcessResult> {
  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Please correct the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }
  const input = parsed.data;
  const now = deps.now?.() ?? Date.now();

  if (input.positionTimestamp !== undefined) {
    if (input.positionTimestamp < now - MAX_FIX_AGE_MS || input.positionTimestamp > now + MAX_CLOCK_SKEW_MS) {
      return {
        ok: false,
        status: 400,
        error: "Your location reading has expired. Please tap “Get my location” again.",
        fieldErrors: { location: "Location reading expired." },
      };
    }
  }

  // Authoritative geofence decision — computed here from the raw coordinates.
  // Any status/distance the client might send is ignored (not part of the schema).
  const { distanceMeters, status } = evaluateGeofence(
    { latitude: input.latitude, longitude: input.longitude },
    deps.geofence,
  );

  const submission = await deps.insert({
    name: input.name,
    department: input.department,
    memberId: input.memberId,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyM: input.accuracy,
    positionCapturedAt: input.positionTimestamp ? new Date(input.positionTimestamp) : null,
    distanceM: distanceMeters,
    geofenceStatus: status,
    lowAccuracy: input.accuracy > deps.lowAccuracyThreshold,
    targetLatitude: deps.geofence.target.latitude,
    targetLongitude: deps.geofence.target.longitude,
    radiusM: deps.geofence.radiusMeters,
    clientDistanceM: input.clientDistanceMeters ?? null,
    userAgent: meta.userAgent?.slice(0, 500) ?? null,
    ipHash: meta.ipHash,
  });

  return { ok: true, submission };
}
