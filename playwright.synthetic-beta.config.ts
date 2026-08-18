import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "synthetic-beta-200.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "rm -rf .wrangler/synthetic-beta-state && pnpm exec wrangler d1 migrations apply DB --local --config wrangler.e2e.jsonc --persist-to .wrangler/synthetic-beta-state && pnpm exec wrangler d1 execute DB --local --config wrangler.e2e.jsonc --persist-to .wrangler/synthetic-beta-state --file scripts/seed-synthetic-beta-200.sql && RETASTE_E2E=true SYNTHETIC_BETA=1 CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=wrangler.e2e.jsonc pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { SYNTHETIC_BETA: "1" },
  },
});
