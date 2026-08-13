import { defineConfig, devices } from "@playwright/test";

const remoteBaseUrl = process.env.BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: remoteBaseUrl ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: remoteBaseUrl ? undefined : {
    command: "rm -rf .wrangler/e2e-state && pnpm exec wrangler d1 migrations apply DB --local --config wrangler.e2e.jsonc --persist-to .wrangler/e2e-state && pnpm exec wrangler d1 execute DB --local --config wrangler.e2e.jsonc --persist-to .wrangler/e2e-state --file scripts/seed-week1.sql && pnpm exec wrangler d1 execute DB --local --config wrangler.e2e.jsonc --persist-to .wrangler/e2e-state --file scripts/seed-admin-qa.sql && pnpm exec wrangler d1 execute DB --local --config wrangler.e2e.jsonc --persist-to .wrangler/e2e-state --file scripts/seed-home-curation-qa.sql && RETASTE_E2E=true CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=wrangler.e2e.jsonc pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
