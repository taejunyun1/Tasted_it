import { describe, expect, it } from "vitest";

import { parsePlaceCsv } from "../../app/features/places/import.server";
import { parseImportSnapshot } from "../../app/features/places/import-operation.server";

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
  it("bounds admin upload bytes and rows and rejects duplicate slugs", () => {
    expect(parsePlaceCsv(validCsv, { maxBytes: 10 }).errors[0].field).toBe("csv");
    const lines = validCsv.split("\n");
    expect(parsePlaceCsv([...lines, lines[1]].join("\n"), { maxRows: 1 }).errors[0].field).toBe("csv");
    expect(parsePlaceCsv([...lines, lines[1]].join("\n")).errors[0].field).toBe("slug");
  });

  it("requires the publication workflow for admin CSV while preserving offline seed parsing", () => {
    const csv = validCsv.replace("hero_image_url\n", "hero_image_url,status\n") + ",PUBLISHED";
    expect(parsePlaceCsv(csv).rows[0].status).toBe("PUBLISHED");
    expect(parsePlaceCsv(csv, { allowPublished: false }).errors[0].field).toBe("status");
  });

  it("rechecks row, byte and publication limits on the final stored payload", () => {
    const row = parsePlaceCsv(validCsv).rows[0];
    const entry = { row, placeId: "new-place", existing: null, category: { id: "category", slug: "ramen", updatedAt: "2026-11-14", isActive: true }, links: "[]" };
    expect(() => parseImportSnapshot({ version: 1, entries: Array.from({ length: 201 }, () => entry) })).toThrow();
    expect(() => parseImportSnapshot({ version: 1, entries: [{ ...entry, row: { ...row, name: "x".repeat(2 * 1024 * 1024) } }] })).toThrow("IMPORT_PAYLOAD_TOO_LARGE");
    expect(() => parseImportSnapshot({ version: 1, entries: [{ ...entry, row: { ...row, status: "PUBLISHED" } }] })).toThrow();
  });

});
