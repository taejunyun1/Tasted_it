import { describe, expect, it } from "vitest";

import {
  checkGoldenPickLedger,
  checkPhotoMetadata,
  checkRecommendationEligibility,
  checkRetention,
  checkVoteLedger,
  maskAuditId,
} from "../../app/features/audit/record-audit";

describe("record audit rules", () => {
  it("masks sample identifiers and never returns raw short identifiers", () => {
    expect(maskAuditId("12345678-abcdef")).toBe("1234…cdef");
    expect(maskAuditId("short")).toBe("[redacted]");
  });

  it("finds a current vote whose latest valid event disagrees", () => {
    const findings = checkVoteLedger({
      events: [
        {
          id: "event-12345678",
          placeId: "place-12345678",
          userId: "user-12345678",
          value: 1,
          createdAt: "2026-08-14T00:00:00.000Z",
        },
      ],
      currentVotes: [
        {
          eventId: "event-12345678",
          placeId: "place-12345678",
          userId: "user-12345678",
          value: -1,
        },
      ],
      invalidatedEventIds: new Set<string>(),
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "RATING_CURRENT_VOTE_VALUE_MISMATCH",
          severity: "HIGH",
          count: 1,
          sampleIds: ["even…5678"],
        }),
      ]),
    );
  });

  it("finds photo count and position gaps without exposing object keys", () => {
    const findings = checkPhotoMetadata({
      reviews: [{ id: "review-12345678", photoCount: 2 }],
      photos: [
        {
          id: "photo-12345678",
          reviewId: "review-12345678",
          position: 2,
          byteSize: 100,
          objectKey: "reviews/private-photo.jpg",
        },
      ],
    });

    expect(findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining([
        "REVIEW_PHOTO_COUNT_MISMATCH",
        "REVIEW_PHOTO_POSITION_GAP",
      ]),
    );
    expect(JSON.stringify(findings)).not.toContain("reviews/private-photo.jpg");
  });

  it("finds an active-looking Golden Pick grant that is already expired without a closure", () => {
    const findings = checkGoldenPickLedger({
      now: "2026-08-14T00:00:00.000Z",
      events: [
        {
          id: "grant-12345678",
          placeId: "place-12345678",
          reviewerUserId: "user-12345678",
          eventType: "GRANT",
          previousEventId: null,
          expiresAt: "2026-08-13T00:00:00.000Z",
          effectiveAt: "2026-05-15T00:00:00.000Z",
        },
      ],
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "GOLDEN_PICK_EXPIRED_GRANT_UNCLOSED", severity: "MEDIUM" }),
    ]));
  });

  it("flags expired lifecycle records and hidden places that remain recommendation eligible", () => {
    const findings = [
      ...checkRetention({
        expiredGuestSessionIds: ["guest-12345678"],
        expiredProductEventIds: ["event-12345678"],
      }),
      ...checkRecommendationEligibility([
        { placeId: "place-12345678", status: "HIDDEN", recommendationExcluded: false },
      ]),
    ];

    expect(findings.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining([
      "RETENTION_GUEST_SESSION_EXPIRED",
      "RETENTION_PRODUCT_EVENT_EXPIRED",
      "RECOMMENDATION_HIDDEN_PLACE_ELIGIBLE",
    ]));
  });
});
