import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("place review selection controls", () => {
  it("uses one toggle for page selection and exposes non-food filtering only at step one", () => {
    const component = readFileSync("app/components/admin/PlaceReviewPipeline.tsx", "utf8");

    expect(component).toContain("togglePageSelection");
    expect(component).toContain('selectedIds.length ? "선택 해제"');
    expect(component).toContain('query.step === 1');
    expect(component).toContain('value="auto-exclude-non-food-review-items"');
    expect(component).not.toContain('onClick={() => setSelectedIds([])}>선택 해제</button>');
  });

  it("keeps NAVER verification responses in the route and moves successful work client-side", () => {
    const route = readFileSync("app/routes/admin-place-operations.tsx", "utf8");
    const component = readFileSync("app/components/admin/PlaceReviewPipeline.tsx", "utf8");

    expect(route).not.toContain("return redirect(");
    expect(route).toContain("nextStep: 3");
    expect(component).toContain("useNavigate");
    expect(component).toContain("buildPlaceReviewNextStepHref(query)");
  });

  it("keeps the NAVER verification UI and server batch guard at ten places", () => {
    const component = readFileSync("app/components/admin/PlaceReviewPipeline.tsx", "utf8");
    const verification = readFileSync("app/features/places/place-review-naver.server.ts", "utf8");

    expect(component).toContain("const selectionLimit = query.step === 2 ? 10 : 25;");
    expect(component).toContain("한 번에 최대 10곳씩 실행합니다.");
    expect(verification).toContain("MAX_NAVER_REVIEW_BATCH_SIZE = 10");
  });
});
