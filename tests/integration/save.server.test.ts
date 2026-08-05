import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { getSaved, setSaved } from "../../app/features/saves/save.server";

const userId = "save-test-user";
const placeId = "save-test-place";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO users (id,email,display_name,role,created_at,updated_at) VALUES (?,?,'저장 테스트','USER',?,?)`).bind(userId, "save-test@example.com", "2026-08-05T00:00:00Z", "2026-08-05T00:00:00Z"),
    env.DB.prepare(`INSERT OR IGNORE INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES (?,?,'저장 테스트 장소','PUBLISHED','광주광역시 동구','동명동',35.149,126.9232,'저장 테스트',?,?)`).bind(placeId, "save-test-place", "2026-08-05T00:00:00Z", "2026-08-05T00:00:00Z"),
  ]);
});

describe("saved places", () => {
  it("saves idempotently and removes the saved row", async () => {
    const db = createDb(env.DB);
    const input = { userId, placeId, saved: true, now: "2026-08-05T00:00:00Z" };
    await setSaved(db, input);
    await setSaved(db, input);
    expect(await getSaved(db, { userId, placeId })).toBe(true);
    const count = await env.DB.prepare("SELECT COUNT(*) count FROM saved_places WHERE user_id=? AND place_id=?").bind(userId, placeId).first<{ count: number }>();
    expect(count?.count).toBe(1);

    await setSaved(db, { ...input, saved: false });
    expect(await getSaved(db, { userId, placeId })).toBe(false);
  });
});
