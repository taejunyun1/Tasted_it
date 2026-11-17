import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { castVote, withdrawVote } from "../../app/features/ratings/vote.server";

// Vote timestamps follow the seeded rating config start (2026-08-06).
const placeId = "vote-test-place";
const userId = "vote-test-user";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO users
       (id, email, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, 'USER', ?, ?)`,
    ).bind(
      userId,
      "vote-test@example.com",
      "투표 테스트",
      "2026-08-05T00:00:00Z",
      "2026-08-05T00:00:00Z",
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO places
       (id, slug, name, status, address, neighborhood, latitude, longitude,
        search_text, created_at, updated_at)
       VALUES (?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      placeId,
      "vote-test-place",
      "투표 테스트 장소",
      "광주광역시 동구",
      "동명동",
      35.149,
      126.9232,
      "투표 테스트 장소 동명동",
      "2026-08-05T00:00:00Z",
      "2026-08-05T00:00:00Z",
    ),
  ]);
});

describe("castVote", () => {
  it("appends a change event while keeping one current vote", async () => {
    const db = createDb(env.DB);

    await castVote(db, {
      placeId,
      userId,
      value: 1,
      now: "2026-08-06T00:00:00Z",
      eventId: "vote-1",
    });
    await castVote(db, {
      placeId,
      userId,
      value: -1,
      now: "2026-08-06T00:01:00Z",
      eventId: "vote-2",
    });

    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM vote_events WHERE place_id = ? AND user_id = ?",
    )
      .bind(placeId, userId)
      .first<{ count: number }>();
    const current = await env.DB.prepare(
      "SELECT value FROM current_votes WHERE place_id = ? AND user_id = ?",
    )
      .bind(placeId, userId)
      .first<{ value: number }>();

    expect(events?.count).toBe(2);
    expect(current?.value).toBe(-1);
    const jobs = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM rating_recompute_jobs WHERE place_id = ? AND status = 'PENDING'",
    ).bind(placeId).first<{ count: number }>();
    expect(jobs?.count).toBe(1);
  });

  it("does not insert a CHANGE event when the same value is recast", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const isolatedUserId = `vote-same-user-${suffix}`;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users
       (id, email, display_name, role, created_at, updated_at)
       VALUES (?, ?, ?, 'USER', ?, ?)`,
    ).bind(isolatedUserId, `${isolatedUserId}@example.com`, "같은 값 투표", "2026-08-05T00:00:00Z", "2026-08-05T00:00:00Z").run();

    await castVote(db, {
      placeId,
      userId: isolatedUserId,
      value: 1,
      now: "2026-08-06T00:05:00Z",
      eventId: `vote-same-a-${suffix}`,
    });
    await castVote(db, {
      placeId,
      userId: isolatedUserId,
      value: 1,
      now: "2026-08-06T00:06:00Z",
      eventId: `vote-same-b-${suffix}`,
    });

    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM vote_events WHERE place_id = ? AND user_id = ?",
    ).bind(placeId, isolatedUserId).first<{ count: number }>()).toEqual({ count: 1 });
    expect(await env.DB.prepare(
      "SELECT id FROM vote_events WHERE id = ?",
    ).bind(`vote-same-b-${suffix}`).first()).toBeNull();
    expect(await env.DB.prepare(
      "SELECT value FROM current_votes WHERE place_id = ? AND user_id = ?",
    ).bind(placeId, isolatedUserId).first<{ value: number }>()).toEqual({ value: 1 });
  });

  it("appends a withdrawal event, removes the current vote, and enqueues recompute", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();

    await castVote(db, {
      placeId,
      userId,
      value: 1,
      now: "2026-08-06T00:02:00Z",
      eventId: `vote-withdraw-create-${suffix}`,
    });
    const withdrawn = await withdrawVote(db, {
      placeId,
      userId,
      now: "2026-08-06T00:03:00Z",
      eventId: `vote-withdraw-${suffix}`,
    });

    expect(withdrawn).toBe(true);
    expect(await env.DB.prepare(
      "SELECT value FROM current_votes WHERE place_id = ? AND user_id = ?",
    ).bind(placeId, userId).first()).toBeNull();
    expect(await env.DB.prepare(
      "SELECT event_type AS eventType, previous_event_id AS previousEventId, value FROM vote_events WHERE id = ?",
    ).bind(`vote-withdraw-${suffix}`).first()).toEqual({
      eventType: "WITHDRAW",
      previousEventId: `vote-withdraw-create-${suffix}`,
      value: 1,
    });
  });

  it("treats HOLD without a current vote as an idempotent no-op", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const withdrawn = await withdrawVote(db, {
      placeId,
      userId: `no-current-vote-${suffix}`,
      now: "2026-08-06T00:04:00Z",
      eventId: `no-op-withdraw-${suffix}`,
    });

    expect(withdrawn).toBe(false);
    expect(await env.DB.prepare(
      "SELECT id FROM vote_events WHERE id = ?",
    ).bind(`no-op-withdraw-${suffix}`).first()).toBeNull();
  });
});

it("does not cancel a vote or feedback replaced after the initial withdrawal read",async()=>{
  const db=createDb(env.DB);const id=crypto.randomUUID();const now="2026-11-13T00:00:00.000Z";
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,'USER',?,?)").bind(id,`${id}@example.test`,"합성 회원",now,now).run();
  await castVote(db,{userId:id,placeId,value:1,eventId:`${id}-old`,feedback:{reason:null},now});
  const originalBatch=db.batch.bind(db);let intercept=true;
  const wrapped=new Proxy(db,{get(object,key){if(key==="batch")return async(statements:Parameters<typeof db.batch>[0])=>{if(intercept){intercept=false;await castVote(db,{userId:id,placeId,value:-1,eventId:`${id}-new`,feedback:{reason:"MENU"},now});}return originalBatch(statements);};return Reflect.get(object,key);}});
  await expect(withdrawVote(wrapped,{userId:id,placeId,eventId:`${id}-withdraw`,expectedEventId:`${id}-old`,clearFeedback:true,now})).rejects.toThrow("VOTE_VERSION_CONFLICT");
  expect(await env.DB.prepare("SELECT event_id,value FROM current_votes WHERE user_id=? AND place_id=?").bind(id,placeId).first()).toEqual({event_id:`${id}-new`,value:-1});
  expect(await env.DB.prepare("SELECT value,reason FROM recommendation_feedback WHERE user_id=? AND place_id=?").bind(id,placeId).first()).toEqual({value:-1,reason:"MENU"});
  expect(await env.DB.prepare("SELECT count(*) n FROM vote_events WHERE id=?").bind(`${id}-withdraw`).first()).toEqual({n:0});
});
