"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate } from "@/lib/admin-accounts";
import { getAdminAccounts, getSessionSecret } from "@/lib/config";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientIp, hashIp } from "@/lib/request";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_S } from "@/lib/session";

const loginLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 });

export interface LoginState {
  error?: string;
  username?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const { allowed, retryAfterS } = loginLimiter(hashIp(clientIp(await headers())));
  if (!allowed) {
    return { error: `Too many login attempts. Try again in ${Math.ceil(retryAfterS / 60)} minute(s).`, username };
  }
  if (!username || !password || password.length > 256) {
    return { error: "Enter your username and password.", username };
  }

  // Any configured admin account (primary admin, master, …); all share the "admin" role.
  // authenticate() always runs one scrypt check so timing doesn't reveal valid usernames.
  const account = await authenticate(getAdminAccounts(), username, password);
  if (!account) {
    return { error: "Invalid username or password.", username };
  }

  const token = await createSessionToken(account.username, getSessionSecret(), undefined, account.role);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  redirect("/admin");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/admin/login");
}
