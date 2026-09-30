import { evaluateGeofence, type GeofenceConfig, type GeofenceResult } from "./geo";
import { ATTENDANCE_CLOSED, ATTENDANCE_CLOSED_MESSAGE, isAttendanceClosedError } from "./attendance-closed";
import { hasErrorCode, PG } from "./pg-errors";
import { signToken, verifyToken } from "./signed-token";
import { checkInSchema, fieldErrors, locationSchema, type LocationInput } from "./validation";
import type { NewSubmission, Submission } from "@/types/submission";

/**
 * Server-side attendance logic, free of framework/database imports so it can be
 * unit-tested. Route handlers inject config, secret and persistence.
 *
 * Flow:
 *  1. verifyLocation(): validate the raw GPS fix, compute the distance to the
 *     workplace, and — only if WITHIN_RANGE — issue a short-lived signed
 *     "location verification" token. The form is shown only after this.
 *  2. checkIn(): validate employee details, verify the token's signature and
 *     expiry, then RE-COMPUTE the geofence from the coordinates inside the
 *     token against the current config. Only WITHIN_RANGE check-ins are stored.
 *
 * The client never supplies a distance or status that is trusted, and each
 * verification can be used for one check-in only (verification_id is UNIQUE).
 */

export interface AttendanceConfig {
  geofence: GeofenceConfig;
  /** Reject fixes whose accuracy radius is worse than this (meters). */
  maxAccuracy: number;
  /** Flag (but accept) fixes whose accuracy radius is worse than this (meters). */
  lowAccuracyThreshold: number;
  secret: string;
  now?: () => number;
}

export interface VerifyConfig extends AttendanceConfig {
  /**
   * Admin switch, read only for requests that would otherwise get a verification
   * (no database round-trip for malformed/stale/imprecise fixes). Default: open.
   * Check-in is enforced separately, inside the store's insert transaction.
   */
  isOpen?: () => Promise<boolean>;
}

export interface CheckInDeps extends AttendanceConfig {
  insert: (s: NewSubmission) => Promise<Submission>;
}

export interface RequestMeta {
  userAgent: string | null;
  ipHash: string | null;
}

/** A browser GPS fix may be at most this old when verified… */
export const MAX_FIX_AGE_MS = 2 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;
/** …and the verification is valid for this long to fill in the form. */
export const VERIFICATION_TTL_S = 10 * 60;

interface LocationClaims {
  typ: "attendance-location";
  jti: string;
  lat: number;
  lon: number;
  acc: number;
  ts: number; // GPS fix timestamp (epoch ms)
  iat: number; // epoch s
  exp: number; // epoch s
}

/** Domain-separated key so these tokens can never be confused with admin sessions. */
const tokenSecret = (secret: string) => `${secret}:attendance-location:v1`;

export type VerifyResult =
  | {
      ok: true;
      result: GeofenceResult;
      radiusMeters: number;
      accuracyMeters: number;
      lowAccuracy: boolean;
      verificationToken?: string;
      expiresAt?: Date;
    }
  | {
      ok: false;
      status: 400 | 403 | 422;
      code: "INVALID" | "POOR_ACCURACY" | "STALE_FIX" | typeof ATTENDANCE_CLOSED;
      error: string;
      fieldErrors?: Record<string, string>;
    };

const closedResult = () =>
  ({ ok: false, status: 403, code: ATTENDANCE_CLOSED, error: ATTENDANCE_CLOSED_MESSAGE }) as const;

export async function verifyLocation(body: unknown, cfg: VerifyConfig): Promise<VerifyResult> {
  const parsed = locationSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      code: "INVALID",
      error: "Your device reported an invalid location. Please try again.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const fix = parsed.data;
  const now = cfg.now?.() ?? Date.now();

  if (fix.positionTimestamp < now - MAX_FIX_AGE_MS || fix.positionTimestamp > now + MAX_CLOCK_SKEW_MS) {
    return {
      ok: false,
      status: 422,
      code: "STALE_FIX",
      error: "Your location reading is out of date. Please detect your location again.",
    };
  }
  if (fix.accuracy > cfg.maxAccuracy) {
    return {
      ok: false,
      status: 422,
      code: "POOR_ACCURACY",
      error: `Your location is too imprecise to verify (±${Math.round(fix.accuracy)} m; at most ±${cfg.maxAccuracy} m is needed). Turn on GPS / precise location, move near a window or outdoors, and try again.`,
    };
  }

  // The request is valid — only now consult the admin switch (a DB read in production).
  if (cfg.isOpen && !(await cfg.isOpen())) return closedResult();

  const result = evaluateGeofence({ latitude: fix.latitude, longitude: fix.longitude }, cfg.geofence);
  const base = {
    ok: true as const,
    result,
    radiusMeters: cfg.geofence.radiusMeters,
    accuracyMeters: fix.accuracy,
    lowAccuracy: fix.accuracy > cfg.lowAccuracyThreshold,
  };
  if (result.status !== "WITHIN_RANGE") return base; // no token → no form, no check-in

  const iat = Math.floor(now / 1000);
  const claims: LocationClaims = {
    typ: "attendance-location",
    jti: crypto.randomUUID(),
    lat: fix.latitude,
    lon: fix.longitude,
    acc: fix.accuracy,
    ts: fix.positionTimestamp,
    iat,
    exp: iat + VERIFICATION_TTL_S,
  };
  return {
    ...base,
    verificationToken: await signToken(claims, tokenSecret(cfg.secret)),
    expiresAt: new Date(claims.exp * 1000),
  };
}

