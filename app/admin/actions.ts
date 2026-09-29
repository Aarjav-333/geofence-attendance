"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { getAdminSession } from "@/lib/auth";
import { deleteAllSubmissions } from "@/lib/db";
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

export type ClearAllResult =
  | { ok: true; deleted: number }
  | { ok: false; code: "UNAUTHENTICATED" | "SERVER_ERROR" | "DB_ERROR"; error: string };

/**
 * Delete ALL attendance records. Server actions are reachable by direct POST, so
 * the admin check here is the real guard — hiding the button is not.
 */
export async function clearAllAttendance(): Promise<ClearAllResult> {
  // 1. Authorization. A failure here (e.g. misconfigured SESSION_SECRET) happens
  //    before any deletion, so it's safe to say nothing was deleted.
  let session;
  try {
    session = await getAdminSession();
  } catch (err) {
    console.error("[admin] clear all: could not check the admin session", err);
    return {
      ok: false,
      code: "SERVER_ERROR",
      error: "Server configuration error — the data was not cleared. Check the server logs.",
    };
  }
  if (!session) {
    return { ok: false, code: "UNAUTHENTICATED", error: "Your session has expired. Please sign in again." };
  }

  // 2. The delete itself. If the database call fails we can't be certain whether it
  //    committed (e.g. the connection dropped afterwards), so don't claim either way.
  let deleted: number;
  try {
    deleted = await deleteAllSubmissions();
  } catch (err) {
    console.error("[admin] clear all attendance data failed", err);
    return {
      ok: false,
      code: "DB_ERROR",
      error: "The database reported an error while clearing the data. Refresh the page to see what is currently stored.",
    };
  }

  // 3. Housekeeping after a successful delete must never turn success into an error.
  console.info(`[admin] ${session.sub} cleared all attendance data (${deleted} record(s))`);
  try {
    revalidatePath("/admin");
  } catch (err) {
    console.error("[admin] clear all: revalidatePath failed (data was deleted)", err);
  }
  return { ok: true, deleted };
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/admin/login");
}
