import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dailyPublishRate } from "../../app/features/operations/dashboard.server";

describe("review throughput measurement", () => {
  it("rounds 7-day publish counts to two decimals", () => {
    expect(dailyPublishRate(0)).toBe(0);
    expect(dailyPublishRate(2)).toBe(0.29);
    expect(dailyPublishRate(7)).toBe(1);
  });

  it("shows 7-day rate and queue depth on the operations screen", () => {
    const route = readFileSync("app/routes/admin-operations.tsx", "utf8");
    const runbook = readFileSync("docs/operations/place-operations-runbook.md", "utf8");
    expect(route).toContain("검수 처리량");
    expect(route).toContain("7일 공개/일");
    expect(route).toContain("ACTIVE 큐");
    expect(route).toContain("5단계 최종");
    expect(route).toContain("loaderData.publishedPerDay7d");
    expect(route).toContain("queue.SOURCE_REVIEW");
    expect(runbook).toContain("검수 처리량 집계");
    expect(runbook).toContain("PLACE_REVIEW_PUBLISH");
    expect(runbook).not.toContain("SELECT name FROM places");
  });
});