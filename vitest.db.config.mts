import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** `npm run test:db` — only the PostgreSQL integration tests (see tests/db.integration.test.ts). */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.integration.test.ts"],
    fileParallelism: false, // the files share one test database
  },
});
