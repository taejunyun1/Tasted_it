import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { action } from "../../app/routes/place-detail";

let userId: string;
let otherUserId: string;
let sid: string;
let slug: string;
let otherSlug: string;
const now = "2026-11-13T00:00:00Z";

beforeEach(async () => {
  userId = crypto.randomUUID();
  otherUserId = crypto.randomUUID();
  sid = crypto.randomUUID();
  slug = `vote-route-${crypto.randomUUID()}`;
  otherSlug = `${slug}-other`;
  const categoryId = `${slug}-category`;
  for (const id of [userId, otherUserId]) {
    await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'USER',?,?)")
      .bind(id, `${id}@example.test`, "합성 사용자", now, now).run();
  }
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,'2099-01-01T00:00:00Z',?)").bind(sid, userId, now).run();
  await env.DB.prepare("INSERT INTO categories(id,slug,name,emoji,sort_order,created_at,updated_at) VALUES(?,?,?,'🍲',1,?,?)")
    .bind(categoryId, categoryId, "국밥·해장국", now, now).run();
  for (const id of [slug, otherSlug]) {
    await env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED','합성 주소','합성 동네',35.14,126.92,?,?,?)")
      .bind(id, id, "합성 국밥", "합성 국밥", now, now).run();
    await env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,?,1)").bind(id, categoryId).run();
  }
});

function submit(fields: Record<string, string>, options: { session?: string | null; origin?: string; placeSlug?: string } = {}) {
  const placeSlug = options.placeSlug ?? slug;
  const session = options.session === undefined ? sid : options.session;
  return action({
    request: new Request(`https://retaste.test/places/${placeSlug}`, {
      method: "POST",
      headers: { Origin: options.origin ?? "https://retaste.test", "Content-Type": "application/x-www-form-urlencoded", ...(session ? { Cookie: `retaste_session=${session}` } : {}) },
      body: new URLSearchParams(fields),
    }),
    params: { placeSlug },
  } as never);
}

async function value(id = userId, placeId = slug) {
  return env.DB.prepare("SELECT value FROM current_votes WHERE user_id=? AND place_id=?").bind(id, placeId).first<{ value: number }>();
}

async function seedFeedback(id: string, placeId: string) {
  await env.DB.prepare("INSERT INTO recommendation_feedback(user_id,place_id,value,reason,created_at,updated_at) VALUES(?,?,1,NULL,?,?)")
    .bind(id, placeId, now, now).run();
}

describe("public place vote withdrawal", () => {
  it("changes and withdraws only the signed-in user's vote, preserving saved places and other feedback", async () => {
    await seedFeedback(otherUserId, slug);
    await seedFeedback(userId, otherSlug);
    await env.DB.prepare("INSERT INTO saved_places(user_id,place_id,created_at) VALUES(?,?,?)").bind(userId, slug, now).run();
    await submit({ intent: "vote", value: "1" });
    expect(await value()).toEqual({ value: 1 });
    await submit({ intent: "vote", value: "-1", reason: "MENU" });
    expect(await value()).toEqual({ value: -1 });
    expect(await submit({ intent: "withdraw", userId: otherUserId, placeId: otherSlug })).toEqual({ ok: true });
    expect(await value()).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM recommendation_feedback WHERE user_id=? AND place_id=?").bind(userId, slug).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM recommendation_feedback WHERE user_id=? AND place_id=?").bind(otherUserId, slug).first()).toEqual({ n: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM recommendation_feedback WHERE user_id=? AND place_id=?").bind(userId, otherSlug).first()).toEqual({ n: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM saved_places WHERE user_id=? AND place_id=?").bind(userId, slug).first()).toEqual({ n: 1 });
    // A repeated request is an idempotent no-op, rather than a second WITHDRAW event.
    expect(await submit({ intent: "withdraw" })).toEqual({ ok: true });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM vote_events WHERE user_id=? AND place_id=? AND event_type='WITHDRAW'").bind(userId, slug).first()).toEqual({ n: 1 });
  });

  it("requires authentication and the current origin before changing a vote", async () => {
    await submit({ intent: "vote", value: "1" });
    await expect(submit({ intent: "withdraw" }, { session: null })).rejects.toMatchObject({ status: 302 });
    await expect(submit({ intent: "withdraw" }, { origin: "https://other.test" })).rejects.toMatchObject({ status: 403 });
    expect(await value()).toEqual({ value: 1 });
  });

  it("rejects unknown intents and hidden places without mutating their votes", async () => {
    await submit({ intent: "vote", value: "1" });
    await expect(submit({ intent: "withdraw-all" })).rejects.toMatchObject({ status: 400 });
    await env.DB.prepare("UPDATE places SET status='HIDDEN' WHERE id=?").bind(slug).run();
    await expect(submit({ intent: "withdraw" })).rejects.toMatchObject({ status: 404 });
    expect(await value()).toEqual({ value: 1 });
  });

  it("keeps the current vote on feedback deletion failure and succeeds when retried", async () => {
    await submit({ intent: "vote", value: "1" });
    await env.DB.exec("CREATE TRIGGER fail_feedback_delete BEFORE DELETE ON recommendation_feedback BEGIN SELECT RAISE(ABORT, 'synthetic deletion failure'); END;");
    try {
      await expect(submit({ intent: "withdraw" })).rejects.toBeDefined();
      expect(await value()).toEqual({ value: 1 });
    } finally {
      await env.DB.exec("DROP TRIGGER fail_feedback_delete");
    }
    expect(await submit({ intent: "withdraw" })).toEqual({ ok: true });
    expect(await value()).toBeNull();
  });
});
