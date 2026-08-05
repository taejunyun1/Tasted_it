import { defineConfig, devices } from "@playwright/test";

const remoteBaseUrl = process.env.BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: remoteBaseUrl ? 2 : undefined,
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
    command: "pnpm run db:migrate:local && pnpm run db:seed:local && pnpm exec wrangler d1 execute DB --local --file scripts/seed-admin-qa.sql && pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
