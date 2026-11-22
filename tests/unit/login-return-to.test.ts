import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { authEntryHref, publicLoginError, PUBLIC_LOGIN_ERROR, retainedAuthFields, safeReturnTo } from "../../app/features/auth/login";

describe("safeReturnTo", () => {
  it("returns to a requested place or admin path after login", () => {
    expect(safeReturnTo("/places/sample-place-1?from=map")).toBe("/places/sample-place-1?from=map");
    expect(safeReturnTo("/admin")).toBe("/admin");
    expect(safeReturnTo("/admin/candidates")).toBe("/admin/candidates");
    expect(safeReturnTo("/admin/place-operations?step=1")).toBe("/admin/place-operations?step=1");
    expect(safeReturnTo("/me/suggestions")).toBe("/me/suggestions");
    expect(safeReturnTo("/courses")).toBe("/courses");
    expect(safeReturnTo(null)).toBe("/");
  });

  it("returns data requests to their page instead of the internal transport endpoint", () => {
    expect(safeReturnTo("/student/join.data?_routes=routes%2Fstudent-join")).toBe("/student/join");
    expect(safeReturnTo("/student.data?page=2&_routes=routes%2Fstudent-index")).toBe("/student?page=2");
    expect(safeReturnTo("/admin/students.data?step=1&_routes=routes%2Fadmin-students")).toBe("/admin/students?step=1");
    expect(safeReturnTo("/student/../login.data")).toBe("/");
    expect(safeReturnTo("//evil.test/student.data")).toBe("/");
  });

  it("rejects protocol-relative and external URLs", () => {
    expect(safeReturnTo("//evil.example/path")).toBe("/");
    expect(safeReturnTo("https://evil.example/path")).toBe("/");
  });

  it("preserves home exploration with a single valid place and its nested provenance", () => {
    const place = "/places/sample?sourceRail=TRUSTED&discoveryMode=QUALITY&recommendationRequestId=7b3c9a17-8064-4d2e-8cf7-857dfc78b86f";
    const search = new URLSearchParams({ view: "browse", q: "동명 10% + ...", selected: "sample-id", bbox: "126.80,35.10,127.00,35.25", place });
    expect(safeReturnTo("/?" + search)).toBe("/?" + search);
    expect(safeReturnTo("/?place=sample")).toBe("/?place=sample");
    expect(safeReturnTo("/_root.data?" + search + "&_routes=routes%2Fhome")).toBe("/?" + search);
    expect(safeReturnTo("/places?" + search + "&_routes=routes%2Fplace-list")).toBe("/places?" + search);
    expect(safeReturnTo("/maps/ramen?" + search)).toBe("/maps/ramen?" + search);
    for (const entry of ["/login", "/signup"] as const) {
      const href = new URL(authEntryHref(entry, "/", "?" + search), "https://retaste.test");
      const destination = new URL(href.searchParams.get("returnTo")!, href);
      expect(destination.pathname).toBe("/");
      expect([...destination.searchParams]).toEqual([...search]);
    }
  });

  it("limits home continuation to the app's accepted detail values", () => {
    for (const search of [
      "view=browse",
      "place=sample&place=other",
      "place=.%2Fsample",
      "place=https%3A%2F%2Fexample.invalid%2Fplaces%2Fsample",
      "place=%2Fplaces%2Fsample%3FsourceRail%3DTRUSTED%26discoveryMode%3DQUALITY",
    ]) {
      expect(safeReturnTo("/?" + search)).toBe("/");
    }
  });
});

describe("auth entry href and field retention", () => {
  it("passes allowlisted returnTo on header login and signup paths", () => {
    expect(authEntryHref("/login", "/places", "?category=gukbap")).toBe("/login?returnTo=%2Fplaces%3Fcategory%3Dgukbap");
    expect(authEntryHref("/signup", "/courses")).toBe("/signup?returnTo=%2Fcourses");
    expect(authEntryHref("/login", "/")).toBe("/login");
  });

  it("canonicalizes equivalent SSR and browser queries without losing values or duplicates", () => {
    const raw = "?bbox=126.80,35.10,127.00,35.25&q=라멘%20가게&badge=food-ramen&badge=style-market&literal=a%2Bb&space=a+b";
    const serialized = `?${new URLSearchParams(raw)}`;
    for (const entry of ["/login", "/signup"] as const) {
      expect(authEntryHref(entry, "/places", raw)).toBe(authEntryHref(entry, "/places", serialized));
      const href = new URL(authEntryHref(entry, "/places", raw), "https://retaste.test");
      const returnTo = new URL(href.searchParams.get("returnTo")!, href);
      expect(returnTo.pathname).toBe("/places");
      expect([...returnTo.searchParams]).toEqual([...new URLSearchParams(raw)]);
      expect(returnTo.searchParams.get("literal")).toBe("a+b");
      expect(returnTo.searchParams.get("space")).toBe("a b");
    }
  });

  it("keeps unsafe return paths rejected and data endpoints canonicalized", () => {
    for (const path of ["//evil.test/places", "/places/%252e%252e/admin", "/auth/callback", "/places/%255c%255cevil"]) {
      expect(authEntryHref("/login", path, "?bbox=1,2,3,4")).toBe("/login");
    }
    expect(authEntryHref("/login", "/places", "?bbox=1,2,3,4&_routes=routes%2Fplace-list"))
      .toBe(authEntryHref("/login", "/places", "?bbox=1,2,3,4"));
    const entry = new URL(authEntryHref("/login", "/places.data", "?bbox=1,2,3,4&_routes=routes%2Fplace-list"), "https://retaste.test");
    const destination = new URL(entry.searchParams.get("returnTo")!, entry);
    expect(destination.pathname).toBe("/places");
    expect(destination.searchParams.get("bbox")).toBe("1,2,3,4");
    expect(destination.searchParams.has("_routes")).toBe(false);
  });

  it("keeps submitted login and signup fields on 400", () => {
    expect(retainedAuthFields({ email: "keep@example.test", displayName: "보관" })).toEqual({
      email: "keep@example.test",
      displayName: "보관",
    });
    const login = readFileSync("app/routes/login.tsx", "utf8");
    const signup = readFileSync("app/routes/signup.tsx", "utf8");
    const root = readFileSync("app/root.tsx", "utf8");
    const maps = readFileSync("app/routes/map-category.tsx", "utf8");
    expect(root).toContain('authEntryHref("/login"');
    expect(root).toContain('authEntryHref("/signup"');
    expect(login).toContain("defaultValue={actionData?.email}");
    expect(signup).toContain("defaultValue={actionData?.email}");
    expect(signup).toContain("GoogleAuthButton returnTo={loaderData.returnTo}");
    expect(signup).toContain("회원가입 — Re:Taste");
    expect(maps).toContain("지도 — Re:Taste");
    expect(login).toContain("publicLoginError");
    expect(login).not.toContain("이메일 인증을 먼저 완료해 주세요");
    expect(login).not.toContain("EMAIL_NOT_VERIFIED");
  });
});

describe("publicLoginError", () => {
  it("uses one public message for unverified and invalid logins", () => {
    expect(publicLoginError(new Error("EMAIL_NOT_VERIFIED"))).toBe(PUBLIC_LOGIN_ERROR);
    expect(publicLoginError(new Error("LOGIN_INVALID"))).toBe(PUBLIC_LOGIN_ERROR);
    expect(PUBLIC_LOGIN_ERROR).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
  });
});

