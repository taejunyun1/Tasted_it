import { describe, expect, it, vi } from "vitest";
import {
  sendAccountEmail,
  sendGoogleWelcomeEmail,
  sendGoogleWelcomeIfNeeded,
} from "../../app/features/auth/email.server";

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

  it("sends an escaped welcome email without a verification link", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ id: "email-welcome" }), { status: 200 }),
    );

    const result = await sendGoogleWelcomeEmail({
      apiKey: "secret",
      from: "Re:Taste <account@example.com>",
      to: "new@example.com",
      displayName: '<script>alert("x")</script>',
      appBaseUrl: "https://example.com/",
      fetcher,
    });

    expect(result).toEqual({ id: "email-welcome" });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      from: "Re:Taste <account@example.com>",
      to: ["new@example.com"],
      subject: "Re:Taste에 오신 것을 환영합니다",
    });
    expect(body.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("https://example.com/courses");
    expect(body.html).not.toContain("30분");
  });

  it("sends the Google welcome email only for a new account", async () => {
    const sender = vi.fn(async () => ({ id: "welcome-1" }));
    const common = {
      apiKey: "secret",
      from: "Re:Taste <account@example.com>",
      to: "member@example.com",
      displayName: "회원",
      appBaseUrl: "https://example.com",
      sender,
    };

    await expect(
      sendGoogleWelcomeIfNeeded({ ...common, isNewUser: false }),
    ).resolves.toBe(false);
    await expect(
      sendGoogleWelcomeIfNeeded({ ...common, isNewUser: true }),
    ).resolves.toBe(true);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("keeps login successful when the welcome email fails", async () => {
    const onError = vi.fn();
    const sender = vi.fn(async () => {
      throw new Error("RESEND_SEND_FAILED:500");
    });

    await expect(
      sendGoogleWelcomeIfNeeded({
        isNewUser: true,
        apiKey: "secret",
        from: "Re:Taste <account@example.com>",
        to: "member@example.com",
        displayName: "회원",
        appBaseUrl: "https://example.com",
        sender,
        onError,
      }),
    ).resolves.toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });
});
