import { describe, expect, it } from "vitest";

import { parsePlaceOperationsTab } from "../../app/features/places/place-operations-tabs";

describe("place operations tabs", () => {
  it("opens NAVER verification by default and accepts known tab keys", () => {
    expect(parsePlaceOperationsTab(null)).toBe("naver");
    expect(parsePlaceOperationsTab("liveness")).toBe("liveness");
    expect(parsePlaceOperationsTab("duplicates")).toBe("duplicates");
  });

  it("falls back to NAVER verification for an invalid tab key", () => {
    expect(parsePlaceOperationsTab("something-else")).toBe("naver");
  });
});
