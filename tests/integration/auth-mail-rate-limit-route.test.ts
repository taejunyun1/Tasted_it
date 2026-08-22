import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { action as forgotPasswordAction } from "../../app/routes/forgot-password";
import { action as placeCorrectionAction } from "../../app/routes/place-correction";
import { action as signupAction } from "../../app/routes/signup";
import { MAIL_RATE_LIMIT_MESSAGE } from "../../app/features/security/rate-limit.server";

function formRequest(url: string, fields: Record<string, string>, ip = "203.0.113.50") {
  const body = new URLSearchParams(fields);
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": ip,
      Origin: new URL(url).origin,
    },
    body,
  });
}

function denied(result: unknown, field: "message" | "error" = "message") {
  expect(result).toMatchObject({
    data: { [field]: MAIL_RATE_LIMIT_MESSAGE },
    init: {
      status: 429,
      headers: { "Retry-After": expect.stringMatching(/^[1-9]\d*$/) },
    },
  });
}

describe("unauthenticated mail route rate limits", () => {
  it("rejects a fourth password reset before issuing another token", async () => {
    const email = `reset-${crypto.randomUUID()}@example.com`;
    const now = "2026-08-14T12:00:00.000Z";
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, display_name, role, email_verified_at, created_at, updated_at) VALUES (?, ?, '회원', 'USER', ?, ?, ?)",
    ).bind(userId, email, now, now, now).run();

    for (let index = 0; index < 3; index += 1) {
      await forgotPasswordAction({ request: formRequest("https://retaste.test/forgot-password", { email }) } as never);
    }

    const fourth = await forgotPasswordAction({
      request: formRequest("https://retaste.test/forgot-password", { email }),
    } as never);
    denied(fourth);

    const tokens = await env.DB.prepare(
      "SELECT count(*) AS count FROM account_tokens WHERE user_id = ? AND purpose = 'RESET_PASSWORD'",
    ).bind(userId).first<{ count: number }>();
    expect(tokens?.count).toBe(3);
  });

  it("rejects a fourth signup before issuing another verification token", async () => {
    const email = `signup-${crypto.randomUUID()}@example.com`;
    const fields = { displayName: "테스터", email, password: "secure-password-123", ageConfirmed: "yes" };
    for (let index = 0; index < 3; index += 1) {
      await signupAction({ request: formRequest("https://retaste.test/signup", fields) } as never);
    }

    const fourth = await signupAction({
      request: formRequest("https://retaste.test/signup", fields),
    } as never);
    denied(fourth);

    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    expect(user?.id).toBeTruthy();
    const tokens = await env.DB.prepare(
      "SELECT count(*) AS count FROM account_tokens WHERE user_id = ? AND purpose = 'VERIFY_EMAIL'",
    ).bind(user!.id).first<{ count: number }>();
    expect(tokens?.count).toBe(3);
  });

  it("rejects a fourth place correction even when mail is unavailable", async () => {
    const email = `correct-${crypto.randomUUID()}@example.com`;
    const fields = {
      placeId: "",
      requestType: "OTHER",
      relation: "방문자",
      email,
      evidenceNote: "상호가 다릅니다.",
    };
    for (let index = 0; index < 3; index += 1) {
      await placeCorrectionAction({ request: formRequest("https://retaste.test/corrections", fields) } as never);
    }

    const fourth = await placeCorrectionAction({
      request: formRequest("https://retaste.test/corrections", fields),
    } as never);
    denied(fourth, "error");

    const requests = await env.DB.prepare("SELECT count(*) AS count FROM place_correction_requests WHERE requester_email = ?")
      .bind(email)
      .first<{ count: number }>();
    expect(requests?.count).toBe(0);
  });
});
