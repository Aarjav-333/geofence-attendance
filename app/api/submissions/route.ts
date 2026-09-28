import { NextResponse, type NextRequest } from "next/server";
import { getGeofenceConfig, getLowAccuracyThreshold } from "@/lib/config";
import { insertSubmission } from "@/lib/db";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientIp, hashIp } from "@/lib/request";
import { processSubmission } from "@/lib/submission-service";
import type { SubmitResponse } from "@/types/submission";

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
const MAX_BODY_BYTES = 4 * 1024;

function json(body: SubmitResponse, status: number, headers?: HeadersInit) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json({ ok: false, error: "Expected a JSON request body." }, 415);
  }

  const ipHash = hashIp(clientIp(request.headers));
  const { allowed, retryAfterS } = limiter(ipHash);
  if (!allowed) {
    return json(
      { ok: false, error: `Too many submissions from this device. Please try again in ${Math.ceil(retryAfterS / 60)} minute(s).` },
      429,
      { "Retry-After": String(retryAfterS) },
    );
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "Request body is too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "Request body is not valid JSON." }, 400);
  }

  try {
    const result = await processSubmission(
      body,
      { userAgent: request.headers.get("user-agent"), ipHash },
      { geofence: getGeofenceConfig(), lowAccuracyThreshold: getLowAccuracyThreshold(), insert: insertSubmission },
    );

    if (!result.ok) return json({ ok: false, error: result.error, fieldErrors: result.fieldErrors }, result.status);

    const s = result.submission;
    return json(
      {
        ok: true,
        submission: {
          id: s.id,
          distanceMeters: s.distanceM,
          status: s.geofenceStatus,
          lowAccuracy: s.lowAccuracy,
          radiusMeters: s.radiusM,
          createdAt: new Date(s.createdAt).toISOString(),
        },
      },
      201,
    );
  } catch (err) {
    console.error("[submissions] failed to save submission", err);
    return json({ ok: false, error: "We couldn't save your submission right now. Please try again in a moment." }, 500);
  }
}
