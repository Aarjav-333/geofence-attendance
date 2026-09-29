import "server-only";
import { NextResponse, type NextRequest } from "next/server";

export function json<T>(body: T, status: number, headers?: HeadersInit) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Parse a small JSON request body; returns an error response instead of throwing. */
export async function readJsonBody(
  request: NextRequest,
  maxBytes = 4 * 1024,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return { ok: false, response: json({ ok: false, error: "Expected a JSON request body." }, 415) };
  }
  try {
    const raw = await request.text();
    if (raw.length > maxBytes) return { ok: false, response: json({ ok: false, error: "Request body is too large." }, 413) };
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, response: json({ ok: false, error: "Request body is not valid JSON." }, 400) };
  }
}

export function tooManyRequests(retryAfterS: number) {
  return json(
    { ok: false, error: `Too many attempts from this network. Please try again in ${Math.ceil(retryAfterS / 60)} minute(s).` },
    429,
    { "Retry-After": String(retryAfterS) },
  );
}
