import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { listPublishedPlaceReviewPhotos, publishReviewerVisit } from "../../app/features/ratings/reviewer-visit.server";

const now = "2026-11-13T00:00:00.000Z";
const reviewer = "moderation-reviewer";
const place = "moderation-place";
const category = "moderation-category";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users(id,email,display_name,role,created_at,updated_at) VALUES (?,?,'리뷰어','REVIEWER',?,?)").bind(reviewer,`${reviewer}@example.com`,now,now),
    env.DB.prepare("INSERT OR IGNORE INTO reviewer_profiles(user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,created_at,updated_at) VALUES (?,?,'ACTIVE','시험','균형','GWANGJU','[]',?,?,?,?)").bind(reviewer,reviewer,now,now,now,now),
    env.DB.prepare("INSERT OR IGNORE INTO categories(id,slug,name,emoji,sort_order,is_active,created_at,updated_at) VALUES (?,?,'라멘','🍜',999,1,?,?)").bind(category,category,now,now),
    env.DB.prepare("INSERT OR IGNORE INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES (?,?,'검수 라멘','PUBLISHED','광주','동명동',35.15,126.92,'검수 라멘',?,?)").bind(place,place,now,now),
    env.DB.prepare("INSERT OR IGNORE INTO place_categories(place_id,category_id,is_primary) VALUES (?,?,1)").bind(place,category),
  ]);
});

describe("reviewer publication requires explicit moderation", () => {
  it("stores a submission pending without a public vote", async () => {
    const review = await publishReviewerVisit(createDb(env.DB), {
      id: crypto.randomUUID(), reviewerUserId: reviewer, placeId: place, categoryId: category,
      categoryName:"라멘",evaluation:"RECOMMEND",badges:[],golden:false,goldenReason:null,publishedPhotoCount:0,now,
    });
    expect(review).toMatchObject({ status: "PENDING" });
    expect(await env.DB.prepare("SELECT * FROM current_votes WHERE user_id=? AND place_id=?").bind(reviewer,place).first()).toBeNull();
  });

  it("keeps unreviewed legacy photo rows out of the public gallery", async () => {
    const id=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reviewer_visit_reviews(id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,published_at,created_at,updated_at) VALUES (?,?,?,?,'RECOMMEND','[]',1,?,?,?)").bind(id,place,reviewer,category,now,now,now),
      env.DB.prepare("INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,created_at,updated_at) VALUES (?,?,?,'image/jpeg',4,0,?,?)").bind(`p-${id}`,id,`reviews/${id}/p.jpg`,now,now),
    ]);
    expect(await listPublishedPlaceReviewPhotos(createDb(env.DB),place)).toEqual([]);
    expect(await env.DB.prepare("SELECT photo_count FROM reviewer_visit_reviews WHERE id=?").bind(id).first()).toEqual({photo_count:1});
  });
});
