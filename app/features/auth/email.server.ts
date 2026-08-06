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
