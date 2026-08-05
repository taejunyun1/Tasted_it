import { describe, expect, it } from "vitest";

import { describeSignupFailure } from "../../app/features/auth/signup-failure";

describe("signup failure policy", () => {
  it("keeps an existing account private", () => {
    expect(describeSignupFailure(new Error("ACCOUNT_EXISTS"))).toEqual({
      status: 200,
      ok: true,
      logCode: "ACCOUNT_EXISTS",
      message: "가입 가능 여부와 관계없이 인증 안내가 등록된 이메일로 전송됩니다.",
    });
  });

  it("reports email delivery failures as temporarily unavailable", () => {
    expect(describeSignupFailure(new Error("RESEND_SEND_FAILED:403"))).toEqual({
      status: 503,
      ok: false,
      logCode: "RESEND_SEND_FAILED:403",
      message: "인증 메일을 보내지 못했습니다. 발신 주소 설정을 확인해 주세요.",
    });
  });

  it("reports unexpected account failures without exposing details", () => {
    expect(describeSignupFailure(new Error("D1_ERROR:details"))).toEqual({
      status: 503,
      ok: false,
      logCode: "D1_ERROR",
      message: "가입 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    });
  });
});
