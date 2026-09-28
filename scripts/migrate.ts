/**
 * Apply database/schema.sql to DATABASE_URL (idempotent).
 * Usage: npm run db:migrate
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { loadEnv } from "./load-env";

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (add it to .env.local).");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1|db)(:|\/)/.test(url);
const sql = postgres(url, { ssl: isLocal ? false : "require", max: 1, onnotice: () => {} });

async function main() {
  await sql.unsafe(readFileSync(join(process.cwd(), "database", "schema.sql"), "utf8"));
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM submissions`;
  console.log(`✓ Schema applied. submissions table has ${count} row(s).`);
}

main()
  .catch((err) => {
    console.error("✗ Migration failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
