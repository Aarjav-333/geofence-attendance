import type { NextRequest } from "next/server";
import { checkIn } from "@/lib/attendance-service";
import { getGeofenceConfig, getLowAccuracyThreshold, getMaxAccuracy, getSessionSecret } from "@/lib/config";
import { insertSubmission } from "@/lib/db";
import { json, readJsonBody, tooManyRequests } from "@/lib/http";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientIp, hashIp } from "@/lib/request";
import type { CheckInResponse } from "@/types/submission";

// Generous: a whole office often shares one public IP (NAT / mobile carrier CGNAT).
const limiter = createRateLimiter({ limit: 200, windowMs: 10 * 60 * 1000 });

/**
 * Step 2 of attendance: validate employee details, verify the signed location
 * verification, re-compute the geofence on the server, and store the check-in.
 */
export async function POST(request: NextRequest) {
  const ipHash = hashIp(clientIp(request.headers));
  const { allowed, retryAfterS } = limiter(ipHash);
  if (!allowed) return tooManyRequests(retryAfterS);

  const parsed = await readJsonBody(request, 8 * 1024);
  if (!parsed.ok) return parsed.response;

  try {
    const r = await checkIn(
      parsed.body,
      { userAgent: request.headers.get("user-agent"), ipHash },
      {
        geofence: getGeofenceConfig(),
        maxAccuracy: getMaxAccuracy(),
        lowAccuracyThreshold: getLowAccuracyThreshold(),
        secret: getSessionSecret(),
        // Open/closed is enforced inside insertSubmission's transaction (no extra query here,
        // and no race with an admin closing attendance mid-request).
        insert: insertSubmission,
      },
    );
    if (!r.ok) {
      return json<CheckInResponse>(
        { ok: false, error: r.error, code: r.code, fieldErrors: r.fieldErrors, distanceMeters: r.distanceMeters },
        r.status,
      );
    }
    const s = r.submission;
    return json<CheckInResponse>(
      {
        ok: true,
        checkIn: {
          id: s.id,
          name: s.name,
          distanceMeters: s.distanceM,
          radiusMeters: s.radiusM,
          createdAt: new Date(s.createdAt).toISOString(),
        },
      },
      201,
    );
  } catch (err) {
    console.error("[attendance/check-in] failed to save", err);
    return json<CheckInResponse>(
      { ok: false, error: "We couldn't record your check-in right now. Please try again in a moment." },
      500,
    );
  }
}
