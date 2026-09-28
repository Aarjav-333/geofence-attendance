import { describe, expect, it } from "vitest";
import { connectionOptions, isLocalDatabase, sslMode } from "@/lib/db-options";

const NEON_POOLED = "postgres://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/db?sslmode=require";
const NEON_DIRECT = "postgres://u:p@ep-x.ap-southeast-1.aws.neon.tech/db?sslmode=require";

describe("connectionOptions", () => {
  it("verifies TLS certificates for remote hosts, even when the URL says sslmode=require", () => {
    expect(connectionOptions(NEON_POOLED, "")).toEqual({ ssl: "verify-full" });
    expect(connectionOptions(NEON_DIRECT, "")).toEqual({ ssl: "verify-full" });
    expect(connectionOptions("postgres://u:p@aws-0.pooler.supabase.com:6543/postgres", "")).toEqual({
      ssl: "verify-full",
    });
  });

  it("disables TLS for local databases (by hostname, case-insensitively)", () => {
    expect(connectionOptions("postgres://geofence:geofence@localhost:5433/geofence", "")).toEqual({ ssl: false });
    expect(connectionOptions("postgres://u:p@LOCALHOST/db", "")).toEqual({ ssl: false });
    expect(connectionOptions("postgres://u:p@127.0.0.1:5432/db", "")).toEqual({ ssl: false });
    expect(connectionOptions("postgres://u:p@[::1]:5432/db", "")).toEqual({ ssl: false });
    expect(connectionOptions("postgres://u:p@db:5432/db", "")).toEqual({ ssl: false });
  });

  it("decides locality from the hostname only, not credentials or query", () => {
    expect(isLocalDatabase("postgres://localhost:pw@db.example.com/app")).toBe(false);
    expect(isLocalDatabase("postgres://u:p@db.example.com/app?host=localhost")).toBe(false);
  });

  it("never sets `prepare`, so ?prepare=false in the URL keeps working", () => {
    expect(connectionOptions(NEON_POOLED, "")).not.toHaveProperty("prepare");
  });

  it("honours an explicit DATABASE_SSL override and rejects unknown values", () => {
    expect(sslMode(NEON_DIRECT, "require")).toBe("require");
    expect(sslMode("postgres://u:p@localhost/db", "verify-full")).toBe("verify-full");
    expect(connectionOptions(NEON_DIRECT, "disable")).toEqual({ ssl: false });
    expect(() => sslMode(NEON_DIRECT, "yes-please")).toThrow(/DATABASE_SSL/);
  });
});
