import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { placeLivenessStates, places, productEvents } from "../../app/db/schema";
import { runRecordAudit } from "../../app/features/audit/record-audit.server";

describe("runRecordAudit", () => {
  it("uses bounded snapshots, detects expired product data, and redacts the report", async () => {
    const db = createDb(env.DB);
    const now = "2026-08-14T00:00:00.000Z";
    const eventId = `audit-event-${crypto.randomUUID()}`;
    const privateEmail = "must-not-appear@example.com";

    await db.insert(productEvents).values({
      id: eventId,
      userId: null,
      guestSessionId: null,
      eventName: "ONBOARDING_STARTED",
      metadataJson: JSON.stringify({ email: privateEmail }),
      occurredAt: "2026-07-01T00:00:00.000Z",
    });
    await db.insert(productEvents).values({
      id: `audit-event-${crypto.randomUUID()}`,
      userId: null,
      guestSessionId: null,
      eventName: "ONBOARDING_STARTED",
      metadataJson: "{}",
      occurredAt: "2026-07-02T00:00:00.000Z",
    });

    const report = await runRecordAudit(db, {
      now,
      sourceCommit: "test-sha",
      maxRows: 1,
    });

    expect(report.sourceCommit).toBe("test-sha");
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "RETENTION_PRODUCT_EVENT_EXPIRED" }),
    ]));
    expect(report.queryCapsReached).toContain("productEvents");
    expect(JSON.stringify(report)).not.toContain(privateEmail);
  });

  it("checks active hidden liveness states even when they predate the 30-day data window", async () => {
    const db = createDb(env.DB);
    const now = "2026-08-14T00:00:00.000Z";
    const placeId = `audit-place-${crypto.randomUUID()}`;

    await db.insert(places).values({
      id: placeId,
      slug: `audit-place-${crypto.randomUUID()}`,
      name: "감사 대상 장소",
      status: "PUBLISHED",
      address: "광주광역시",
      neighborhood: "동구",
      latitude: 35.15,
      longitude: 126.9,
      searchText: "감사 대상 장소",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(placeLivenessStates).values({
      placeId,
      status: "HIDDEN",
      kakaoStatus: "NOT_FOUND",
      recommendationExcluded: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const report = await runRecordAudit(db, { now, sourceCommit: "test-sha" });

    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "RECOMMENDATION_HIDDEN_PLACE_ELIGIBLE" }),
    ]));
  });
});
