import { timingSafeEqual } from "node:crypto";
import { verifyPassword } from "./password";

/**
 * Administrator accounts, configured through environment variables (never in the repo):
 *
 *   ADMIN_USERNAME / ADMIN_PASSWORD_HASH   the primary admin (unchanged)
 *   ADDITIONAL_ADMINS                      more admins: "username=<scrypt hash>", separated by ";"
 *                                          e.g. ADDITIONAL_ADMINS=master=scrypt:16384:8:1:…:…
 *
 * Every account has the same role, "admin", and therefore exactly the same privileges.
 * Authorization is always checked on the server against this list (see lib/auth.ts).
 */

export const ADMIN_ROLE = "admin";
export type Role = typeof ADMIN_ROLE;

export interface AdminAccount {
  username: string;
  passwordHash: string;
  role: Role;
}

const USERNAME = /^[A-Za-z0-9._-]{3,64}$/;
const HASH = /^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/;

export function parseAdminAccounts(env: Record<string, string | undefined>): AdminAccount[] {
  const entries: [string, string][] = [];
  const primaryUser = env.ADMIN_USERNAME?.trim();
  const primaryHash = env.ADMIN_PASSWORD_HASH?.trim();
  if (!primaryUser) throw new Error("Missing required environment variable: ADMIN_USERNAME");
  if (!primaryHash) throw new Error("Missing required environment variable: ADMIN_PASSWORD_HASH");
  entries.push([primaryUser, primaryHash]);

  for (const item of (env.ADDITIONAL_ADMINS ?? "").split(/[;\n]/)) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) throw new Error("ADDITIONAL_ADMINS entries must look like username=<password hash>");
    entries.push([trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim()]);
  }

  const seen = new Set<string>();
  return entries.map(([username, passwordHash]) => {
    if (!USERNAME.test(username)) throw new Error(`Invalid admin username "${username}" (3–64 of A–Z a–z 0–9 . _ -)`);
    if (!HASH.test(passwordHash)) {
      throw new Error(`Password hash for admin "${username}" is not a valid scrypt hash (use npm run hash-password)`);
    }
    const key = username.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate admin username "${username}"`);
    seen.add(key);
    return { username, passwordHash, role: ADMIN_ROLE };
  });
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** The admin account with this exact username, or null. */
export function findAdmin(accounts: AdminAccount[], username: string): AdminAccount | null {
  let match: AdminAccount | null = null;
  for (const a of accounts) if (safeEqual(a.username, username)) match = a; // no early exit
  return match;
}

/**
 * Check a username/password pair. Always performs exactly one scrypt verification,
 * so response time does not reveal whether the username exists.
 */
export async function authenticate(
  accounts: AdminAccount[],
  username: string,
  password: string,
): Promise<AdminAccount | null> {
  const match = findAdmin(accounts, username);
  const ok = await verifyPassword(password, (match ?? accounts[0]).passwordHash);
  return match && ok ? match : null;
}
