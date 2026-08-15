import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { listReviewDuplicateCandidates } from "../../app/features/places/place-review-duplicates.server";

const now = "2026-08-15T08:00:00.000Z";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM place_review_duplicate_resolutions"),
    env.DB.prepare("DELETE FROM place_review_work_items"),
    env.DB.prepare("DELETE FROM places WHERE id LIKE 'review-duplicate-%'"),
    env.DB.prepare("DELETE FROM business_licenses WHERE id LIKE 'review-duplicate-%'"),
  ]);
});

describe("place review duplicate candidates", () => {
  it("only presents independent same-name places at the same location", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES ('review-duplicate-existing','review-duplicate-existing','동명식당','HIDDEN','광주광역시 동구 예술길 1','동명동',35.15,126.92,'동명식당',?,?)").bind(now, now),
      env.DB.prepare("INSERT INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES ('review-duplicate-chain','review-duplicate-chain','파리바게뜨 동명점','HIDDEN','광주광역시 동구 예술길 1','동명동',35.15,126.92,'파리바게뜨',?,?)").bind(now, now),
      env.DB.prepare("INSERT INTO business_licenses (id,source_type,source_management_no,business_name,business_subtype,sales_status_code,sales_status_name,detail_status_code,detail_status_name,normalized_status,road_address,latitude,longitude,region_code,source_updated_at,raw_payload,review_status,first_seen_at,last_seen_at,created_at,updated_at) VALUES ('review-duplicate-license','GENERAL_RESTAURANT','review-duplicate-license','동명식당','한식','01','영업','01','영업','OPEN','광주광역시 동구 예술길 1',35.15,126.92,'GWANGJU',?,'{}','PENDING',?,?,?,?)").bind(now, now, now, now, now),
      env.DB.prepare("INSERT INTO place_review_work_items (id,business_license_id,source_kind,stage,status,stage_version,created_at,updated_at) VALUES ('review-duplicate-item','review-duplicate-license','PUBLIC_DATA','DUPLICATE_REVIEW','ACTIVE',0,?,?)").bind(now, now),
    ]);
    const db = createDb(env.DB);
    await expect(listReviewDuplicateCandidates(db, ["review-duplicate-item"])).resolves.toEqual([
      expect.objectContaining({ workItemId: "review-duplicate-item", candidatePlaceId: "review-duplicate-existing", reason: "SAME_ADDRESS", decision: null }),
    ]);
  });
});
