import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exchangeGoogle: vi.fn(), verifyGoogle: vi.fn(), exchangeNaver: vi.fn(), verifyNaver: vi.fn() }));
vi.mock("cloudflare:workers", async (original) => {
  const actual = await original<typeof import("cloudflare:workers")>();
  return { ...actual, env: new Proxy(actual.env, { get(target, property, receiver) {
    if (["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NAVER_LOGIN_CLIENT_ID", "NAVER_LOGIN_CLIENT_SECRET"].includes(String(property))) return "synthetic-oauth-value";
    return Reflect.get(target, property, receiver);
  } }) };
});
vi.mock("../../app/features/auth/google-oauth.server", async (original) => ({
  ...await original<typeof import("../../app/features/auth/google-oauth.server")>(),
  exchangeGoogleCode: mocks.exchangeGoogle, verifyGoogleIdToken: mocks.verifyGoogle,
}));
vi.mock("../../app/features/auth/naver-oauth.server", async (original) => ({
  ...await original<typeof import("../../app/features/auth/naver-oauth.server")>(),
  exchangeNaverCode: mocks.exchangeNaver, verifyNaverIdToken: mocks.verifyNaver,
}));
import { getAdminAssurance } from "../../app/features/auth/admin-assurance.server";
import { handleAdminOAuthReauth, startAdminOAuthReauth } from "../../app/features/auth/admin-reauth-oauth.server";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.exchangeGoogle.mockResolvedValue({ idToken: "synthetic-id-token" });
  mocks.exchangeNaver.mockResolvedValue({ idToken: "synthetic-id-token", accessToken: "synthetic-access-token" });
  mocks.verifyGoogle.mockResolvedValue({ subject: "linked-subject" });
  mocks.verifyNaver.mockResolvedValue({ subject: "linked-subject" });
});
async function challenge(provider: "GOOGLE" | "NAVER") {
  const now = new Date();
  const actorUserId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const subject = `linked-${actorUserId}`;
  mocks.verifyGoogle.mockResolvedValue({ subject });
  mocks.verifyNaver.mockResolvedValue({ subject });
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES (?,?,'Synthetic','ADMIN',?,?,?)")
    .bind(actorUserId, `${actorUserId}@example.test`, now.toISOString(), now.toISOString(), now.toISOString()).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES (?,?,?,?)").bind(sessionId, actorUserId, now.toISOString(), new Date(now.getTime() + 600_000).toISOString()).run();
  await env.DB.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_subject,provider_email,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), actorUserId, provider, subject, `${actorUserId}@example.test`, now.toISOString(), now.toISOString()).run();
  const response = await startAdminOAuthReauth(env.DB, { actorUserId, sessionId, now, provider, requestUrl: "https://retaste.test/admin/reauth", returnTo: "/admin/identities" });
  const url = new URL(response.headers.get("Location")!);
  const id = decodeURIComponent(response.headers.get("Set-Cookie")!.split(";")[0]!.split("=")[1]!);
  const request = (sid: string) => new Request(`https://retaste.test/auth/${provider.toLowerCase()}/callback?code=synthetic&state=${encodeURIComponent(url.searchParams.get("state")!)}`, { headers: { Cookie: `retaste_session=${sid}` } });
  return { actorUserId, sessionId, now, response, url, id, request };
}
describe("administrator OAuth callback isolation", () => {
  for (const provider of ["GOOGLE", "NAVER"] as const) {
    it(`${provider} requires the original session and linked identity and never creates a login session`, async () => {
      const flow = await challenge(provider);
      if (provider === "NAVER") expect(flow.url.searchParams.get("auth_type")).toBe("reauthenticate");
      else expect(flow.url.searchParams.get("claims")).toContain("auth_time");
      expect((await handleAdminOAuthReauth(flow.request("wrong-session"), flow.id, provider))?.headers.get("Location")).toContain("error=failed");
      expect(mocks.exchangeGoogle).not.toHaveBeenCalled();
      expect(mocks.exchangeNaver).not.toHaveBeenCalled();
      const result = await handleAdminOAuthReauth(flow.request(flow.sessionId), flow.id, provider);
      expect(result?.headers.get("Location")).toBe("/admin/identities");
      expect(result?.headers.get("Set-Cookie")).not.toContain("retaste_session=");
      expect((await getAdminAssurance(env.DB, { ...flow, now: new Date() }))?.method).toBe(provider);
      expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?").bind(flow.actorUserId).first<{count:number}>())?.count).toBe(1);
      expect((await handleAdminOAuthReauth(flow.request(flow.sessionId), flow.id, provider))?.headers.get("Location")).toContain("error=failed");
    });
  }
  it("refuses a different Google identity even with a valid provider response", async () => {
    const flow = await challenge("GOOGLE");
    mocks.verifyGoogle.mockResolvedValue({ subject: "other-subject" });
    expect((await handleAdminOAuthReauth(flow.request(flow.sessionId), flow.id, "GOOGLE"))?.headers.get("Location")).toContain("error=failed");
    expect(await getAdminAssurance(env.DB, { ...flow, now: new Date() })).toBeNull();
  });
});
