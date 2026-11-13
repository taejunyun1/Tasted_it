import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReviewerModerationCard } from "../../app/components/reviewer-moderation-card";
import { OwnerVisitActions, photoRightsFromForm, type OwnerVisit } from "../../app/components/reviewer-visit-moderation";

vi.mock("react-router", () => ({ useFetcher: () => ({ data: null, state: "idle", submit: () => {}, Form: "form" }) }));
const owner: OwnerVisit = {
  id: "own-visit", version: 3, evaluation: "RECOMMEND", categoryId: "cat-ramen", categoryName: "라멘", badgesJson: "[]",
  status: "APPROVED", visitedOn: "2026-11-01", visitNote: "직접 방문", disclosure: "NONE", photos: [],
};

describe("review moderation controls", () => {
  it("binds owner correction to the current version and explicitly confirms photo deletion", () => {
    const html = renderToStaticMarkup(createElement(OwnerVisitActions, { review: owner }));
    expect(html).toContain('name="expectedVersion" value="3"');
    expect(html).toContain('name="reviewId" value="own-visit"');
    expect(html).not.toContain('name="reviewerUserId"');
    expect(html).toContain("이전 승인과 사진 공개가 중단되고 다시 검수해요");
    expect(html).toContain("공개 중단과 사진 삭제를 확인했어요");
    expect(html).not.toContain('value="APPROVED"');
  });
  it("preserves a retry action for pending file deletion after owner withdrawal", () => {
    const html = renderToStaticMarkup(createElement(OwnerVisitActions, { review: { ...owner, status: "WITHDRAWN", isCurrent: false, cleanupPending: true } }));
    expect(html).toContain("사진 삭제 다시 확인");
    const complete = renderToStaticMarkup(createElement(OwnerVisitActions, { review: { ...owner, status: "WITHDRAWN", isCurrent: false, cleanupPending: false } }));
    expect(complete).not.toContain('value="withdraw-review"');
  });
  it("never offers ordinary approval for an undeclared interest state", () => {
    const html = renderToStaticMarkup(createElement(ReviewerModerationCard, { review: { ...owner, status: "PENDING", disclosure: "UNKNOWN", placeName: "합성 라멘", placeSlug: "synthetic", reviewerDisplayName: "합성 작성자" } }));
    expect(html).toMatch(/<button[^>]*value="APPROVED"[^>]*disabled=""/);
    for (const check of ["visitVerified", "rightsVerified", "privacyVerified", "placeVerified"]) expect(html).toContain(`name="${check}"`);
    expect(html).toContain('name="reason"');
    expect(html).toContain("작성자의 확인은 관리자 검수를 대신하지 않아요");
  });
  it("serializes each photo’s own evidence and identifier without copying unrelated fields", () => {
    const form = new FormData();
    form.set("takenOn-photo-2", "2026-11-01"); form.set("rightsBasis-photo-2", "PERMISSION");
    form.set("rightsNote-photo-2", "제공자의 사용 허락 확인"); form.set("caption-photo-2", "합성 음식 사진"); form.set("privacyChecked-photo-2", "on");
    form.set("reviewerUserId", "forged-identity");
    expect(photoRightsFromForm(form, "photo-2", "photo-2", 1)).toEqual({ photoId: "photo-2", position: 1, takenOn: "2026-11-01", rightsBasis: "PERMISSION", rightsNote: "제공자의 사용 허락 확인", caption: "합성 음식 사진", privacyChecked: true });
  });
});
