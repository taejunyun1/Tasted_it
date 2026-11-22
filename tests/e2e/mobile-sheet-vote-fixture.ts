import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { hashPassword } from "../../app/features/auth/password.server";
import { voteOutcomesFixture } from "./vote-outcomes-fixture";

export function mobileSheetVoteFixture(baseURL: string, scenario: string) {
  const fixture = voteOutcomesFixture(baseURL, `t02-${scenario}`);
  const { id } = fixture;
  const review = `${id}-review`, pendingReview = `${id}-pending-review`;
  const photoId = `${review}-photo`, pendingPhotoId = `${pendingReview}-photo`, goldenId = `${id}-golden`;
  const peerId = `${id}-gem-peer`;
  const email = `${id}@example.test`;
  const clientSuffix = randomUUID().slice(0, 8);
  const clientIp = `2001:db8:${clientSuffix.slice(0, 4)}:${clientSuffix.slice(4)}::1`;
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  function sql<T = Record<string, unknown>>(query: string): T[] {
    const output = execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config",
      "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--json", "--command", query], { encoding: "utf8" });
    return (JSON.parse(output) as Array<{ results: T[] }>).flatMap(result => result.results);
  }

  function cleanup() {
    const loginBuckets = [`auth-rate-limit:email:LOGIN:${email}`, `auth-rate-limit:ip:LOGIN:${clientIp}`]
      .map(key => quote(createHash("sha256").update(key).digest("hex")));
    try {
      sql(`DELETE FROM product_events WHERE user_id=${quote(id)};
        UPDATE reviewer_visit_reviews SET golden_pick_event_id=NULL WHERE id=${quote(review)};
        DELETE FROM golden_pick_events WHERE id=${quote(goldenId)};
        DELETE FROM reviewer_visit_reviews WHERE id IN (${quote(review)},${quote(pendingReview)});
        DELETE FROM places WHERE id=${quote(peerId)};
        DELETE FROM rate_limit_windows WHERE bucket_hash IN (${loginBuckets.join(",")});`);
    } finally {
      fixture.cleanup();
    }
  }

  function create({ publicEvidence = false } = {}) {
    cleanup();
    fixture.create();
    if (!publicEvidence) return;
    const now = new Date();
    const time = quote(now.toISOString());
    const date = quote(now.toISOString().slice(0, 10));
    const expiry = quote(new Date(now.getTime() + 86_400_000).toISOString());
    const reviewValues = (key: string, status: "APPROVED" | "PENDING", current: 0 | 1) =>
      `(${quote(key)},${quote(id)},'qa-active-reviewer','cat-ramen','RECOMMEND','[]',1,${quote(status)},${current},1,${current ? "1" : "NULL"},
        ${date},'합성 방문 근거','NONE','qa-admin',${time},'cst-reviewer-publication-v1',${time},${time},${time})`;
    const photoValues = (photo: string, reviewId: string) =>
      `(${quote(photo)},${quote(reviewId)},${quote(`e2e/${photo}.jpg`)},'image/jpeg',4,0,1,${date},'OWN_WORK','합성 사진',1,${time},${time})`;
    sql(`INSERT INTO reviewer_visit_reviews (id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,status,is_current,content_version,
      approved_content_version,visited_on,visit_note,disclosure,reviewed_by,reviewed_at,rule_version,published_at,created_at,updated_at)
      VALUES ${reviewValues(review, "APPROVED", 1)}, ${reviewValues(pendingReview, "PENDING", 0)};
      INSERT INTO reviewer_visit_photos (id,review_id,object_key,content_type,byte_size,position,content_version,taken_on,rights_basis,caption,privacy_checked,created_at,updated_at)
        VALUES ${photoValues(photoId, review)}, ${photoValues(pendingPhotoId, pendingReview)};
      INSERT INTO golden_pick_events (id,reviewer_user_id,place_id,event_type,reason,effective_at,expires_at,created_at,review_id,review_version)
        VALUES (${quote(goldenId)},'qa-active-reviewer',${quote(id)},'GRANT','합성 Golden Pick',${time},${expiry},${time},${quote(review)},1);
      UPDATE reviewer_visit_reviews SET golden_pick_event_id=${quote(goldenId)},golden_requested=1 WHERE id=${quote(review)};`);
  }

  function seedHiddenGem() {
    const now = new Date().toISOString();
    const time = quote(now), date = quote(now.slice(0, 10));
    const neighborhood = quote(`합성 평가 구역 ${id}`);
    sql(`UPDATE places SET neighborhood=${neighborhood} WHERE id=${quote(id)};
      INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
      VALUES(${quote(peerId)},${quote(peerId)},'합성 노출 비교 식당','PUBLISHED','광주광역시 동구 합성로 6',${neighborhood},35.16,126.93,'합성 노출 비교 식당',${time},${time});
      INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(${quote(peerId)},'cat-ramen',1);
      INSERT INTO place_daily_metrics(place_id,metric_date,detail_views)
        VALUES(${quote(id)},${date},2),(${quote(peerId)},${date},20);
      INSERT INTO rating_snapshots(id,place_id,config_id,input_hash,overall_score,user_score,reviewer_score,overall_sample_count,
        user_sample_count,reviewer_sample_count,reviewer_raw_weight,reviewer_combined_weight,reviewer_weight_share,reasons_json,
        computed_at,created_at,updated_at,vote_revision,moderation_epoch)
        SELECT ${quote(`${id}-gem-snapshot`)},p.id,'rating-config-v2',p.id,80,78,85,10,7,3,3,3,0.3,'{}',${time},${time},${time},p.vote_revision,s.epoch
        FROM places p CROSS JOIN reviewer_publication_state s WHERE p.id=${quote(id)} AND s.id='global';`);
  }

  async function loginCredentials() {
    const password = `synthetic-${randomUUID()}`;
    const { hash, salt } = await hashPassword(password);
    sql(`UPDATE users SET password_hash=${quote(hash)},password_salt=${quote(salt)},email_verified_at=${quote(new Date().toISOString())} WHERE id=${quote(id)};`);
    return { email, password, clientIp };
  }

  return {
    id, session: id, name: "U05 합성 식당", photoPath: "/review-photos/" + photoId,
    pendingPhotoPath: "/review-photos/" + pendingPhotoId, create, cleanup, seedHiddenGem, loginCredentials,
    expireSession: () => sql(`UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=${quote(id)} AND user_id=${quote(id)};`),
    events: fixture.events,
    guestSaveCount: (sessionId: string) => sql<{ count: number }>(`SELECT COUNT(*) AS count
      FROM guest_saved_places WHERE session_id=${quote(sessionId)} AND place_id=${quote(id)}`)[0]!.count,
    cleanupGuest: (sessionId: string) => sql(`DELETE FROM product_events WHERE guest_session_id=${quote(sessionId)};
      DELETE FROM guest_taste_sessions WHERE id=${quote(sessionId)};`),
    projection: () => sql<{ vote: number | null; reason: string | null; saved: number }>(`SELECT
      (SELECT value FROM current_votes WHERE user_id=${quote(id)} AND place_id=${quote(id)}) AS vote,
      (SELECT reason FROM recommendation_feedback WHERE user_id=${quote(id)} AND place_id=${quote(id)}) AS reason,
      (SELECT COUNT(*) FROM saved_places WHERE user_id=${quote(id)} AND place_id=${quote(id)}) AS saved`)[0]!,
    recommendationEvents: () => sql<{ id: string; event_name: string; metadata_json: string }>(`SELECT id,event_name,metadata_json FROM product_events
      WHERE user_id=${quote(id)} AND event_name LIKE 'RECOMMENDATION_%' ORDER BY event_name`),
  };
}
