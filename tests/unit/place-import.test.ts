import { describe, expect, it } from "vitest";

import { parsePlaceCsv } from "../../app/features/places/import.server";

const validCsv = [
  "name,slug,address,neighborhood,latitude,longitude,primary_category,hero_image_url",
  "테스트식당,test-place,광주광역시 동구 테스트로 1,동명동,35.1465,126.9220,ramen,https://images.example.com/test.jpg",
].join("\n");

describe("parsePlaceCsv", () => {
  it("returns a normalized valid row", () => {
    const result = parsePlaceCsv(validCsv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      name: "테스트식당",
      slug: "test-place",
      latitude: 35.1465,
      longitude: 126.922,
      primaryCategory: "ramen",
    });
  });

  it("reports an invalid coordinate without accepting the row", () => {
    const result = parsePlaceCsv(validCsv.replace("35.1465", "not-a-number"));

    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toMatchObject({ row: 2, field: "latitude" });
  });
});
