import { describe, expect, it } from "vitest";
import { slugifyPlaceName } from "../../app/features/places/place-slug";

describe("place slug", () => {
  it("creates a readable Korean slug from a business name", () => {
    expect(slugifyPlaceName("일품 양평해장국 광주무등산점")).toBe("일품-양평해장국-광주무등산점");
    expect(slugifyPlaceName("  카페, 봄! (동명점)  ")).toBe("카페-봄-동명점");
  });

  it("uses place for a name without letters or numbers", () => {
    expect(slugifyPlaceName("★ & !")).toBe("place");
  });
});
