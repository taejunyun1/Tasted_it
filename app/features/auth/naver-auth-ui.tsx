const messages: Record<string, string> = {
  cancelled: "네이버 로그인이 취소되었습니다.",
  invalid_request: "로그인 요청이 만료되었습니다. 다시 시도해 주세요.",
  email_required: "네이버에서 이메일 제공에 동의해야 가입할 수 있습니다.",
  existing_account:
    "기존 방식으로 로그인한 뒤 내 정보에서 네이버를 연결해주세요.",
  identity_conflict:
    "이 네이버 계정은 다른 Re:Taste 계정에 연결되어 있습니다.",
  last_login_method:
    "다른 로그인 수단을 먼저 등록한 뒤 네이버 연동을 해제해주세요.",
  temporarily_unavailable:
    "네이버 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.",
};

export function naverOAuthErrorMessage(value: string | null | undefined) {
  return value ? messages[value] ?? null : null;
}

export function NaverAuthButton({ returnTo }: { returnTo?: string }) {
  const href = `/auth/naver${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  return (
    <a
      href={href}
      className="flex min-h-12 items-center justify-center gap-3 rounded-full bg-[#03C75A] px-5 font-semibold text-white shadow-sm transition hover:bg-[#02b351] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900"
    >
      <span aria-hidden="true" className="text-xl font-black leading-none">N</span>
      <span>네이버로 계속하기</span>
    </a>
  );
}
