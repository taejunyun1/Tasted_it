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
});

describe("auth entry href and field retention", () => {
  it("passes allowlisted returnTo on header login and signup paths", () => {
    expect(authEntryHref("/login", "/places", "?category=gukbap")).toBe("/login?returnTo=%2Fplaces%3Fcategory%3Dgukbap");
    expect(authEntryHref("/signup", "/courses")).toBe("/signup?returnTo=%2Fcourses");
    expect(authEntryHref("/login", "/")).toBe("/login");
  });

  it("keeps submitted login and signup fields on 400", () => {
    expect(retainedAuthFields({ email: "keep@example.test", displayName: "보관" })).toEqual({
      email: "keep@example.test",
      displayName: "보관",
    });
    const login = readFileSync("app/routes/login.tsx", "utf8");
    const signup = readFileSync("app/routes/signup.tsx", "utf8");
    const root = readFileSync("app/root.tsx", "utf8");
    const places = readFileSync("app/routes/place-list.tsx", "utf8");
    const maps = readFileSync("app/routes/map-category.tsx", "utf8");
    expect(root).toContain('authEntryHref("/login"');
    expect(root).toContain('authEntryHref("/signup"');
    expect(login).toContain("defaultValue={actionData?.email}");
    expect(signup).toContain("defaultValue={actionData?.email}");
    expect(signup).toContain("GoogleAuthButton returnTo={loaderData.returnTo}");
    expect(signup).toContain("회원가입 — Re:Taste");
    expect(places).toContain("맛집 리스트 — Re:Taste");
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

