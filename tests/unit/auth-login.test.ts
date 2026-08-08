import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../../app/features/auth/login";

describe("safeReturnTo", () => {
  it.each([
    ["/courses?meal=1", "/"],
    ["/places", "/"],
    [undefined, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/auth/google", "/"],
    ["/auth/google/callback?code=secret", "/"],
  ])("maps %s to a safe internal destination", (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });
});
