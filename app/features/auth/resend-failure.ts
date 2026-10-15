const REASONS = new Set([
  "TEST_RECIPIENT_RESTRICTED", "SENDER_DOMAIN_NOT_VERIFIED", "API_KEY_SUSPENDED",
  "API_KEY_INACTIVE", "API_KEY_INVALID", "API_KEY_FORMAT_INVALID", "API_KEY_RESTRICTED", "API_PERMISSION_MISSING",
  "UNCLASSIFIED",
]);

async function readErrorBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function resendFailureCode(response: Response, configuration?: { apiKey: string }) {
  const body = await readErrorBody(response);
  const fields = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const name = typeof fields.name === "string" ? fields.name : "";
  const message = typeof fields.message === "string" ? fields.message.toLowerCase() : "";
  let reason = "UNCLASSIFIED";
  if (message.startsWith("you can only send testing emails to your own email address")) reason = "TEST_RECIPIENT_RESTRICTED";
  else if (message.includes("domain") && message.includes("not verified")) reason = "SENDER_DOMAIN_NOT_VERIFIED";
  else if (name === "suspended_api_key") reason = "API_KEY_SUSPENDED";
  else if (message.includes("api key is not active")) reason = "API_KEY_INACTIVE";
  else if (message.includes("api key is invalid")) reason = "API_KEY_INVALID";
  else if (name === "restricted_api_key") reason = "API_KEY_RESTRICTED";
  else if (name === "invalid_permission") reason = "API_PERMISSION_MISSING";
  if (reason === "API_KEY_INVALID" && configuration && !configuration.apiKey.startsWith("re_")) reason = "API_KEY_FORMAT_INVALID";
  // Provider text may contain addresses, credentials or links. Emit fixed codes only.
  return `RESEND_SEND_FAILED:${response.status}:${reason}`;
}

export function safeResendLogCode(raw: string) {
  const match = /^RESEND_SEND_FAILED:([1-5]\d{2})(?::([A-Z_]+))?$/.exec(raw);
  if (!match || (match[2] && !REASONS.has(match[2]))) return "RESEND_SEND_FAILED:UNKNOWN";
  return raw;
}
