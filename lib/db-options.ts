import type { Options } from "postgres";

/**
 * Connection options shared by the app (lib/db.ts) and scripts (migrate).
 *
 * TLS: remote databases always use `verify-full` (encrypted AND the server
 * certificate is checked against trusted CAs + hostname). Note that postgres.js
 * treats `ssl: "require"` — and `?sslmode=require` in the URL — as
 * "encrypt but don't verify", so we set the option explicitly, which takes
 * precedence over the URL. Local hosts (localhost / docker `db`) use no TLS.
 * `DATABASE_SSL=disable|require|verify-full` overrides this for unusual hosts.
 *
 * Prepared statements are left to postgres.js defaults, so `?prepare=false` in
 * the URL (or PGPREPARE) still works for poolers that need it. Neon's pooler
 * supports protocol-level prepared statements, so it needs nothing special.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db"]);
const SSL_MODES = ["disable", "require", "verify-full"] as const;
type SslMode = (typeof SSL_MODES)[number];

export function isLocalDatabase(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
}

export function sslMode(url: string, override = process.env.DATABASE_SSL): SslMode {
  const o = override?.trim().toLowerCase();
  if (o) {
    if (!SSL_MODES.includes(o as SslMode)) {
      throw new Error(`DATABASE_SSL must be one of ${SSL_MODES.join(", ")}; got "${override}"`);
    }
    return o as SslMode;
  }
  return isLocalDatabase(url) ? "disable" : "verify-full";
}

export function connectionOptions(url: string, override?: string): Pick<Options<never>, "ssl"> {
  const mode = sslMode(url, override ?? process.env.DATABASE_SSL);
  return { ssl: mode === "disable" ? false : mode };
}
