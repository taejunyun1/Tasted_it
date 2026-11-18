import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { action, loader } from "../../app/routes/guest-saves-resource";
import { createDb } from "../../app/db/client.server";
import { users } from "../../app/db/schema";
import { upsertPlace } from "../../app/features/places/place.server";
import { createGuestSession } from "../../app/features/onboarding/guest-session.server";
import { setGuestSavedPlace } from "../../app/features/onboarding/guest-saves.server";
import { mergeGuestTasteSessionFromRequest } from "../../app/features/onboarding/guest-merge.server";

const url = "https://example.test/resources/guest-saves";
function req(body: string, cookie?: string, origin = "https://example.test") {
  return new Request(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) }, body });
}
async function place() {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO categories (id,slug,name,emoji,sort_order,created_at,updated_at) VALUES ('guest-save-category','guest-save-category','한식','밥',1,?,?)").bind(now, now).run();
  await upsertPlace(createDb(env.DB), { id, now, row: { slug: id, name: "합성 음식점", status: "PUBLISHED", address: "광주 동구", neighborhood: "동명", latitude: 35.149, longitude: 126.9232, primaryCategory: "guest-save-category", phone: null, parkingSummary: null, heroImageUrl: null, kakaoPlaceId: null, searchText: "합성" } });
  return id;
}
function privateResponse(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  expect(response.headers.get("Vary")).toBe("Cookie");
}

