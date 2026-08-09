import type {
  NaverAccountInput,
  NaverAccountResult,
} from "./naver-account.server";

type Flow = "LOGIN" | "CONNECT" | "DISCONNECT";

interface Dependencies {
  consumeRequest(input: {
    id: string;
    state: string;
    provider: "NAVER";
    now: Date;
  }): Promise<{
    nonce: string;
    returnTo: string;
    codeVerifier: string | null;
    userId: string | null;
    provider: "GOOGLE" | "NAVER";
    flow: Flow;
  }>;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<{ idToken: string; accessToken: string }>;
  verifyIdToken(input: {
    idToken: string;
    clientId: string;
    nonce: string;
    now: Date;
  }): Promise<{ subject: string }>;
  fetchProfile(input: {
    accessToken: string;
    expectedSubject: string;
  }): Promise<{ subject: string; email: string; displayName: string }>;
  resolveLogin(input: NaverAccountInput): Promise<NaverAccountResult>;
  connectIdentity(input: {
    userId: string;
    providerSubject: string;
    email: string;
    now: Date;
  }): Promise<void>;
  disconnectIdentity(input: {
    userId: string;
    providerSubject: string;
    revoke: () => Promise<void>;
  }): Promise<void>;
  revokeToken(input: {
    accessToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<void>;
}

interface CompleteInput {
  requestId: string;
  state: string;
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  adminEmail?: string;
  now: Date;
}

export type NaverFailureCode =
  | "invalid_request"
  | "email_required"
  | "existing_account"
  | "identity_conflict"
  | "last_login_method"
  | "temporarily_unavailable";

export function naverFailureCode(error: unknown): NaverFailureCode {
  if (!(error instanceof Error)) return "temporarily_unavailable";
  const codes: Record<string, NaverFailureCode> = {
    OAUTH_REQUEST_INVALID: "invalid_request",
    NAVER_EMAIL_REQUIRED: "email_required",
    NAVER_EXISTING_ACCOUNT_LOGIN_REQUIRED: "existing_account",
    NAVER_IDENTITY_CONFLICT: "identity_conflict",
    NAVER_LAST_LOGIN_METHOD: "last_login_method",
  };
  return codes[error.message] ?? "temporarily_unavailable";
}

export async function completeNaverFlow(
  dependencies: Dependencies,
  input: CompleteInput,
) {
  const request = await dependencies.consumeRequest({
    id: input.requestId,
    state: input.state,
    provider: "NAVER",
    now: input.now,
  });
  if (!request.codeVerifier) throw new Error("OAUTH_REQUEST_INVALID");

  const token = await dependencies.exchangeCode({
    code: input.code,
    codeVerifier: request.codeVerifier,
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
  const profile = await dependencies.fetchProfile({
    accessToken: token.accessToken,
    expectedSubject: identity.subject,
  });

  if (request.flow === "LOGIN") {
    const account = await dependencies.resolveLogin({
      providerSubject: profile.subject,
      email: profile.email,
      displayName: profile.displayName,
      adminEmail: input.adminEmail,
      now: input.now,
    });
    return { flow: "LOGIN" as const, ...account, returnTo: request.returnTo };
  }
  if (!request.userId) throw new Error("OAUTH_REQUEST_INVALID");

  if (request.flow === "CONNECT") {
    await dependencies.connectIdentity({
      userId: request.userId,
      providerSubject: profile.subject,
      email: profile.email,
      now: input.now,
    });
    return { flow: "CONNECT" as const, userId: request.userId, returnTo: request.returnTo };
  }

  await dependencies.disconnectIdentity({
    userId: request.userId,
    providerSubject: profile.subject,
    revoke: () =>
      dependencies.revokeToken({
        accessToken: token.accessToken,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      }),
  });
  return { flow: "DISCONNECT" as const, userId: request.userId, returnTo: request.returnTo };
}
