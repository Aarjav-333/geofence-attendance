/**
 * Generate an ADMIN_PASSWORD_HASH value.
 * Usage: npm run hash-password -- "your-strong-password"
 */
import { hashPassword } from "../lib/password";

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your-strong-password"');
  process.exit(1);
}

hashPassword(password)
  .then((hash) => {
    console.log("\nAdd this line to .env.local (and to your hosting provider's env vars):\n");
    console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
