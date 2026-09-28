/**
 * Apply database/schema.sql (idempotent).
 *
 *   npm run db:migrate                                   # uses DATABASE_URL from .env.local
 *   npm run db:migrate -- --env-file=.env.vercel-production
 *
 * With --env-file, the connection string is read ONLY from that file
 * (DATABASE_URL_UNPOOLED preferred, else DATABASE_URL) and never exported to
 * your shell — so it can't leak into later `npm run dev` sessions or shell
 * history. Works the same in bash, PowerShell and cmd.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { connectionOptions } from "../lib/db-options";
import { loadEnv } from "./load-env";

function resolveUrl(): { url: string; source: string } {
  const arg = process.argv.find((a) => a.startsWith("--env-file="));
  if (arg) {
    const file = arg.slice("--env-file=".length);
    const vars = parseEnv(readFileSync(file, "utf8")) as Record<string, string | undefined>;
    const url = vars.DATABASE_URL_UNPOOLED || vars.DATABASE_URL;
    if (!url) throw new Error(`${file} has no DATABASE_URL_UNPOOLED or DATABASE_URL`);
    return { url, source: file };
  }
  loadEnv();
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (add it to .env.local, or pass --env-file=<file>).");
  return { url, source: ".env.local / environment" };
}

async function main() {
  const { url, source } = resolveUrl();
  const host = new URL(url).hostname;
  console.log(`Migrating ${host} (from ${source})…`);

  const sql = postgres(url, { ...connectionOptions(url), max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(readFileSync(join(process.cwd(), "database", "schema.sql"), "utf8"));
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM submissions`;
    console.log(`✓ Schema applied. submissions table has ${count} row(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ Migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
