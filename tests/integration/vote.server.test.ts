import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { castVote } from "../../app/features/ratings/vote.server";

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
      now: "2026-08-05T00:00:00Z",
      eventId: "vote-1",
    });
    await castVote(db, {
      placeId,
      userId,
      value: -1,
      now: "2026-08-05T00:01:00Z",
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
  });
});
