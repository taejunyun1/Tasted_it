import { describe, expect, it, vi } from "vitest";

import { loadInD1Chunks } from "../../app/db/d1-query-chunks";

describe("loadInD1Chunks", () => {
  it("D1의 쿼리당 바인딩 제한을 넘지 않도록 값을 나눠 조회한다", async () => {
    const values = Array.from({ length: 140 }, (_, index) => `place-${index}`);
    const loadChunk = vi.fn(async (chunk: string[]) => chunk.map((value) => ({ value })));

    const rows = await loadInD1Chunks(values, loadChunk, { reservedBindings: 1 });

    expect(loadChunk).toHaveBeenCalledTimes(2);
    expect(loadChunk.mock.calls.every(([chunk]) => chunk.length <= 99)).toBe(true);
    expect(rows).toHaveLength(140);
    expect(rows[0]).toEqual({ value: "place-0" });
    expect(rows.at(-1)).toEqual({ value: "place-139" });
  });
});
