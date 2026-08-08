export async function sendAccountEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD" | "VERIFY_CORRECTION";
  url: string;
  fetcher?: typeof fetch;
}) {
  const title = input.purpose === "VERIFY_EMAIL" ? "이메일 인증" : input.purpose === "RESET_PASSWORD" ? "비밀번호 재설정" : "장소 정정 요청 확인";
  const response = await (input.fetcher ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: `Re:Taste ${title}`,
      html: `<div style="font-family:sans-serif;color:#171b18"><h1 style="font-size:24px">Re:Taste ${title}</h1><p>아래 링크는 30분 동안 한 번만 사용할 수 있습니다.</p><p><a href="${input.url}">${title} 계속하기</a></p><p>요청하지 않았다면 이 메일을 무시하세요.</p></div>`,
    }),
  });
  if (!response.ok) throw new Error(`RESEND_SEND_FAILED:${response.status}`);
  return response.json() as Promise<{ id: string }>;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendGoogleWelcomeEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  displayName: string;
  appBaseUrl: string;
  fetcher?: typeof fetch;
}) {
  const name = escapeHtml(input.displayName.trim() || "새 회원");
  const coursesUrl = new URL("/courses", input.appBaseUrl).toString();
  const response = await (input.fetcher ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: "Re:Taste에 오신 것을 환영합니다",
      html: `<div style="font-family:sans-serif;color:#171b18"><h1 style="font-size:24px">Re:Taste에 오신 것을 환영합니다</h1><p>${name}님, Google 계정 연결이 완료되었습니다.</p><p>광주·전남의 맛집과 취향에 맞는 코스를 둘러보세요.</p><p><a href="${coursesUrl}">나만의 맛 코스 추천받기</a></p></div>`,
      text: `${input.displayName.trim() || "새 회원"}님, Re:Taste Google 계정 연결이 완료되었습니다. 맛 코스 둘러보기: ${coursesUrl}`,
    }),
  });
  if (!response.ok) throw new Error(`RESEND_SEND_FAILED:${response.status}`);
  return response.json() as Promise<{ id: string }>;
}

export async function sendGoogleWelcomeIfNeeded(input: {
  isNewUser: boolean;
  apiKey: string;
  from: string;
  to: string;
  displayName: string;
  appBaseUrl: string;
  sender?: typeof sendGoogleWelcomeEmail;
  onError?: (error: unknown) => void;
}) {
  if (!input.isNewUser || !input.apiKey || !input.from) return false;
  try {
    await (input.sender ?? sendGoogleWelcomeEmail)({
      apiKey: input.apiKey,
      from: input.from,
      to: input.to,
      displayName: input.displayName,
      appBaseUrl: input.appBaseUrl,
    });
    return true;
  } catch (error) {
    input.onError?.(error);
    return false;
  }
}
