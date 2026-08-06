import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { operationalAlerts } from "../../app/db/schema";
import { recordOperationalAlert } from "../../app/features/operations/alerts.server";
import { getOperationalDashboard } from "../../app/features/operations/dashboard.server";

describe("operations dashboard", () => {
  it("deduplicates repeated alerts and exposes bounded time windows", async () => {
    const db = createDb(env.DB); const now = "2026-08-06T12:00:00.000Z";
    await recordOperationalAlert(db, { alertType: "PUBLIC_DATA_SYNC", sourceId: "test-run", message: "HTTP 500", details: {}, now });
    await recordOperationalAlert(db, { alertType: "PUBLIC_DATA_SYNC", sourceId: "test-run", message: "HTTP 500", details: {}, now });
    const row = (await db.select().from(operationalAlerts)).find((item) => item.sourceId === "test-run");
    expect(row?.occurrenceCount).toBe(2);
    const dashboard = await getOperationalDashboard(db, { now });
    expect(dashboard.windows.map((window) => window.label)).toEqual(["24시간", "7일", "30일"]);
    expect(dashboard.alerts.some((item) => item.sourceId === "test-run")).toBe(true);
  });
});
