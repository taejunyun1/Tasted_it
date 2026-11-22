import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { guestSavedPlaces, guestTasteBadges, guestTasteSessions, oauthRequests, sessions, users } from "../../app/db/schema";
import { issueOAuthRequest } from "../../app/features/auth/oauth-request.server";
import { createGuestSession } from "../../app/features/onboarding/guest-session.server";
import { setGuestSavedPlace } from "../../app/features/onboarding/guest-saves.server";
import { loader as google } from "../../app/routes/auth-google";
import { loader as googleCallback } from "../../app/routes/auth-google-callback";
import { loader as naver } from "../../app/routes/auth-naver";
import { loader as naverCallback } from "../../app/routes/auth-naver-callback";

const providers = vi.hoisted(() => ({ configured: true, exchangeGoogle: vi.fn(), exchangeNaver: vi.fn() }));
vi.mock("cloudflare:workers", async (original) => {
  const actual = await original<typeof import("cloudflare:workers")>();
  return { ...actual, env: new Proxy(actual.env, { get(target, key, receiver) {
    if (["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NAVER_LOGIN_CLIENT_ID", "NAVER_LOGIN_CLIENT_SECRET"].includes(String(key))) {
      return providers.configured ? "synthetic-oauth-value" : undefined;
    }
    return Reflect.get(target, key, receiver);
  } }) };
});
vi.mock("../../app/features/auth/google-oauth.server", async (original) => ({
  ...await original<typeof import("../../app/features/auth/google-oauth.server")>(),
  exchangeGoogleCode: providers.exchangeGoogle,
}));
vi.mock("../../app/features/auth/naver-oauth.server", async (original) => ({
  ...await original<typeof import("../../app/features/auth/naver-oauth.server")>(),
  exchangeNaverCode: providers.exchangeNaver,
}));

const origin = "https://retaste.test";
const target = "/places?" + new URLSearchParams({
  q: "동명 라멘", bbox: "126.80,35.10,127.00,35.25", selected: "sample-place-1",
  place: "/places/sample-dongmyeong-ramen?sourceRail=TRUSTED&discoveryMode=QUALITY&recommendationRequestId=00000000-0000-4000-8000-000000000001",
});
const external = "https://example.invalid/elsewhere";

const boundaries = [
  { provider: "GOOGLE", path: "google", start: google, callback: googleCallback, exchange: providers.exchangeGoogle },
  { provider: "NAVER", path: "naver", start: naver, callback: naverCallback, exchange: providers.exchangeNaver },
] as const;

beforeEach(() => {
  providers.configured = true;
  providers.exchangeGoogle.mockReset().mockRejectedValue(new Error("synthetic OAuth exchange failure"));
  providers.exchangeNaver.mockReset().mockRejectedValue(new Error("synthetic OAuth exchange failure"));
});

async function start(boundary: typeof boundaries[number], returnTo = target) {
  const url = new URL("/auth/" + boundary.path, origin);
  url.searchParams.set("returnTo", returnTo);
  return boundary.start({ request: new Request(url) } as never);
}

async function pending(boundary: typeof boundaries[number]) {
  const response = await start(boundary);
  const authorizationUrl = new URL(response.headers.get("Location")!);
  const state = authorizationUrl.searchParams.get("state")!;
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0]!;
  const id = decodeURIComponent(cookie.split("=")[1]!);
  return { state, cookie, id };
}

async function finish(boundary: typeof boundaries[number], cookie: string, search: Record<string, string>, guestId?: string) {
  const url = new URL("/auth/" + boundary.path + "/callback", origin);
  url.search = new URLSearchParams({ ...search, returnTo: external }).toString();
  const headers = { Cookie: guestId ? cookie + "; retaste_guest=" + guestId : cookie };
  return boundary.callback({ request: new Request(url, { headers }) } as never) as Promise<Response>;
}

