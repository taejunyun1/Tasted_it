import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("place suggestion approval action wiring", () => {
  it("connects approve and transition intents before the review-stage contract", () => {
    const route = readFileSync("app/routes/admin-place-operations.tsx", "utf8");
    const approveAt = route.indexOf('intent === "approve-suggestion"');
    const transitionAt = route.indexOf('intent === "transition-suggestion"');
    const reviewCheckAt = route.indexOf("const checked = checkReviewRequest");

    expect(approveAt).toBeGreaterThan(-1);
    expect(transitionAt).toBeGreaterThan(-1);
    expect(reviewCheckAt).toBeGreaterThan(transitionAt);
    expect(approveAt).toBeLessThan(reviewCheckAt);
    expect(route).toContain("approvePlaceSuggestion");
    expect(route).toContain("listReviewablePlaceSuggestions");
    expect(route).toContain("PlaceSuggestionReviewCard");
    expect(route).toContain("회원 장소 제안");
    expect(route).toContain("query.step === 1");
  });

  it("keeps map confirmation fields and on-screen suggestion errors", () => {
    const route = readFileSync("app/routes/admin-place-operations.tsx", "utf8");
    const card = readFileSync("app/components/admin/PlaceSuggestionReviewCard.tsx", "utf8");

    expect(card).toContain('name="intent" value="approve-suggestion"');
    expect(card).toContain("PlaceLocationPicker");
    expect(card).toContain('mode="ADMIN"');
    expect(card).toContain("초안 승인");
    expect(card).toContain('placeholder="승인 근거"');
    expect(route).toContain("suggestionApprovalErrorMessage");
    expect(card.match(/name="expectedRevision"/g)).toHaveLength(2);
    expect(route).toContain("item.decisionRevision");
    expect(route).toContain("conflict ? 409");
    expect(route).toContain("suggestionApprovalNotice");
    expect(card).not.toContain("생성한 초안 보기");
  });
});
