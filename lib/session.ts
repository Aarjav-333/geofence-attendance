/**
 * Stateless admin session tokens: base64url(JSON payload) + "." + HMAC-SHA256.
 * Uses Web Crypto only, so it runs in the proxy, route handlers and tests alike.
 */

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_S = 8 * 60 * 60; // 8 hours

export interface SessionPayload {
  sub: string; // admin username
  iat: number; // issued at (epoch s)
  exp: number; // expires at (epoch s)
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str: string): Uint8Array<ArrayBuffer> {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken(username: string, secret: string, nowS = Math.floor(Date.now() / 1000)) {
  const payload: SessionPayload = { sub: username, iat: nowS, exp: nowS + SESSION_TTL_S };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** Returns the payload if the signature is valid and the token is unexpired, else null. */
export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    // crypto.subtle.verify is constant-time
    const valid = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp <= nowS || typeof payload.sub !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}
