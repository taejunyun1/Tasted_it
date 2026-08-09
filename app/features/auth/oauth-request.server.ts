import { and, eq, gt, isNull, lte } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { oauthRequests } from "../../db/schema";
import { newOAuthValue, sha256Hex } from "./google-oauth.server";

const OAUTH_REQUEST_TTL_MS = 10 * 60 * 1_000;

export type OAuthProvider = "GOOGLE" | "NAVER";
export type OAuthFlow = "LOGIN" | "CONNECT" | "DISCONNECT";

export async function issueOAuthRequest(
  db: AppDb,
  input: {
    provider: OAuthProvider;
    flow: OAuthFlow;
    userId: string | null;
    returnTo: string;
    codeVerifier?: string | null;
    now: Date;
  },
) {
  await db
    .delete(oauthRequests)
    .where(lte(oauthRequests.expiresAt, input.now.toISOString()));

  const id = crypto.randomUUID();
  const state = newOAuthValue();
  const nonce = newOAuthValue();
  await db.insert(oauthRequests).values({
    id,
    provider: input.provider,
    flow: input.flow,
    userId: input.userId,
    stateHash: await sha256Hex(state),
    nonce,
    codeVerifier: input.codeVerifier ?? null,
    returnTo: input.returnTo,
    expiresAt: new Date(
      input.now.getTime() + OAUTH_REQUEST_TTL_MS,
    ).toISOString(),
    consumedAt: null,
    createdAt: input.now.toISOString(),
  });

  return { id, state, nonce, returnTo: input.returnTo };
}

export async function consumeOAuthRequest(
  db: AppDb,
  input: {
    id: string;
    state: string;
    provider: OAuthProvider;
    flow: OAuthFlow;
    now: Date;
  },
) {
  const now = input.now.toISOString();
  const row = await db.query.oauthRequests.findFirst({
    where: and(
      eq(oauthRequests.id, input.id),
      eq(oauthRequests.provider, input.provider),
      eq(oauthRequests.flow, input.flow),
      eq(oauthRequests.stateHash, await sha256Hex(input.state)),
      isNull(oauthRequests.consumedAt),
      gt(oauthRequests.expiresAt, now),
    ),
  });
  if (!row) throw new Error("OAUTH_REQUEST_INVALID");

  const consumed = await db
    .update(oauthRequests)
    .set({ consumedAt: now, codeVerifier: null })
    .where(
      and(
        eq(oauthRequests.id, row.id),
        isNull(oauthRequests.consumedAt),
        gt(oauthRequests.expiresAt, now),
      ),
    )
    .run();
  if (consumed.meta.changes !== 1) throw new Error("OAUTH_REQUEST_INVALID");

  return {
    nonce: row.nonce,
    returnTo: row.returnTo,
    codeVerifier: row.codeVerifier,
    userId: row.userId,
    provider: row.provider,
    flow: row.flow,
  };
}
