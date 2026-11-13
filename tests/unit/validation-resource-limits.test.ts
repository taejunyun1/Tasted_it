import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

describe("bounded input validation resource limits", () => {
  it("rejects oversized badge collections before validating their elements", () => {
    const inspectElement = vi.fn((input: unknown) => input);
    const schema = z.array(z.preprocess(inspectElement, z.string())).max(5);

    const result = schema.safeParse(Array.from({ length: 10_000 }, () => null));

    expect(result.success).toBe(false);
    expect(inspectElement).not.toHaveBeenCalled();
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]).toMatchObject({ code: "too_big", maximum: 5 });
    }
  });

  it("still accepts the maximum valid badges and reports invalid bounded elements", () => {
    const schema = z.array(z.string()).max(5);
    expect(schema.parse(["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d", "e"]);
    const result = schema.safeParse(["a", null]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]).toMatchObject({ code: "invalid_type", path: [1] });
    }
  });
});
