import { describe, expect, it, vi } from "vitest";
import { sendAccountEmail } from "../../app/features/auth/email.server";

describe("sendAccountEmail", () => {
  it("sends a verified account link through Resend", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
    await sendAccountEmail({ apiKey: "secret", from: "Re:Taste <account@example.com>", to: "user@example.com", purpose: "VERIFY_EMAIL", url: "https://example.com/verify-email?token=abc", fetcher });
    expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer secret" }),
    }));
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ from: "Re:Taste <account@example.com>", to: ["user@example.com"] });
    expect(body.html).toContain("https://example.com/verify-email?token=abc");
  });
});
