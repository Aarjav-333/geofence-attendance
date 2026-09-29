/**
 * Stateless admin session tokens (see signed-token.ts for the format).
 */
import { signToken, verifyToken } from "./signed-token";

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_S = 8 * 60 * 60; // 8 hours

export interface SessionPayload {
  sub: string; // admin username
  iat: number; // issued at (epoch s)
  exp: number; // expires at (epoch s)
}

export async function createSessionToken(username: string, secret: string, nowS = Math.floor(Date.now() / 1000)) {
  const payload: SessionPayload = { sub: username, iat: nowS, exp: nowS + SESSION_TTL_S };
  return signToken(payload, secret);
}

/** Returns the payload if the signature is valid and the token is unexpired, else null. */
export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  const payload = (await verifyToken(token, secret)) as Partial<SessionPayload> | null;
  if (!payload || typeof payload.exp !== "number" || payload.exp <= nowS || typeof payload.sub !== "string") {
    return null;
  }
  return payload as SessionPayload;
}
