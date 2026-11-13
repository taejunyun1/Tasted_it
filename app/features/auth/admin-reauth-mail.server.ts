import { resendFailureCode } from "./resend-failure";

export async function sendAdminReauthEmail(input: { apiKey: string; from: string; to: string; code: string; fetcher?: typeof fetch }) {
  if (!/^\d{8}$/.test(input.code)) throw new Error("ADMIN_CODE_INVALID");
  const response = await (input.fetcher ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: input.from, to: [input.to], subject: "Re:Taste 관리자 재인증 코드",
      text: `관리자 재인증 코드: ${input.code}\n10분 동안 현재 브라우저에서 한 번만 사용할 수 있습니다. 요청하지 않았다면 코드를 공유하지 마세요.` }),
  });
  if (!response.ok) throw new Error(await resendFailureCode(response, { apiKey: input.apiKey }));
}
