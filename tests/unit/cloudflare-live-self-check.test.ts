import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAINTENANCE_CRON, RSI_CRON, RSI_PUBLIC_PATH_CHECKS } from "../../app/features/operations/rsi-self-check";

const script = readFileSync("scripts/verify-cloudflare-live.mjs", "utf8");
const worker = readFileSync("workers/app.ts", "utf8");
const wrangler = readFileSync("wrangler.jsonc", "utf8");
const agents = readFileSync("AGENTS.md", "utf8");
const server = readFileSync("app/features/operations/rsi-self-check.server.ts", "utf8");

describe("cloudflare RSI self-check", () => {
  it("runs on the Worker outside the maintenance Promise.all and never targets remote D1", () => {
    expect(worker).toContain("runScheduledRsiSelfCheck(env)");
    expect(worker).toContain("handleRsiOnDemandRequest");
    expect(worker).toContain("isRsiCron(controller.cron)");
    expect(server).toContain("RSI_ON_DEMAND_PATH");
    expect(worker.indexOf("if (isRsiCron(controller.cron))")).toBeLessThan(worker.indexOf("Promise.all(["));
    expect(worker).not.toMatch(/Promise\.all\(\[[^\]]*runScheduledRsiSelfCheck/s);
    expect(wrangler).toContain('"RSI_CLOUDFLARE_ENABLED": "true"');
    expect(wrangler).toContain(`"${MAINTENANCE_CRON}"`);
    expect(wrangler).toContain(`"${RSI_CRON}"`);
    expect(wrangler.match(/"crons":/g)?.length).toBe(1);
    expect(server).not.toContain("--remote");
    expect(server).not.toContain("createDb");
    expect(server).not.toContain("env.DB");
  });

  it("keeps the laptop script as smoke only and points agents at Worker RSI", () => {
    expect(script).toContain("Laptop smoke only");
    expect(script).toContain('redirect: "manual"');
    for (const check of RSI_PUBLIC_PATH_CHECKS) {
      expect(script).toContain(`"${check.path}"`);
    }
    expect(script).not.toContain("--remote");
    expect(script).not.toContain("d1");
    expect(agents).toContain("GET /internal/rsi-self-check");
    expect(agents).toContain("RSI_SELF_CHECK");
    expect(agents).toContain("47 */6 * * *");
    expect(agents).toContain("Do not use `pnpm run verify:cloudflare-live` as the RSI loop");
  });
});
