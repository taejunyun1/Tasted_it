import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/verify-cloudflare-live.mjs", "utf8");
const ignore = readFileSync(".gitignore", "utf8");
const agents = readFileSync("AGENTS.md", "utf8");
const pkg = readFileSync("package.json", "utf8");

describe("cloudflare live self-check", () => {
  it("probes the live Worker over HTTP and never targets remote D1", () => {
    expect(script).toContain("https://retaste-beta.retaste-beta.workers.dev");
    expect(script).toContain('redirect: "manual"');
    expect(script).toContain("/admin");
    expect(script).not.toContain("--remote");
    expect(script).not.toContain("d1");
  });

  it("is wired for agents and ignores Playwright MCP leftovers", () => {
    expect(pkg).toContain("verify:cloudflare-live");
    expect(agents).toContain("verify:cloudflare-live");
    expect(ignore).toContain(".playwright-mcp/");
  });
});
