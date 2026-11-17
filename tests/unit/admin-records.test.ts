import { describe, expect, it } from "vitest";
import { encodeExportCursor, parseExportQuery, serializeActivityCsv } from "../../app/features/operations/admin-records";

const filters = { from: "2026-11-01", to: "2026-11-18", view: "audit", kind: "all", limit: "50" };
describe("bounded audit export", () => {
  it("validates exact filters, inclusive UTC dates and hard row/date limits", () => {
    expect(parseExportQuery(new URLSearchParams(filters))).toMatchObject({
      from: "2026-11-01T00:00:00.000Z", to: "2026-11-19T00:00:00.000Z", limit: 50,
    });
    for (const values of [
      { ...filters, from: "2026-02-30" }, { ...filters, from: "2026-12-01" },
      { ...filters, from: "2026-09-01" }, { ...filters, limit: "201" },
      { ...filters, limit: "1.5" }, { ...filters, kind: "RATING" },
      { ...filters, extra: "ignored" },
    ]) expect(() => parseExportQuery(new URLSearchParams(values))).toThrow();
    expect(() => parseExportQuery(new URLSearchParams(`${new URLSearchParams(filters)}&kind=CSV_IMPORT`))).toThrow();
  });
  it("binds next cursor to all export filters", () => {
    const query = parseExportQuery(new URLSearchParams(filters));
    const cursor = encodeExportCursor(query, "activity-cursor");
    expect(parseExportQuery(new URLSearchParams({ ...filters, cursor })).activityCursor).toBe("activity-cursor");
    for (const changes of [{ from: "2026-11-02" }, { to: "2026-11-17" }, { view: "operations" }, { kind: "CSV_IMPORT" }, { limit: "51" }])
      expect(() => parseExportQuery(new URLSearchParams({ ...filters, ...changes, cursor }))).toThrow();
  });
  it("quotes UTF-8 CSV and neutralizes spreadsheet formulas without exporting extra fields", () => {
    const csv = serializeActivityCsv([{ key: "key", createdAt: "2026-11-18", actor: " =1+1", title: '한글, "인용"\n다음', target: "\t@SUM(A1)", state: "RECORDED", email: "private@example.test", payload: "private" }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\' =1+1"');
    expect(csv).toContain('"\'\t@SUM(A1)"');
    expect(csv).toContain('"한글, ""인용""\n다음"');
    expect(csv).not.toMatch(/private|email|payload/);
  });
});
