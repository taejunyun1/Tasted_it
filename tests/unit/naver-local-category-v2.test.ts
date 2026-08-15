import { describe, expect, it } from "vitest";
import { verifyNaverCategoryV2 } from "../../app/features/candidates/naver-local-category-v2";
import { verifyNaverCategoryV2WithAdapter } from "../../app/features/candidates/naver-category-v2.server";

const input = (category: string, latitude = 35.15, longitude = 126.85) => ({ businessName: "신 돼지세끼", address: "광주광역시 서구 화정동 1", latitude: 35.15, longitude: 126.85, regionCode: "GWANGJU" as const, terminalSlugs: new Set(["grill"]), results: [{ name: "신 돼지세끼", address: "광주광역시 서구 화정동 1", category, latitude, longitude }] });

describe("NAVER category v2", () => {
  it("accepts exact matched concrete categories but not broad provider categories", () => {
    expect(verifyNaverCategoryV2(input("음식점>한식>육류,고기요리")).categorySlug).toBe("grill");
    expect(verifyNaverCategoryV2(input("음식점>한식"))).toMatchObject({ status: "BROAD", categorySlug: null, categoryVerification: "BROAD" });
  });

  it("fails closed for over-100m matches and unavailable providers", () => {
    expect(verifyNaverCategoryV2({ ...input("음식점>한식>육류", 35.152, 126.85), results: [{ ...input("음식점>한식>육류", 35.152, 126.85).results[0], address: "광주광역시 서구 다른동 1" }] }).status).toBe("NO_MATCH");
    expect(verifyNaverCategoryV2({ ...input("음식점>한식"), results: null }).status).toBe("UNAVAILABLE");
  });

  it("retains only a bounded verification when the provider adapter fails", async () => {
    const verification = await verifyNaverCategoryV2WithAdapter({
      ...input("음식점>한식>육류,고기요리"),
      adapter: { search: async () => { throw new Error("provider unavailable"); } },
    });
    expect(verification).toMatchObject({ status: "UNAVAILABLE", categorySlug: null, evidenceCodes: ["NAVER_UNAVAILABLE"] });
  });
});
