import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import {
  consumeGoogleOAuthRequest,
  issueGoogleOAuthRequest,
} from "../../app/features/auth/google-oauth-request.server";

describe("Google OAuth request state", () => {
  it("consumes a valid request exactly once", async () => {
    const db = createDb(env.DB);
    const now = new Date("2026-08-08T15:00:00.000Z");
    const issued = await issueGoogleOAuthRequest(db, {
      returnTo: "/courses?meal=1",
      now,
    });

    const consumed = await consumeGoogleOAuthRequest(db, {
      id: issued.id,
      state: issued.state,
      now: new Date(now.getTime() + 1_000),
    });

    expect(consumed).toEqual({
      nonce: issued.nonce,
      returnTo: "/courses?meal=1",
    });
    await expect(
      consumeGoogleOAuthRequest(db, {
        id: issued.id,
        state: issued.state,
        now: new Date(now.getTime() + 2_000),
      }),
    ).rejects.toThrow("OAUTH_REQUEST_INVALID");
  });

  it("rejects an incorrect state without consuming the valid request", async () => {
    const db = createDb(env.DB);
    const now = new Date("2026-08-08T15:10:00.000Z");
    const issued = await issueGoogleOAuthRequest(db, { returnTo: "/", now });

    await expect(
      consumeGoogleOAuthRequest(db, {
        id: issued.id,
        state: "wrong-state",
        now: new Date(now.getTime() + 1_000),
      }),
    ).rejects.toThrow("OAUTH_REQUEST_INVALID");

    await expect(
      consumeGoogleOAuthRequest(db, {
        id: issued.id,
        state: issued.state,
        now: new Date(now.getTime() + 2_000),
      }),
    ).resolves.toMatchObject({ nonce: issued.nonce });
  });

  it("rejects a request after ten minutes", async () => {
    const db = createDb(env.DB);
    const now = new Date("2026-08-08T15:20:00.000Z");
    const issued = await issueGoogleOAuthRequest(db, { returnTo: "/", now });

    await expect(
      consumeGoogleOAuthRequest(db, {
        id: issued.id,
        state: issued.state,
        now: new Date(now.getTime() + 10 * 60 * 1_000 + 1),
      }),
    ).rejects.toThrow("OAUTH_REQUEST_INVALID");
  });
});
