import path from "node:path";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./tests/integration/test-worker.ts",
      remoteBindings: false,
      miniflare: {
        compatibilityDate: "2026-08-05",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: {
          ADMIN_EMAIL: "admin@example.com",
          ONBOARDING_ENABLED: "true",
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "drizzle"),
          ),
        },
      },
    })),
  ],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/apply-migrations.ts"],
  },
});
