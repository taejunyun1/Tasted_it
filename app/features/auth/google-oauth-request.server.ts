import type { AppDb } from "../../db/client.server";
import { consumeOAuthRequest, issueOAuthRequest } from "./oauth-request.server";

export async function issueGoogleOAuthRequest(
  db: AppDb,
  input: { returnTo: string; now: Date },
) {
  return issueOAuthRequest(db, {
    provider: "GOOGLE",
    flow: "LOGIN",
    userId: null,
    returnTo: input.returnTo,
    now: input.now,
  });
}

export async function consumeGoogleOAuthRequest(
  db: AppDb,
  input: { id: string; state: string; now: Date },
) {
  const row = await consumeOAuthRequest(db, {
    ...input,
    provider: "GOOGLE",
    flow: "LOGIN",
  });
  return { nonce: row.nonce, returnTo: row.returnTo };
}
