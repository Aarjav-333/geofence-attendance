import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `server-only` throws outside the React Server bundle; it's a no-op in unit tests.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Database integration tests are destructive and need PostgreSQL: they run only via
    // `npm run test:db` (vitest.db.config.mts), never as part of `npm test`.
    exclude: ["**/node_modules/**", "tests/**/*.integration.test.ts"],
  },
});
