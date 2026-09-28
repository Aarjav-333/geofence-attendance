import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionSecret } from "./config";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "./session";

/** Current admin session, or null. Verified against the signing secret on every call. */
export async function getAdminSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, getSessionSecret());
}

/**
 * Guard for admin pages/actions/route handlers. The proxy also redirects
 * unauthenticated requests, but every protected entry point re-checks here
 * (defense in depth — never rely on the proxy alone).
 */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}