describe("guest save resource boundaries", () => {
  it("rejects cross origin, duplicate/unknown fields and streamed oversized forms before any session write", async () => {
    for (const [request, status] of [
      [req("intent=save&placeId=a&saved=true", undefined, "https://attacker.test"), 403],
      [req("intent=save&placeId=a&saved=true&placeId=b"), 400],
      [req("intent=save&placeId=a&saved=true&sessionId=other"), 400],
      [req(`intent=save&placeId=${"a".repeat(1200)}&saved=true`), 413],
    ] as const) {
      const response = await action({ request } as never);
      expect(response.status).toBe(status); privateResponse(response);
      expect(await response.json()).toMatchObject({ ok: false, outcome: "REJECTED" });
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
  });
  it("creates only an opaque own cookie on save and reloads own state without mutating on GET", async () => {
    const placeId = await place();
    const before = await loader({ request: new Request(`${url}?placeId=${placeId}`) } as never);
    expect(await before.json()).toMatchObject({ ok: true, saved: false });
    expect(before.headers.get("Set-Cookie")).toBeNull();
    const saved = await action({ request: req(`intent=save&placeId=${placeId}&saved=true`) } as never);
    expect(await saved.json()).toMatchObject({ ok: true, saved: true, signedIn: false }); privateResponse(saved);
    const cookie = saved.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Lax");
    const restored = await loader({ request: new Request(`${url}?placeId=${placeId}`, { headers: { Cookie: cookie.split(";")[0] } }) } as never);
    expect(await restored.json()).toMatchObject({ saved: true }); privateResponse(restored);
    const unrelated = await loader({ request: new Request(`${url}?placeId=${placeId}`, { headers: { Cookie: "retaste_guest=unrelated" } }) } as never);
    expect(await unrelated.json()).toMatchObject({ saved: false, expired: true });
  });
  it("requires login for merge and keeps guest data available after rejection", async () => {
    const db = createDb(env.DB), id = crypto.randomUUID(), now = new Date().toISOString(), placeId = await place();
    await createGuestSession(db, { id, now });
    await setGuestSavedPlace(db, { sessionId: id, placeId, saved: true, now });
    const response = await action({ request: req("intent=merge", `retaste_guest=${id}`) } as never);
    expect(response.status).toBe(401); privateResponse(response);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect((await env.DB.prepare("SELECT count(*) n FROM guest_saved_places WHERE session_id=?").bind(id).first<{n: number}>())?.n).toBe(1);
  });
  it("rejects saving nonpublic places without creating a guest cookie", async () => {
    const placeId = await place();
    await env.DB.prepare("UPDATE places SET status='HIDDEN' WHERE id=?").bind(placeId).run();
    const response = await action({ request: req(`intent=save&placeId=${placeId}&saved=true`) } as never);
    expect(response.status).toBe(404); privateResponse(response);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("guest save transport recovery", () => {
  it("keeps a post-delete session race unknown even when the response is 409", async () => {
    const db = createDb(env.DB), now = new Date().toISOString();
    const guestId = crypto.randomUUID(), placeId = await place();
    await createGuestSession(db, { id: guestId, now });
    await setGuestSavedPlace(db, { sessionId: guestId, placeId, saved: true, now });
    const trigger = `guest_save_expire_${guestId.replaceAll("-", "")}`;
    await env.DB.exec(`CREATE TRIGGER ${trigger} AFTER DELETE ON guest_saved_places WHEN OLD.session_id='${guestId}' BEGIN UPDATE guest_taste_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=OLD.session_id; END;`);
    try {
      const response = await action({ request: req(`intent=save&placeId=${placeId}&saved=false`, `retaste_guest=${guestId}`) } as never);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ ok: false, outcome: "UNKNOWN" });
      expect((await env.DB.prepare("SELECT count(*) n FROM guest_saved_places WHERE session_id=? AND place_id=?").bind(guestId, placeId).first<{n: number}>())?.n).toBe(0);
      const current = await loader({ request: new Request(`${url}?placeId=${placeId}`, { headers: { Cookie: `retaste_guest=${guestId}` } }) } as never);
      expect(await current.json()).toMatchObject({ ok: true, saved: false, expired: true });
    } finally {
      await env.DB.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    }
  });

  it("marks lost write responses unknown without replaying the write", async () => {
    const { clientAction, clientLoader } = await import("../../app/routes/guest-saves-resource");
    let writes = 0;
    const serverAction = async () => { writes++; throw new TypeError("synthetic network failure"); };
    expect(await clientAction({ serverAction } as never)).toMatchObject({ ok: false, outcome: "UNKNOWN", message: expect.stringContaining("다시 확인") });
    expect(writes).toBe(1);
    expect(await clientLoader({ serverLoader: serverAction } as never)).toMatchObject({ ok: false });
  });
  it("reports an unknown result when a merge commits before its response is lost", async () => {
    const { clientAction } = await import("../../app/routes/guest-saves-resource");
    const db = createDb(env.DB), now = new Date().toISOString();
    const guestId = crypto.randomUUID(), userId = crypto.randomUUID(), placeId = await place();
    await db.insert(users).values({ id: userId, email: `${userId}@example.test`, displayName: "합성 사용자", role: "USER", createdAt: now, updatedAt: now });
    await createGuestSession(db, { id: guestId, now });
    await setGuestSavedPlace(db, { sessionId: guestId, placeId, saved: true, now });
    const request = req("intent=merge", `retaste_guest=${guestId}`);
    const result = await clientAction({ serverAction: async () => {
      expect((await mergeGuestTasteSessionFromRequest(db, request, userId, now)).merged).toBe(true);
      throw new TypeError("synthetic response lost after commit");
    } } as never);
    expect(result).toMatchObject({ ok: false, outcome: "UNKNOWN", message: expect.stringContaining("다시 확인") });
    expect((await env.DB.prepare("SELECT count(*) n FROM saved_places WHERE user_id=? AND place_id=?").bind(userId, placeId).first<{n: number}>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) n FROM guest_saved_places WHERE session_id=?").bind(guestId).first<{n: number}>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT merged_user_id value FROM guest_taste_sessions WHERE id=?").bind(guestId).first<{value: string}>())?.value).toBe(userId);
    expect((await mergeGuestTasteSessionFromRequest(db, request, userId, now)).merged).toBe(false);
    expect((await env.DB.prepare("SELECT count(*) n FROM saved_places WHERE user_id=? AND place_id=?").bind(userId, placeId).first<{n: number}>())?.n).toBe(1);
  });
});