function assertFailure(response: Response, boundary: typeof boundaries[number], code: string, returnTo: string | null, destination = "/login") {
  expect(response.status).toBe(302);
  const url = new URL(response.headers.get("Location")!, origin);
  expect(url.origin).toBe(origin);
  expect(url.pathname).toBe(destination);
  expect(url.searchParams.get("oauthProvider")).toBe(boundary.provider === "NAVER" ? "naver" : null);
  expect(url.searchParams.get("oauthError")).toBe(code);
  expect(url.searchParams.get("returnTo")).toBe(returnTo);
}

async function signedIn(db: ReturnType<typeof createDb>) {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const now = new Date();
  await db.insert(users).values({
    id: userId, email: userId + "@example.test", displayName: "합성 회원", role: "USER",
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  await db.insert(sessions).values({
    id: sessionId, userId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600_000).toISOString(),
  });
  return { userId, sessionId, cookie: "retaste_session=" + sessionId };
}

async function guestFixture(db: ReturnType<typeof createDb>) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await createGuestSession(db, { id, now });
  await db.insert(guestTasteBadges).values({ sessionId: id, badgeId: "food-gukbap", selectedAt: now });
  const placeId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES (?,?,'합성 식당','PUBLISHED','광주 동구','동명',35.149,126.9232,'합성',?,?)")
    .bind(placeId, placeId, now, now).run();
  await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
  return { id, placeId };
}

for (const boundary of boundaries) {
  describe(boundary.provider + " login failure recovery", () => {
    it("keeps safe intent and labels the provider when start is unavailable", async () => {
      providers.configured = false;
      assertFailure(await start(boundary), boundary, "temporarily_unavailable", target);
      assertFailure(await start(boundary, external), boundary, "temporarily_unavailable", null);
      expect(boundary.exchange).not.toHaveBeenCalled();
    });

    it("retains validated intent on cancellation once while leaving guest data intact", async () => {
      const db = createDb(env.DB);
      const guest = await guestFixture(db);
      const request = await pending(boundary);
      const invalid = await finish(boundary, request.cookie, { state: "wrong-state", error: "access_denied" }, guest.id);
      assertFailure(invalid, boundary, "invalid_request", null);
      expect((await db.query.oauthRequests.findFirst({ where: eq(oauthRequests.id, request.id) }))?.consumedAt).toBeNull();

      const cancelled = await finish(boundary, request.cookie, { state: request.state, error: "access_denied" }, guest.id);
      assertFailure(cancelled, boundary, "cancelled", target);
      expect(cancelled.headers.get("Set-Cookie")).toContain("Max-Age=0");
      expect(cancelled.headers.get("Cache-Control")).toBe("private, no-store");
      expect(cancelled.headers.get("Set-Cookie")).not.toMatch(/retaste_(guest|session)=/);
      expect((await db.query.oauthRequests.findFirst({ where: eq(oauthRequests.id, request.id) }))?.consumedAt).not.toBeNull();
      assertFailure(await finish(boundary, request.cookie, { state: request.state, error: "access_denied" }, guest.id), boundary, "invalid_request", null);

      expect(await db.query.guestTasteSessions.findFirst({ where: eq(guestTasteSessions.id, guest.id) })).toMatchObject({ mergedUserId: null });
      expect(await db.query.guestTasteBadges.findMany({ where: eq(guestTasteBadges.sessionId, guest.id) })).toMatchObject([{ badgeId: "food-gukbap" }]);
      expect(await db.query.guestSavedPlaces.findMany({ where: eq(guestSavedPlaces.sessionId, guest.id) })).toMatchObject([{ placeId: guest.placeId }]);
      expect(boundary.exchange).not.toHaveBeenCalled();
    });

    it("does not recover an expired, absent or cross-provider request", async () => {
      const other = boundary.provider === "GOOGLE" ? boundaries[1] : boundaries[0];
      const db = createDb(env.DB);
      const request = await pending(boundary);
      const wrongProvider = await pending(other);
      const cookieName = request.cookie.split("=")[0]!;
      assertFailure(await finish(boundary, cookieName + "=" + wrongProvider.id, { state: wrongProvider.state, error: "access_denied" }), boundary, "invalid_request", null);
      assertFailure(await finish(boundary, "", { state: request.state, error: "access_denied" }), boundary, "invalid_request", null);
      await db.update(oauthRequests).set({ expiresAt: new Date(Date.now() - 60_000).toISOString() }).where(eq(oauthRequests.id, request.id));
      assertFailure(await finish(boundary, request.cookie, { state: request.state, error: "access_denied" }), boundary, "invalid_request", null);
      expect((await db.query.oauthRequests.findFirst({ where: eq(oauthRequests.id, request.id) }))?.consumedAt).toBeNull();
      expect(boundary.exchange).not.toHaveBeenCalled();
    });

    it("keeps intent if a callback cannot proceed before exchange", async () => {
      const missingCode = await pending(boundary);
      assertFailure(await finish(boundary, missingCode.cookie, { state: missingCode.state }), boundary, "invalid_request", target);
      const providerError = await pending(boundary);
      assertFailure(await finish(boundary, providerError.cookie, { state: providerError.state, error: "server_error" }), boundary, "temporarily_unavailable", target);
      const unavailable = await pending(boundary);
      providers.configured = false;
      assertFailure(await finish(boundary, unavailable.cookie, { state: unavailable.state, code: "synthetic-code" }), boundary, "temporarily_unavailable", target);
      expect(boundary.exchange).not.toHaveBeenCalled();
    });

    it("keeps intent if the mocked exchange fails after consumption", async () => {
      const request = await pending(boundary);
      const params = { state: request.state, code: "synthetic-code" };
      const response = await finish(boundary, request.cookie, params);
      assertFailure(response, boundary, "temporarily_unavailable", target);
      expect(response.headers.get("Set-Cookie")).not.toMatch(/retaste_(guest|session)=/);
      assertFailure(await finish(boundary, request.cookie, params), boundary, "invalid_request", null);
      expect(boundary.exchange).toHaveBeenCalledTimes(1);
    });
  });
}

