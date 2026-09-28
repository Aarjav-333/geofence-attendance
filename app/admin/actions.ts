"use server";

import { timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminCredentials, getSessionSecret } from "@/lib/config";
import { verifyPassword } from "@/lib/password";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientIp, hashIp } from "@/lib/request";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_S } from "@/lib/session";

const loginLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 });

export interface LoginState {
  error?: string;
  username?: string;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
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

  const creds = getAdminCredentials();
  // Always run the (slow) password check so timing doesn't reveal valid usernames.
  const passwordOk = await verifyPassword(password, creds.passwordHash);
  if (!safeEqual(username, creds.username) || !passwordOk) {
    return { error: "Invalid username or password.", username };
  }

  const token = await createSessionToken(creds.username, getSessionSecret());
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
