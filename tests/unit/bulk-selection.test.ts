import { describe, expect, it } from "vitest";

import { reconcileCandidateSelection } from "../../app/features/candidates/bulk-selection";

describe("bulk candidate selection", () => {
  it("drops candidates that disappear after approval", () => {
    expect(reconcileCandidateSelection(new Set(["approved", "still-open"]), ["still-open"]))
      .toEqual(new Set(["still-open"]));
  });

  it("keeps an explicit empty selection empty when eligible rows reload", () => {
    expect(reconcileCandidateSelection(new Set(), ["new-safe"])).toEqual(new Set());
  });
});