it("keeps Naver connect cancellation on the account page", async () => {
  const db = createDb(env.DB);
  const boundary = boundaries[1];
  const member = await signedIn(db);
  const issued = await issueOAuthRequest(db, {
    provider: "NAVER", flow: "CONNECT", userId: member.userId, returnTo: "/me",
    codeVerifier: "synthetic-verifier", now: new Date(),
  });
  const response = await finish(boundary, member.cookie + "; retaste_naver_oauth=" + issued.id, { state: issued.state, error: "access_denied" });
  assertFailure(response, boundary, "cancelled", null, "/me");
  expect(boundary.exchange).not.toHaveBeenCalled();
});

it("keeps a signed-in Naver member on the account page after a missing or expired request", async () => {
  const db = createDb(env.DB);
  const boundary = boundaries[1];
  const member = await signedIn(db);
  const expired = await issueOAuthRequest(db, {
    provider: "NAVER", flow: "LOGIN", userId: null, returnTo: target,
    codeVerifier: "synthetic-verifier", now: new Date(Date.now() - 660_000),
  });
  const failureParams = { state: expired.state, error: "access_denied" };
  const unknown = await finish(boundary, member.cookie + "; retaste_naver_oauth=" + crypto.randomUUID(), failureParams);
  const missing = await finish(boundary, member.cookie, {});
  const expiredResponse = await finish(boundary, member.cookie + "; retaste_naver_oauth=" + expired.id, failureParams);
  for (const response of [unknown, missing, expiredResponse]) {
    assertFailure(response, boundary, "invalid_request", null, "/me");
    expect(response.headers.get("Set-Cookie")).not.toContain("retaste_session=");
  }
  expect((await db.query.oauthRequests.findFirst({ where: eq(oauthRequests.id, expired.id) }))?.consumedAt).toBeNull();
  expect(await db.query.sessions.findMany({ where: eq(sessions.userId, member.userId) })).toMatchObject([{ id: member.sessionId }]);
  expect(boundary.exchange).not.toHaveBeenCalled();
});
