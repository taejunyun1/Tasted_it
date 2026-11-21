import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./tests/integration/test-worker.ts",
      remoteBindings: false,
      miniflare: {
        compatibilityDate: "2026-08-05",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB", "MIGRATION_DB"],
        r2Buckets: ["SOURCE_PHOTOS", "CANDIDATE_PHOTOS"],
        bindings: {
          TEST_MIGRATIONS: (await readD1Migrations(path.join(import.meta.dirname, "drizzle")))
            .filter(migration => migration.name < "0050"),
        },
      },
    })),
  ],
  test: { include: ["tests/operations/b17-isolated-*.test.ts"] },
});
