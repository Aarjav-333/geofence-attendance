import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_ROLE, findAdmin } from "./admin-accounts";
import { getAdminAccounts, getSessionSecret } from "./config";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "./session";

/**
 * Current admin session, or null. On every call the token's signature, expiry and
 * role are verified, AND the username must still be a configured admin account —
 * so removing an account from the environment revokes its sessions immediately.
 */
export async function getAdminSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token, getSessionSecret());
  if (!session) return null;
  const account = findAdmin(getAdminAccounts(), session.sub);
  return account && account.role === ADMIN_ROLE ? session : null;
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
