import { loadEnvConfig } from "@next/env";

/** Load .env / .env.local exactly the way Next.js does, for standalone scripts. */
export function loadEnv() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
}
