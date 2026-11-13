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

async function submit(fields: Record<string, string>, options: { session?: string | null; origin?: string; placeSlug?: string } = {}) {
  const placeSlug = options.placeSlug ?? slug;
  if (fields.intent === "withdraw" && !fields.expectedEventId) {
    const current = await env.DB.prepare("SELECT event_id FROM current_votes WHERE user_id=? AND place_id=?").bind(userId, placeSlug).first<{event_id:string}>();
    fields = { ...fields, expectedEventId: current?.event_id ?? "already-withdrawn" };
  }
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
    // Replaying an old pointer cannot affect a newer choice or append another event.
    expect(await submit({ intent: "withdraw" })).toMatchObject({ status: 409 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM vote_events WHERE user_id=? AND place_id=? AND event_type='WITHDRAW'").bind(userId, slug).first()).toEqual({ n: 1 });
  });

  it("removes withdrawn inferred taste while preserving manually selected taste", async () => {
    await env.DB.prepare("INSERT INTO user_taste_badges(user_id,badge_id,source,score,evidence_json,created_at,updated_at) VALUES(?,'food-gukbap','USER',0.9,'{}',?,?)")
      .bind(userId, now, now).run();
    await submit({ intent: "vote", value: "1" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM user_taste_badges WHERE user_id=? AND source='INFERRED'").bind(userId).first<{ n: number }>())!.n).toBeGreaterThan(0);
    await submit({ intent: "withdraw" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM user_taste_badges WHERE user_id=? AND source='INFERRED'").bind(userId).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT score FROM user_taste_badges WHERE user_id=? AND source='USER'").bind(userId).first()).toEqual({ score: 0.9 });
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
  it("rejects a stale displayed event pointer while preserving the newer vote and feedback", async () => {
    await submit({ intent: "vote", value: "1" });
    const previous = await env.DB.prepare("SELECT event_id FROM current_votes WHERE user_id=? AND place_id=?").bind(userId, slug).first<{event_id:string}>();
    await submit({ intent: "vote", value: "-1", reason: "MENU" });
    expect(await submit({ intent: "withdraw", expectedEventId: previous!.event_id })).toMatchObject({ status: 409 });
    expect(await value()).toEqual({ value: -1 });
    expect(await env.DB.prepare("SELECT value,reason FROM recommendation_feedback WHERE user_id=? AND place_id=?").bind(userId,slug).first()).toEqual({ value:-1,reason:"MENU" });
  });

  it("rolls back vote and event creation if the feedback write fails", async () => {
    await env.DB.exec("CREATE TRIGGER fail_feedback_insert BEFORE INSERT ON recommendation_feedback BEGIN SELECT RAISE(ABORT, 'synthetic insert failure'); END;");
    try {
      await expect(submit({ intent: "vote", value: "1" })).rejects.toBeDefined();
      expect(await value()).toBeNull();
      expect(await env.DB.prepare("SELECT count(*) n FROM vote_events WHERE user_id=? AND place_id=?").bind(userId,slug).first()).toEqual({n:0});
    } finally { await env.DB.exec("DROP TRIGGER fail_feedback_insert"); }
  });

  it("invalidates old inferred preference in the withdrawal batch even if rebuilding fails",async()=>{
    await submit({intent:"vote",value:"1"});
    const {createDb}=await import("../../app/db/client.server");
    const {getMemberTasteProfile}=await import("../../app/features/members/profile-taste.server");
    const db=createDb(env.DB);
    expect((await getMemberTasteProfile(db,{userId,displayName:"합성",saved:[],rated:[],tasteGraph:{status:"LEARNING",placeCount:0,dimensions:[]}})).vector.length>0).toBe(true);
    await env.DB.exec("CREATE TRIGGER fail_taste_refresh BEFORE UPDATE ON taste_learning_states WHEN NEW.version_token<>OLD.version_token BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM current_votes WHERE user_id=NEW.user_id) AND EXISTS(SELECT 1 FROM user_taste_badges WHERE user_id=NEW.user_id AND source='INFERRED' AND json_extract(evidence_json,'$.versionToken')<>OLD.version_token) THEN RAISE(ABORT,'synthetic refresh failure') END; END;");
    try {expect(await submit({intent:"withdraw"})).toEqual({ok:true});}
    finally {await env.DB.exec("DROP TRIGGER fail_taste_refresh");}
    expect(await value()).toBeNull();
    expect((await getMemberTasteProfile(db,{userId,displayName:"합성",saved:[],rated:[],tasteGraph:{status:"LEARNING",placeCount:0,dimensions:[]}})).vector.length>0).toBe(false);
  });

});
