import { describe, expect, it } from "vitest";
import { ActivityInputError, encodeActivityCursor, parseActivityQuery } from "../../app/features/operations/admin-activity";
const now = "2026-11-14T08:00:00.000Z";
const cursor = { version: 1 as const, view: "audit" as const, kind: "all", cutoff: now, afterKey: 2461358.833334768, afterId: "id-1", highWater: 90 };
describe("activity cursor", () => {
  it("binds a bounded cursor to the selected view and kind", () => {
    const encoded = encodeActivityCursor(cursor);
    expect(parseActivityQuery(new URLSearchParams({ cursor: encoded }), now).cursor).toEqual(cursor);
    for (const params of [{ cursor: encoded, view: "operations" }, { cursor: encoded, kind: "CSV_IMPORT" }, { cursor: "@bad" }, { cursor: "x".repeat(1025) }, { kind: "secret-kind" }, { operation: "not-an-id" }])
      expect(() => parseActivityQuery(new URLSearchParams(params), now)).toThrow(ActivityInputError);
  });
  it("rejects duplicate query keys, future cursors and unsupported cursor fields", () => {
    expect(() => parseActivityQuery(new URLSearchParams("kind=all&kind=CSV_IMPORT"), now)).toThrow(ActivityInputError);
    expect(() => parseActivityQuery(new URLSearchParams({ cursor: encodeActivityCursor({ ...cursor, cutoff: "2099-01-01T00:00:00.000Z" }) }), now)).toThrow(ActivityInputError);
    const extra = btoa(JSON.stringify({ ...cursor, sql: "untrusted" })).replace(/=+$/, "");
    expect(() => parseActivityQuery(new URLSearchParams({ cursor: extra }), now)).toThrow(ActivityInputError);
  });
});
