import { afterEach, describe, expect, it, vi } from "vitest";

import { readBrowserAccountToken } from "../../app/components/auth/TokenHashField";
import { verificationEmailUrl, verificationLoginHref } from "../../app/features/auth/verification-link";

afterEach(() => vi.unstubAllGlobals());

function browserAt(href: string) {
  const location = new URL(href);
  const replaceState = vi.fn();
  vi.stubGlobal("window", { location, history: { replaceState } });
  return replaceState;
}

describe("account verification links", () => {
  it("keeps the token in the fragment and carries only an allowed return destination", () => {
    const destination = "/places/example?from=map&tab=reviews";
    const url = new URL(verificationEmailUrl("https://example.test/", "synthetic-token", destination));
    expect(url.pathname).toBe("/verify-email");
    expect(url.hash).toBe("#synthetic-token");
    expect(url.searchParams.get("returnTo")).toBe(destination);
    expect(url.searchParams.has("token")).toBe(false);
    expect(verificationLoginHref(url.searchParams.get("returnTo"))).toBe(`/login?returnTo=${encodeURIComponent(destination)}`);
  });

  it("rejects external and encoded unsafe return destinations at both handoffs", () => {
    for (const destination of ["https://evil.test/", "//evil.test/places", "/places/%252e%252e/auth/callback"]) {
      const url = new URL(verificationEmailUrl("https://example.test", "synthetic-token", destination));
      expect(url.searchParams.has("returnTo")).toBe(false);
      expect(verificationLoginHref(destination)).toBe("/login");
    }
  });

  it("reads a fragment token and removes a legacy query token without losing context", () => {
    const replace = browserAt("https://example.test/verify-email?returnTo=%2Fplaces%2Fexample&token=legacy#fragment-token");
    expect(readBrowserAccountToken()).toBe("fragment-token");
    expect(replace).toHaveBeenCalledWith(null, "", "/verify-email?returnTo=%2Fplaces%2Fexample#fragment-token");
  });

  it("treats missing or malformed fragments as an unusable link without throwing", () => {
    for (const suffix of ["", "#%", "#%E0%A4%A", "#%00", `#${"a".repeat(513)}`]) {
      browserAt(`https://example.test/verify-email${suffix}`);
      expect(readBrowserAccountToken()).toBe("");
    }
  });

  it("removes malformed legacy query tokens even when they cannot be decoded", () => {
    const replace = browserAt("https://example.test/verify-email?token=%25&returnTo=%2Fme");
    expect(readBrowserAccountToken()).toBe("");
    expect(replace).toHaveBeenCalledWith(null, "", "/verify-email?returnTo=%2Fme");
  });
});
