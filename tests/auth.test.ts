import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSessionToken, SESSION_TTL_S, verifySessionToken } from "@/lib/session";
import { createRateLimiter } from "@/lib/rate-limit";
import { authenticate, findAdmin, parseAdminAccounts } from "@/lib/admin-accounts";
import { signToken } from "@/lib/signed-token";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";

describe("password hashing", () => {
  it("verifies the correct password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt:16384:8:1:/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password!", hash)).toBe(false);
  });

  it("rejects malformed hashes and short passwords", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow();
  });
});

describe("session tokens", () => {
  it("round-trips a valid token", async () => {
    const token = await createSessionToken("admin", SECRET, 1000);
    const payload = await verifySessionToken(token, SECRET, 1001);
    expect(payload?.sub).toBe("admin");
  });

  it("rejects expired, tampered, or wrongly-signed tokens", async () => {
    const token = await createSessionToken("admin", SECRET, 1000);
    expect(await verifySessionToken(token, SECRET, 1000 + SESSION_TTL_S)).toBeNull();
    expect(await verifySessionToken(token, SECRET + "x", 1001)).toBeNull();

    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "root", iat: 1000, exp: 9e9 })).toString("base64url");
    expect(await verifySessionToken(`${forged}.${sig}`, SECRET, 1001)).toBeNull();
    expect(await verifySessionToken(`${body}.${sig}x`, SECRET, 1001)).toBeNull();
    expect(await verifySessionToken(undefined, SECRET)).toBeNull();
    expect(await verifySessionToken("garbage", SECRET)).toBeNull();
  });
});

describe("session role", () => {
  it("issues admin-role sessions and rejects tokens without the admin role", async () => {
    const token = await createSessionToken("master", SECRET, 1000);
    expect(await verifySessionToken(token, SECRET, 1001)).toMatchObject({ sub: "master", role: "admin" });

    // Correctly signed, but not an admin (e.g. an ordinary user, or a legacy token without a role)
    const user = await signToken({ sub: "employee", role: "user", iat: 1000, exp: 9e9 }, SECRET);
    const legacy = await signToken({ sub: "admin", iat: 1000, exp: 9e9 }, SECRET);
    expect(await verifySessionToken(user, SECRET, 1001)).toBeNull();
    expect(await verifySessionToken(legacy, SECRET, 1001)).toBeNull();
  });
});

describe("admin accounts", () => {
  let adminHash: string;
  let masterHash: string;
  const env = () => ({ ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: adminHash, ADDITIONAL_ADMINS: `master=${masterHash}` });

  it("prepares hashes", async () => {
    adminHash = await hashPassword("admin-test-password-1");
    masterHash = await hashPassword("master-test-password-2");
  });

  it("parses the primary admin plus ADDITIONAL_ADMINS, all with the admin role", () => {
    expect(parseAdminAccounts(env())).toEqual([
      { username: "admin", passwordHash: adminHash, role: "admin" },
      { username: "master", passwordHash: masterHash, role: "admin" },
    ]);
    // Optional: without ADDITIONAL_ADMINS only the primary admin exists
    expect(parseAdminAccounts({ ...env(), ADDITIONAL_ADMINS: undefined }).map((a) => a.username)).toEqual(["admin"]);
    // Several entries, separated by ";"
    expect(parseAdminAccounts({ ...env(), ADDITIONAL_ADMINS: `master=${masterHash}; ops=${masterHash}` })).toHaveLength(3);
  });

  it("rejects malformed configuration instead of silently ignoring it", () => {
    expect(() => parseAdminAccounts({ ...env(), ADDITIONAL_ADMINS: "master=plaintext-password" })).toThrow(/scrypt/);
    expect(() => parseAdminAccounts({ ...env(), ADDITIONAL_ADMINS: `Admin=${masterHash}` })).toThrow(/Duplicate/);
    expect(() => parseAdminAccounts({ ...env(), ADDITIONAL_ADMINS: `ma ster=${masterHash}` })).toThrow(/username/);
    expect(() => parseAdminAccounts({ ...env(), ADDITIONAL_ADMINS: "nohash" })).toThrow(/username=/);
    expect(() => parseAdminAccounts({ ADMIN_PASSWORD_HASH: adminHash })).toThrow(/ADMIN_USERNAME/);
  });

  it("authenticates both admin and master with their own passwords only", async () => {
    const accounts = parseAdminAccounts(env());
    expect(await authenticate(accounts, "admin", "admin-test-password-1")).toMatchObject({ username: "admin", role: "admin" });
    expect(await authenticate(accounts, "master", "master-test-password-2")).toMatchObject({ username: "master", role: "admin" });
    expect(await authenticate(accounts, "master", "admin-test-password-1")).toBeNull(); // other account's password
    expect(await authenticate(accounts, "admin", "master-test-password-2")).toBeNull();
    expect(await authenticate(accounts, "master", "wrong-password-xyz")).toBeNull();
    expect(await authenticate(accounts, "Master", "master-test-password-2")).toBeNull(); // exact username
    expect(await authenticate(accounts, "nobody", "master-test-password-2")).toBeNull();
  });

  it("findAdmin recognises only configured accounts (removed accounts lose access)", () => {
    const accounts = parseAdminAccounts(env());
    expect(findAdmin(accounts, "master")?.role).toBe("admin");
    expect(findAdmin(parseAdminAccounts({ ...env(), ADDITIONAL_ADMINS: "" }), "master")).toBeNull();
    expect(findAdmin(accounts, "employee")).toBeNull();
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per window", () => {
    const check = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(check("k", 0).allowed).toBe(true);
    expect(check("k", 1).allowed).toBe(true);
    expect(check("k", 2).allowed).toBe(false);
    expect(check("other", 2).allowed).toBe(true);
    expect(check("k", 1001).allowed).toBe(true);
  });
});
