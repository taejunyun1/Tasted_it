const oauthMessages: Record<string, string> = {
  cancelled: "Google 로그인이 취소되었습니다.",
  invalid_request: "로그인 요청이 만료되었습니다. 다시 시도해 주세요.",
  unverified_email: "이메일이 확인된 Google 계정을 사용해 주세요.",
  temporarily_unavailable:
    "Google 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.",
};

export function oauthErrorMessage(value: string | null | undefined) {
  return value ? oauthMessages[value] ?? null : null;
}

export function GoogleAuthButton({ returnTo }: { returnTo?: string }) {
  const href = `/auth/google${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  return (
    <a
      href={href}
      className="flex min-h-12 items-center justify-center gap-3 rounded-full border border-neutral-300 bg-white px-5 font-semibold text-neutral-950 shadow-sm transition hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5 shrink-0"
      >
        <path
          fill="#4285F4"
          d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.32 2.98-7.39Z"
        />
        <path
          fill="#34A853"
          d="M12 22c2.7 0 4.98-.9 6.63-2.38l-3.24-2.53c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.77-5.61-4.14H3.04v2.61A10 10 0 0 0 12 22Z"
        />
        <path
          fill="#FBBC05"
          d="M6.39 13.91A6 6 0 0 1 6.07 12c0-.66.11-1.3.32-1.91V7.48H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.52l3.35-2.61Z"
        />
        <path
          fill="#EA4335"
          d="M12 5.95c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.35 2.61C7.18 7.72 9.39 5.95 12 5.95Z"
        />
      </svg>
      <span>Google로 계속하기</span>
    </a>
  );
}

export function AuthDivider() {
  return (
    <div className="my-7 flex items-center gap-4 text-xs font-medium text-neutral-500">
      <span className="h-px flex-1 bg-neutral-200" aria-hidden="true" />
      <span>또는 이메일로 계속하기</span>
      <span className="h-px flex-1 bg-neutral-200" aria-hidden="true" />
    </div>
  );
}
