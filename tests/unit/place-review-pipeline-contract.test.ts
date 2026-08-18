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
    expect(component).toContain("선택 항목을 카테고리 확정으로 이동");
    expect(component).toContain('query.step === 2 && <button className="secondary" name="intent" value="advance-review-items"');
  });

  it("runs up to ten NAVER checks as sequential background actions instead of one Worker request", () => {
    const component = readFileSync("app/components/admin/PlaceReviewPipeline.tsx", "utf8");
    const route = readFileSync("app/routes/admin-place-operations.tsx", "utf8");

    expect(component).toContain("const selectionLimit = 25;");
    expect(component).toContain("useFetcher");
    expect(component).toContain("auto-verify-review-item-with-naver");
    expect(component).toContain("선택 중 10곳 NAVER 검증");
    expect(component).toContain("수동으로 NAVER 검증 대기로 이동");
    expect(route).toContain('intent === "auto-verify-review-item-with-naver"');
    expect(route).toContain("const workItemId = workItemIds[0]!");
  });

  it("correlates each sequential NAVER response without reading idle fetcher form data", () => {
    const component = readFileSync("app/components/admin/PlaceReviewPipeline.tsx", "utf8");

    expect(component).toContain('const requestId = `${naverBatch.id}:${naverBatch.nextIndex}`;');
    expect(component).toContain('formData.set("batchId", requestId);');
    expect(component).toContain('const expectedRequestId = `${naverBatch.id}:${naverBatch.nextIndex}`;');
    expect(component).toContain("naverBatchFetcher.data?.batchId !== expectedRequestId");
    expect(component).not.toContain("naverBatchFetcher.formData");
  });

  it("uses the NAVER mapped category as the default category confirmation value", () => {
    const component = readFileSync("app/components/admin/PlaceReviewPipeline.tsx", "utf8");
    const query = readFileSync("app/features/places/place-review-query.server.ts", "utf8");

    expect(component).toContain("row.selectedCategoryId ?? row.naverMappedCategoryId ?? \"\"");
    expect(query).toContain("naverMappedCategoryId");
    expect(query).toContain("naverMappedCategoryName");
  });
});
