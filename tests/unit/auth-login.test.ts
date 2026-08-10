import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../../app/features/auth/login";

describe("safeReturnTo", () => {
  it.each([
    ["/courses?meal=1", "/"],
    ["/places", "/places"],
    ["/places/sample-place-1?from=map", "/places/sample-place-1?from=map"],
    [undefined, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/%5Cevil.example/path", "/"],
    ["/places/%252e%252e/admin", "/"],
    ["javascript:alert(1)", "/"],
    ["/admin/candidates", "/"],
    ["/auth/google", "/"],
    ["/auth/google/callback?code=secret", "/"],
  ])("maps %s to a safe internal destination", (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });
});
