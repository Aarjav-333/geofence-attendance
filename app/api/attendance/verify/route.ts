import type { NextRequest } from "next/server";
import { verifyLocation } from "@/lib/attendance-service";
import { getGeofenceConfig, getLowAccuracyThreshold, getMaxAccuracy, getSessionSecret } from "@/lib/config";
import { getAttendanceStatus } from "@/lib/db";
import { json, readJsonBody, tooManyRequests } from "@/lib/http";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientIp, hashIp } from "@/lib/request";
import type { VerifyResponse } from "@/types/submission";

// Generous: a whole office often shares one public IP (NAT / mobile carrier CGNAT).
const limiter = createRateLimiter({ limit: 300, windowMs: 10 * 60 * 1000 });

/**
 * Step 1 of attendance: server-side geofence check of a raw GPS fix.
 * Returns the distance/status, plus a short-lived verification token ONLY when
 * the fix is within the authorized radius. Nothing is stored.
 */
export async function POST(request: NextRequest) {
  const { allowed, retryAfterS } = limiter(hashIp(clientIp(request.headers)));
  if (!allowed) return tooManyRequests(retryAfterS);

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  try {
    const r = await verifyLocation(parsed.body, {
      geofence: getGeofenceConfig(),
      maxAccuracy: getMaxAccuracy(),
      lowAccuracyThreshold: getLowAccuracyThreshold(),
      secret: getSessionSecret(),
      attendanceOpen: (await getAttendanceStatus()).open,
    });
    if (!r.ok) {
      return json<VerifyResponse>({ ok: false, error: r.error, code: r.code, fieldErrors: r.fieldErrors }, r.status);
    }
    return json<VerifyResponse>(
      {
        ok: true,
        status: r.result.status,
        distanceMeters: r.result.distanceMeters,
        radiusMeters: r.radiusMeters,
        accuracyMeters: r.accuracyMeters,
        lowAccuracy: r.lowAccuracy,
        verificationToken: r.verificationToken,
        expiresAt: r.expiresAt?.toISOString(),
      },
      200,
    );
  } catch (err) {
    console.error("[attendance/verify] failed", err);
    return json<VerifyResponse>({ ok: false, error: "We couldn't verify your location right now. Please try again." }, 500);
  }
}
