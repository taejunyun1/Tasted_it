import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../../app/features/auth/login";

describe("safeReturnTo", () => {
  it("keeps an internal path", () => {
    expect(safeReturnTo("/places/sample-place-1?from=map")).toBe(
      "/places/sample-place-1?from=map",
    );
  });

  it("rejects protocol-relative and external URLs", () => {
    expect(safeReturnTo("//evil.example/path")).toBe("/");
    expect(safeReturnTo("https://evil.example/path")).toBe("/");
  });
});
