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

  it("keeps NAVER verification on the current page until an admin explicitly opens the next step", () => {
    const route = readFileSync("app/routes/admin-place-operations.tsx", "utf8");
    const component = readFileSync("app/components/admin/PlaceReviewPipeline.tsx", "utf8");

    expect(route).not.toContain("return redirect(");
    expect(route).toContain("nextStep: 3");
    expect(component).not.toContain("useNavigate");
    expect(component).not.toContain("navigate(buildPlaceReviewNextStepHref(query)");
    expect(component).toContain("NAVER 확인 후 카테고리 확정 단계 보기");
  });

  it("allows selecting 25 places while the server processes only the first ten NAVER checks", () => {
    const component = readFileSync("app/components/admin/PlaceReviewPipeline.tsx", "utf8");
    const verification = readFileSync("app/features/places/place-review-naver.server.ts", "utf8");

    expect(component).toContain("const selectionLimit = 25;");
    expect(component).toContain("25곳까지 선택할 수 있고, 한 번의 NAVER 검증에서는 앞선 10곳만 처리합니다.");
    expect(verification).toContain("MAX_NAVER_REVIEW_BATCH_SIZE = 10");
    expect(verification).toContain("const batchWorkItemIds = workItemIds.slice(0, MAX_NAVER_REVIEW_BATCH_SIZE);");
  });
});
