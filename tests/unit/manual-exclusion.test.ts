import { describe, expect, it } from "vitest";

import { validateManualExclusion } from "../../app/features/candidates/manual-exclusion";

describe("validateManualExclusion", () => {
  it.each(["BUSINESS_TYPE", "NOT_RESTAURANT", "BAD_OR_DUPLICATE_DATA", "POLICY"])(
    "accepts category %s without a note",
    (category) => {
      expect(validateManualExclusion(category, "", ["candidate-1"])).toEqual({
        category,
        note: null,
        candidateIds: ["candidate-1"],
      });
    },
  );

  it("requires a note for OTHER", () => {
    expect(() => validateManualExclusion("OTHER", "   ", ["candidate-1"])).toThrow("EXCLUSION_NOTE_REQUIRED");
  });

  it("rejects an unknown category", () => {
    expect(() => validateManualExclusion("UNKNOWN", "", ["candidate-1"])).toThrow("EXCLUSION_CATEGORY_INVALID");
  });

  it("limits a bulk operation to 25 unique candidates", () => {
    const candidateIds = Array.from({ length: 26 }, (_, index) => `candidate-${index}`);
    expect(() => validateManualExclusion("POLICY", "", candidateIds)).toThrow("BULK_LIMIT_EXCEEDED");
  });

  it("requires at least one candidate and removes duplicate ids", () => {
    expect(() => validateManualExclusion("POLICY", "", [])).toThrow("CANDIDATE_SELECTION_REQUIRED");
    expect(validateManualExclusion("POLICY", " note ", ["a", "a", "b"])).toMatchObject({
      candidateIds: ["a", "b"],
      note: "note",
    });
  });
});
