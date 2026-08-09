import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { users } from "../../app/db/schema";
import {
  consumeOAuthRequest,
  issueOAuthRequest,
} from "../../app/features/auth/oauth-request.server";

describe("provider-aware OAuth request state", () => {
  it("binds a Naver PKCE request to provider, flow, and user exactly once", async () => {
    const db = createDb(env.DB);
    const now = new Date("2026-08-09T00:00:00.000Z");
    await db.insert(users).values({
      id: "member-1",
      email: `oauth-${crypto.randomUUID()}@example.com`,
      displayName: "연결 회원",
      role: "USER",
      passwordHash: "hash",
      passwordSalt: "salt",
      emailVerifiedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const issued = await issueOAuthRequest(db, {
      provider: "NAVER",
      flow: "CONNECT",
      userId: "member-1",
      returnTo: "/me",
      codeVerifier: "verifier-1",
      now,
    });

    await expect(
      consumeOAuthRequest(db, {
        id: issued.id,
        state: issued.state,
        provider: "GOOGLE",
        flow: "CONNECT",
        now: new Date(now.getTime() + 1_000),
      }),
    ).rejects.toThrow("OAUTH_REQUEST_INVALID");

    const consumed = await consumeOAuthRequest(db, {
      id: issued.id,
      state: issued.state,
      provider: "NAVER",
      flow: "CONNECT",
      now: new Date(now.getTime() + 2_000),
    });
    expect(consumed).toEqual({
      nonce: issued.nonce,
      returnTo: "/me",
      codeVerifier: "verifier-1",
      userId: "member-1",
      provider: "NAVER",
      flow: "CONNECT",
    });

    await expect(
      consumeOAuthRequest(db, {
        id: issued.id,
        state: issued.state,
        provider: "NAVER",
        flow: "CONNECT",
        now: new Date(now.getTime() + 3_000),
      }),
    ).rejects.toThrow("OAUTH_REQUEST_INVALID");
  });

  it("rejects an expired request", async () => {
    const db = createDb(env.DB);
    const now = new Date("2026-08-09T00:20:00.000Z");
    const issued = await issueOAuthRequest(db, {
      provider: "NAVER",
      flow: "LOGIN",
      userId: null,
      returnTo: "/",
      codeVerifier: "verifier-2",
      now,
    });

    await expect(
      consumeOAuthRequest(db, {
        id: issued.id,
        state: issued.state,
        provider: "NAVER",
        flow: "LOGIN",
        now: new Date(now.getTime() + 10 * 60 * 1_000 + 1),
      }),
    ).rejects.toThrow("OAUTH_REQUEST_INVALID");
  });
});
