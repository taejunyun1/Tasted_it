import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AuthDivider,
  GoogleAuthButton,
  oauthErrorMessage,
} from "../../app/features/auth/google-auth-ui";

describe("Google authentication UI", () => {
  it("renders an accessible Google continuation link with returnTo", () => {
    const html = renderToStaticMarkup(
      createElement(GoogleAuthButton, { returnTo: "/courses?meal=1" }),
    );

    expect(html).toContain("Google로 계속하기");
    expect(html).toContain(
      'href="/auth/google?returnTo=%2Fcourses%3Fmeal%3D1"',
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("focus-visible:outline");
  });

  it("renders the email continuation divider", () => {
    expect(renderToStaticMarkup(createElement(AuthDivider))).toContain(
      "또는 이메일로 계속하기",
    );
  });

  it.each([
    ["cancelled", "Google 로그인이 취소되었습니다."],
    ["invalid_request", "로그인 요청이 만료되었습니다. 다시 시도해 주세요."],
    ["unverified_email", "이메일이 확인된 Google 계정을 사용해 주세요."],
    ["temporarily_unavailable", "Google 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요."],
    ["unknown", null],
    [null, null],
  ])("maps %s to limited user-facing copy", (code, expected) => {
    expect(oauthErrorMessage(code)).toBe(expected);
  });
});
