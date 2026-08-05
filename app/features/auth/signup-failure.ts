const GENERIC_SUCCESS = "가입 가능 여부와 관계없이 인증 안내가 등록된 이메일로 전송됩니다.";

export function describeSignupFailure(error: unknown) {
  const rawCode = error instanceof Error ? error.message : "UNKNOWN";
  const logCode = rawCode.startsWith("RESEND_SEND_FAILED:")
    ? rawCode
    : rawCode.split(":", 1)[0] || "UNKNOWN";

  if (logCode === "ACCOUNT_EXISTS") {
    return { status: 200 as const, ok: true as const, logCode, message: GENERIC_SUCCESS };
  }
  if (logCode === "EMAIL_NOT_CONFIGURED") {
    return { status: 503 as const, ok: false as const, logCode, message: "이메일 발송 설정이 필요합니다." };
  }
  if (logCode.startsWith("RESEND_SEND_FAILED:")) {
    return { status: 503 as const, ok: false as const, logCode, message: "인증 메일을 보내지 못했습니다. 발신 주소 설정을 확인해 주세요." };
  }
  return { status: 503 as const, ok: false as const, logCode, message: "가입 처리에 실패했습니다. 잠시 후 다시 시도해 주세요." };
}
