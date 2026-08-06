import { describe, expect, it } from "vitest";
import { estimateNeurons, getAiQuotaState } from "../../app/features/candidates/ai-usage-policy";

describe("AI daily usage policy", () => {
  it("estimates neurons conservatively from Workers AI usage", () => {
    expect(estimateNeurons({ prompt_tokens: 1_000, completion_tokens: 100 })).toBe(34);
  });

  it("blocks at 90 percent of the free daily allocation", () => {
    expect(getAiQuotaState(8_999).blocked).toBe(false);
    expect(getAiQuotaState(9_000)).toMatchObject({ blocked: true, warning: true, percent: 90 });
  });
});

