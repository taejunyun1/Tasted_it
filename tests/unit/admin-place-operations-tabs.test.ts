import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("place operations tab wiring", () => {
  it("restores liveness, correction, and merge actions before the review-stage contract", () => {
    const route = readFileSync("app/routes/admin-place-operations.tsx", "utf8");
    const reviewCheckAt = route.indexOf("const checked = checkReviewRequest");
    const mergeAt = route.indexOf('intent === "merge"');
    const correctionAt = route.indexOf('intent === "apply-correction"');
    const livenessAt = route.indexOf('intent === "resolve-liveness"');

    expect(correctionAt).toBeGreaterThan(-1);
    expect(mergeAt).toBeGreaterThan(correctionAt);
    expect(livenessAt).toBeGreaterThan(mergeAt);
    expect(reviewCheckAt).toBeGreaterThan(livenessAt);
    expect(route).toContain("applyPlaceCorrection");
    expect(route).toContain("mergePlaces");
    expect(route).toContain("resolvePlaceLivenessCase");
    expect(route).toContain("PlaceLivenessPanel");
    expect(route).toContain("PlaceMergePanel");
    expect(route).toContain("PlaceCorrectionPanel");
    expect(route).not.toContain("mergeSafeSameNamePlaces");
    expect(route).not.toContain("merge-safe-same-name-places");
  });

  it("keeps suggestion approval on review step 1 and ops tabs URL-backed", () => {
    const route = readFileSync("app/routes/admin-place-operations.tsx", "utf8");
    const liveness = readFileSync("app/components/admin/PlaceLivenessPanel.tsx", "utf8");
    const merge = readFileSync("app/components/admin/PlaceMergePanel.tsx", "utf8");
    const correction = readFileSync("app/components/admin/PlaceCorrectionPanel.tsx", "utf8");

    expect(route).toContain("query.step === 1");
    expect(route).toContain('aria-label="장소 운영 작업"');
    expect(liveness).toContain("영업 상태 재검증");
    expect(liveness).toContain('name="tab" value="liveness"');
    expect(liveness).toContain("자동 추천 제외 전체 해제");
    expect(merge).toContain("자동 병합은 하지 않으며");
    expect(merge).toContain('name="intent" value="merge"');
    expect(correction).toContain("정정 적용");
    expect(correction).not.toContain("requesterEmail");
  });
});