function isLocationClaims(p: unknown): p is LocationClaims {
  const c = p as Partial<LocationClaims> | null;
  return (
    !!c &&
    c.typ === "attendance-location" &&
    typeof c.jti === "string" &&
    /^[0-9a-f-]{36}$/i.test(c.jti) &&
    typeof c.exp === "number" &&
    typeof c.iat === "number" &&
    typeof c.ts === "number" &&
    locationSchema.safeParse({ latitude: c.lat, longitude: c.lon, accuracy: c.acc, positionTimestamp: c.ts }).success
  );
}

export type CheckInResult =
  | { ok: true; submission: Submission }
  | {
      ok: false;
      status: 400 | 401 | 403 | 409 | 422;
      code: "INVALID" | "VERIFICATION_REQUIRED" | "OUTSIDE_RANGE" | "ALREADY_USED" | typeof ATTENDANCE_CLOSED;
      error: string;
      fieldErrors?: Record<string, string>;
      distanceMeters?: number;
    };

export async function checkIn(body: unknown, meta: RequestMeta, deps: CheckInDeps): Promise<CheckInResult> {
  // Open/closed is enforced by deps.insert inside its transaction (see insertSubmission),
  // so a verification issued before attendance was closed can't be used afterwards.
  const parsed = checkInSchema.safeParse(body);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.verificationToken) {
      return {
        ok: false,
        status: 401,
        code: "VERIFICATION_REQUIRED",
        error: "Please verify your location before checking in.",
      };
    }
    return { ok: false, status: 400, code: "INVALID", error: "Please correct the highlighted fields.", fieldErrors: errors };
  }
  const input = parsed.data;
  const nowS = Math.floor((deps.now?.() ?? Date.now()) / 1000);

  const claims = await verifyToken(input.verificationToken, tokenSecret(deps.secret));
  if (!isLocationClaims(claims) || claims.exp <= nowS) {
    return {
      ok: false,
      status: 401,
      code: "VERIFICATION_REQUIRED",
      error: "Your location verification has expired or is invalid. Please verify your location again.",
    };
  }

  if (claims.acc > deps.maxAccuracy) {
    return {
      ok: false,
      status: 422,
      code: "VERIFICATION_REQUIRED",
      error: "Your location is too imprecise to verify. Please verify your location again.",
    };
  }

  // Authoritative re-check: recompute from the signed coordinates against the CURRENT geofence.
  const location: LocationInput = { latitude: claims.lat, longitude: claims.lon, accuracy: claims.acc, positionTimestamp: claims.ts };
  const { distanceMeters, status } = evaluateGeofence(location, deps.geofence);
  if (status !== "WITHIN_RANGE") {
    return {
      ok: false,
      status: 403,
      code: "OUTSIDE_RANGE",
      error: `Attendance unavailable: you are outside the authorized workplace area (${distanceMeters} m away; ${deps.geofence.radiusMeters} m or less is required).`,
      distanceMeters,
    };
  }

  try {
    const submission = await deps.insert({
      name: input.name,
      designation: input.designation,
      institution: input.institution,
      email: input.email,
      mobile: input.mobile,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyM: location.accuracy,
      positionCapturedAt: new Date(location.positionTimestamp),
      distanceM: distanceMeters,
      geofenceStatus: status,
      lowAccuracy: location.accuracy > deps.lowAccuracyThreshold,
      targetLatitude: deps.geofence.target.latitude,
      targetLongitude: deps.geofence.target.longitude,
      radiusM: deps.geofence.radiusMeters,
      clientDistanceM: null,
      verificationId: claims.jti,
      verificationExpiresAt: new Date(claims.exp * 1000),
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ipHash: meta.ipHash,
    });
    return { ok: true, submission };
  } catch (err) {
    // Raised by the store when attendance is closed (checked inside the insert transaction)
    if (isAttendanceClosedError(err)) return closedResult();
    if (hasErrorCode(err, PG.UNIQUE_VIOLATION)) {
      return {
        ok: false,
        status: 409,
        code: "ALREADY_USED",
        error: "This location verification has already been used to check in. Please verify your location again.",
      };
    }
    throw err;
  }
}
