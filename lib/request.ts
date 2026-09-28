import "server-only";
import { createHash } from "node:crypto";
import { getSessionSecret } from "./config";

/** Best-effort client IP from standard proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/** Salted hash so we can correlate abuse without storing raw IP addresses. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${getSessionSecret()}:${ip}`).digest("hex").slice(0, 32);
}
