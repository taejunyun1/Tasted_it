import { describe, expect, it } from "vitest";
import { resendFailureCode, safeResendLogCode } from "../../app/features/auth/resend-failure";

describe("Resend failure diagnostics", () => {
  it.each([
    ["validation_error", "You can only send testing emails to your own email address (owner@example.com).", "TEST_RECIPIENT_RESTRICTED"],
    ["validation_error", "The mail.example.com domain is not verified. Please, add and verify your domain.", "SENDER_DOMAIN_NOT_VERIFIED"],
    ["suspended_api_key", "This API key is suspended", "API_KEY_SUSPENDED"],
    ["restricted_api_key", "API key is not active", "API_KEY_INACTIVE"],
    ["invalid_permission", "Access token is missing required scopes.", "API_PERMISSION_MISSING"],
  ])("retains a fixed reason for %s without provider text", async (name, message, reason) => {
    const code = await resendFailureCode(new Response(JSON.stringify({ name, message }), { status: 403 }));
    expect(code).toBe(`RESEND_SEND_FAILED:403:${reason}`);
    expect(code).not.toContain("example.com");
  });

  it("discards unrecognized text, credentials, links, and malformed error bodies", async () => {
    for (const body of [
      JSON.stringify({ name: "unknown", message: "owner@example.com re_private-key https://example.com/verify-email#private-token" }),
      "not json",
      JSON.stringify({ name: "validation_error", message: "x".repeat(9000) }),
    ]) {
      await expect(resendFailureCode(new Response(body, { status: 403 })))
        .resolves.toBe("RESEND_SEND_FAILED:403:UNCLASSIFIED");
    }
  });

  it("allows only a status and known reason in signup logs", () => {
    expect(safeResendLogCode("RESEND_SEND_FAILED:403:TEST_RECIPIENT_RESTRICTED"))
      .toBe("RESEND_SEND_FAILED:403:TEST_RECIPIENT_RESTRICTED");
    expect(safeResendLogCode("RESEND_SEND_FAILED:403")).toBe("RESEND_SEND_FAILED:403");
    expect(safeResendLogCode("RESEND_SEND_FAILED:403:owner@example.com\nsecret"))
      .toBe("RESEND_SEND_FAILED:UNKNOWN");
  });

  it.each([["re_test-key", "API_KEY_INVALID"], ["another-provider-test-key", "API_KEY_FORMAT_INVALID"]])("identifies invalid credential format without revealing the key", async (apiKey, reason) => {
    const response = new Response(JSON.stringify({ name: "validation_error", message: "API key is invalid" }), { status: 403 });
    await expect(resendFailureCode(response, { apiKey })).resolves.toBe(`RESEND_SEND_FAILED:403:${reason}`);
  });
});
