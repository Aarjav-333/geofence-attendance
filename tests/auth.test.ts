import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSessionToken, SESSION_TTL_S, verifySessionToken } from "@/lib/session";
import { createRateLimiter } from "@/lib/rate-limit";

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
