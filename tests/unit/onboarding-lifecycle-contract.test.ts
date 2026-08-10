import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("onboarding lifecycle scheduler contract", () => {
  it("wires daily onboarding cleanup and an occurred-at purge index", () => {
    const migrationPath = "drizzle/0023_onboarding_data_lifecycle.sql";
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const worker = readFileSync("workers/app.ts", "utf8");
    const migration = readFileSync(migrationPath, "utf8");
    expect(worker).toContain("runScheduledOnboardingDataLifecycle(env)");
    expect(migration).toContain("product_events_occurred_at_idx");
    expect(migration).toContain("ON product_events(occurred_at)");
  });
});
