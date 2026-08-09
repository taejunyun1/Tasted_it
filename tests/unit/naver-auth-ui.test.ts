import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  NaverAuthButton,
  naverOAuthErrorMessage,
} from "../../app/features/auth/naver-auth-ui";

describe("Naver authentication UI", () => {
  it("renders an accessible Naver continuation link with returnTo", () => {
    const html = renderToStaticMarkup(
      createElement(NaverAuthButton, { returnTo: "/courses?meal=1" }),
    );
    expect(html).toContain("네이버로 계속하기");
    expect(html).toContain("href=\"/auth/naver?returnTo=%2Fcourses%3Fmeal%3D1\"");
    expect(html).toContain("bg-[#03C75A]");
  });

  it.each([
    ["cancelled", "네이버 로그인이 취소되었습니다."],
    ["email_required", "네이버에서 이메일 제공에 동의해야 가입할 수 있습니다."],
    ["existing_account", "기존 방식으로 로그인한 뒤 내 정보에서 네이버를 연결해주세요."],
    ["identity_conflict", "이 네이버 계정은 다른 Re:Taste 계정에 연결되어 있습니다."],
    ["last_login_method", "다른 로그인 수단을 먼저 등록한 뒤 네이버 연동을 해제해주세요."],
    ["temporarily_unavailable", "네이버 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요."],
  ])("maps %s to Korean guidance", (code, expected) => {
    expect(naverOAuthErrorMessage(code)).toBe(expected);
  });
});
