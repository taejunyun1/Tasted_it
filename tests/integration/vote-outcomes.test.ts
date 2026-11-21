import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { action } from "../../app/routes/place-detail";
import { createDb } from "../../app/db/client.server";
import { castVote, getCurrentVoteState } from "../../app/features/ratings/vote.server";
import { scanVoteIntegrity } from "../../app/features/ratings/integrity.server";

it("keeps same-value reason edits out of vote history and integrity signals", async () => {
  const id = `vote-outcomes-${crypto.randomUUID()}`, now = "2026-11-18T00:00:00Z";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'USER',?,?)").bind(id, `${id}@example.test`, "합성 회원", now, now),
    env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,'2099-01-01T00:00:00Z',?)").bind(id, id, now),
    env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED','합성 주소','합성동',35.15,126.92,?,?,?)").bind(id, id, "합성 투표 식당", "합성 투표 식당", now, now),
    env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,'cat-ramen',1)").bind(id),
  ]);
  async function vote(value: string, reason?: string) {
    return action({ request: new Request(`https://retaste.test/places/${id}`, {
      method: "POST", headers: { Origin: "https://retaste.test", Cookie: `retaste_session=${id}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ intent: "vote", value, ...(reason ? { reason } : {}) }),
    }), params: { placeSlug: id } } as never);
  }
  async function events() { return env.DB.prepare("SELECT event_type,value FROM vote_events WHERE user_id=? AND place_id=? ORDER BY rowid").bind(id, id).all(); }
  await vote("1"); await vote("1");
  expect((await events()).results).toEqual([{ event_type: "CREATE", value: 1 }]);
  await vote("-1", "MENU"); await vote("-1", "MENU");
  expect((await events()).results).toHaveLength(2);
  const before = await env.DB.prepare("SELECT event_id FROM current_votes WHERE user_id=? AND place_id=?").bind(id, id).first();
  const revision = await env.DB.prepare("SELECT vote_revision FROM places WHERE id=?").bind(id).first();
  const version = await env.DB.prepare("SELECT version_token FROM taste_learning_states WHERE user_id=?").bind(id).first();
  for (const reason of ["PRICE", "MENU", "PRICE", "DISTANCE", "ATMOSPHERE", "PRICE"]) await vote("-1", reason);
  expect((await events()).results).toEqual([
    { event_type: "CREATE", value: 1 }, { event_type: "CHANGE", value: -1 },
  ]);
  expect(await env.DB.prepare("SELECT event_id FROM current_votes WHERE user_id=? AND place_id=?").bind(id, id).first()).toEqual(before);
  expect(await env.DB.prepare("SELECT vote_revision FROM places WHERE id=?").bind(id).first()).toEqual(revision);
  expect(await env.DB.prepare("SELECT version_token FROM taste_learning_states WHERE user_id=?").bind(id).first()).not.toEqual(version);
  await scanVoteIntegrity(createDb(env.DB), { now: new Date().toISOString() });
  expect(await env.DB.prepare("SELECT count(*) AS total FROM integrity_cases WHERE subject_id=?").bind(id).first()).toEqual({ total: 0 });
  expect(await env.DB.prepare("SELECT count(*) AS total,value FROM current_votes WHERE user_id=? AND place_id=?").bind(id, id).first()).toEqual({ total: 1, value: -1 });
  expect(await env.DB.prepare("SELECT reason FROM recommendation_feedback WHERE user_id=? AND place_id=?").bind(id, id).first()).toEqual({ reason: "PRICE" });
});

async function isolatedVote() {
  const id = `vote-outcomes-${crypto.randomUUID()}`, now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'USER',?,?)").bind(id, `${id}@example.test`, "합성 회원", now, now),
    env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED','합성 주소','합성동',35.15,126.92,?,?,?)").bind(id, id, "합성 식당", "합성 식당", now, now),
  ]);
  const db = createDb(env.DB);
  await castVote(db, { placeId: id, userId: id, value: -1, eventId: `${id}-first`, now, feedback: { reason: "MENU" } });
  return { db, id, now };
}

it("preserves a newer vote when a feedback-only update loses the current pointer", async () => {
  const { db, id, now } = await isolatedVote();
  const batch = db.batch.bind(db); let intercept = true;
  const concurrent = new Proxy(db, { get(target, key) {
    if (key === "batch") return async (statements: Parameters<typeof db.batch>[0]) => {
      if (intercept) {
        intercept = false;
        await castVote(db, { placeId: id, userId: id, value: 1, eventId: `${id}-new`, now, feedback: { reason: null } });
      }
      return batch(statements);
    };
    return Reflect.get(target, key);
  } });
  await expect(castVote(concurrent, { placeId: id, userId: id, value: -1, eventId: `${id}-stale`, now, feedback: { reason: "PRICE" } })).rejects.toThrow("VOTE_VERSION_CONFLICT");
  expect(await getCurrentVoteState(db, { placeId: id, userId: id })).toEqual({ value: 1, eventId: `${id}-new` });
  expect(await env.DB.prepare("SELECT value,reason FROM recommendation_feedback WHERE user_id=?").bind(id).first()).toEqual({ value: 1, reason: null });
  expect(await env.DB.prepare("SELECT count(*) AS total FROM vote_events WHERE id=?").bind(`${id}-stale`).first()).toEqual({ total: 0 });
});

it("allows a fresh choice after the old current event was invalidated", async () => {
  const { db, id, now } = await isolatedVote();
  await env.DB.prepare("INSERT INTO integrity_cases(id,signal_type,subject_type,subject_id,dedupe_key,status,evidence_json,created_at,updated_at) VALUES(?,'REPEATED_VOTE_CHANGE','USER',?,?,'CONFIRMED','{}',?,?)").bind(id, id, id, now, now).run();
  await env.DB.prepare("INSERT INTO invalidated_vote_events(vote_event_id,integrity_case_id,reason,invalidated_at) VALUES(?,?,'합성 무효화',?)").bind(`${id}-first`, id, now).run();
  expect(await getCurrentVoteState(db, { placeId: id, userId: id })).toBeNull();
  await castVote(db, { placeId: id, userId: id, value: -1, eventId: `${id}-valid`, now, feedback: { reason: "MENU" } });
  expect(await getCurrentVoteState(db, { placeId: id, userId: id })).toEqual({ value: -1, eventId: `${id}-valid` });
});
