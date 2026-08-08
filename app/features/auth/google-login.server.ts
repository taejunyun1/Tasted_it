import type {
  GoogleAccountInput,
  GoogleAccountResult,
} from "./google-account.server";
import type { GoogleJwtVerifier } from "./google-oauth.server";

interface CompleteGoogleLoginDependencies {
  consumeRequest(input: {
    id: string;
    state: string;
    now: Date;
  }): Promise<{ nonce: string; returnTo: string }>;
  exchangeCode(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<{ idToken: string }>;
  verifyIdToken(
    input: {
      idToken: string;
      clientId: string;
      nonce: string;
      now: Date;
    },
    verifier?: GoogleJwtVerifier,
  ): Promise<{
    subject: string;
    email: string;
    emailVerified: true;
    displayName: string;
  }>;
  resolveAccount(input: GoogleAccountInput): Promise<GoogleAccountResult>;
}

interface CompleteGoogleLoginInput {
  requestId: string;
  state: string;
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  adminEmail?: string;
  now: Date;
}

export type OAuthFailureCode =
  | "invalid_request"
  | "unverified_email"
  | "temporarily_unavailable";

export function oauthFailureCode(error: unknown): OAuthFailureCode {
  if (error instanceof Error && error.message === "OAUTH_REQUEST_INVALID") {
    return "invalid_request";
  }
  if (error instanceof Error && error.message === "GOOGLE_EMAIL_UNVERIFIED") {
    return "unverified_email";
  }
  return "temporarily_unavailable";
}

export async function completeGoogleLogin(
  dependencies: CompleteGoogleLoginDependencies,
  input: CompleteGoogleLoginInput,
) {
  const request = await dependencies.consumeRequest({
    id: input.requestId,
    state: input.state,
    now: input.now,
  });
  const token = await dependencies.exchangeCode({
    code: input.code,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
  });
  const identity = await dependencies.verifyIdToken({
    idToken: token.idToken,
    clientId: input.clientId,
    nonce: request.nonce,
    now: input.now,
  });
  const account = await dependencies.resolveAccount({
    providerSubject: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified,
    displayName: identity.displayName,
    adminEmail: input.adminEmail,
    now: input.now,
  });

  return { ...account, returnTo: request.returnTo };
}
