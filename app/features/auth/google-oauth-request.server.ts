import { and, eq, gt, isNull, lte } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { oauthRequests } from "../../db/schema";
import { newOAuthValue, sha256Hex } from "./google-oauth.server";

const OAUTH_REQUEST_TTL_MS = 10 * 60 * 1_000;

export async function issueGoogleOAuthRequest(
  db: AppDb,
  input: { returnTo: string; now: Date },
) {
  await db
    .delete(oauthRequests)
    .where(lte(oauthRequests.expiresAt, input.now.toISOString()));

  const id = crypto.randomUUID();
  const state = newOAuthValue();
  const nonce = newOAuthValue();
  await db.insert(oauthRequests).values({
    id,
    stateHash: await sha256Hex(state),
    nonce,
    returnTo: input.returnTo,
    expiresAt: new Date(
      input.now.getTime() + OAUTH_REQUEST_TTL_MS,
    ).toISOString(),
    consumedAt: null,
    createdAt: input.now.toISOString(),
  });

  return { id, state, nonce, returnTo: input.returnTo };
}

export async function consumeGoogleOAuthRequest(
  db: AppDb,
  input: { id: string; state: string; now: Date },
) {
  const now = input.now.toISOString();
  const row = await db.query.oauthRequests.findFirst({
    where: and(
      eq(oauthRequests.id, input.id),
      eq(oauthRequests.stateHash, await sha256Hex(input.state)),
      isNull(oauthRequests.consumedAt),
      gt(oauthRequests.expiresAt, now),
    ),
  });
  if (!row) throw new Error("OAUTH_REQUEST_INVALID");

  const consumed = await db
    .update(oauthRequests)
    .set({ consumedAt: now })
    .where(
      and(
        eq(oauthRequests.id, row.id),
        isNull(oauthRequests.consumedAt),
        gt(oauthRequests.expiresAt, now),
      ),
    )
    .run();
  if (consumed.meta.changes !== 1) throw new Error("OAUTH_REQUEST_INVALID");

  return { nonce: row.nonce, returnTo: row.returnTo };
}
