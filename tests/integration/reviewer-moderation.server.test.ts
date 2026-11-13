import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import {
  listPublishedPlaceReviewPhotos,
  publishReviewerVisit,
} from "../../app/features/ratings/reviewer-visit.server";

const now = "2026-11-13T00:00:00.000Z";
let reviewer = "moderation-reviewer";
let place = "moderation-place";
const category = "moderation-category";

beforeEach(async () => {
  reviewer = `moderation-reviewer-${crypto.randomUUID()}`;
  place = `moderation-place-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO users(id,email,display_name,role,created_at,updated_at) VALUES (?,?,'리뷰어','REVIEWER',?,?)",
    ).bind(reviewer, `${reviewer}@example.com`, now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO reviewer_profiles(user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,created_at,updated_at) VALUES (?,?,'ACTIVE','시험','균형','GWANGJU','[]',?,?,?,?)",
    ).bind(reviewer, reviewer, now, now, now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO categories(id,slug,name,emoji,sort_order,is_active,created_at,updated_at) VALUES (?,?,'라멘','🍜',999,1,?,?)",
    ).bind(category, category, now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES (?,?,'검수 라멘','PUBLISHED','광주','동명동',35.15,126.92,'검수 라멘',?,?)",
    ).bind(place, place, now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO place_categories(place_id,category_id,is_primary) VALUES (?,?,1)",
    ).bind(place, category),
  ]);
});

describe("reviewer publication requires explicit moderation", () => {
  it("stores a submission pending without a public vote", async () => {
    const review = await publishReviewerVisit(createDb(env.DB), {
      id: crypto.randomUUID(),
      reviewerUserId: reviewer,
      placeId: place,
      categoryId: category,
      visitedOn: "2026-11-12",
      visitNote: "직접 방문하여 식사함",
      disclosure: "NONE",
      categoryName: "라멘",
      evaluation: "RECOMMEND",
      badges: [],
      golden: false,
      goldenReason: null,
      publishedPhotoCount: 0,
      now,
    });
    expect(review).toMatchObject({ status: "PENDING" });
    expect(
      await env.DB.prepare(
        "SELECT * FROM current_votes WHERE user_id=? AND place_id=?",
      )
        .bind(reviewer, place)
        .first(),
    ).toBeNull();
  });

  it("keeps unreviewed legacy photo rows out of the public gallery", async () => {
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO reviewer_visit_reviews(id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,published_at,created_at,updated_at) VALUES (?,?,?,?,'RECOMMEND','[]',1,?,?,?)",
      ).bind(id, place, reviewer, category, now, now, now),
      env.DB.prepare(
        "INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,created_at,updated_at) VALUES (?,?,?,'image/jpeg',4,0,?,?)",
      ).bind(`p-${id}`, id, `reviews/${id}/p.jpg`, now, now),
    ]);
    expect(
      await listPublishedPlaceReviewPhotos(createDb(env.DB), place),
    ).toEqual([]);
    expect(
      await env.DB.prepare(
        "SELECT photo_count FROM reviewer_visit_reviews WHERE id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({ photo_count: 1 });
  });
});

import {
  moderateReviewerVisit,
  editReviewerVisit,
  withdrawReviewerVisit,
} from "../../app/features/ratings/reviewer-moderation.server";
import { castVote, withdrawVote } from "../../app/features/ratings/vote.server";
import { getPlaceBySlug } from "../../app/features/places/place.server";
import { getPublicationEpoch } from "../../app/features/ratings/reviewer-publication.server";

const admin = "moderation-admin";
const checks = {
  visitVerified: true,
  rightsVerified: true,
  privacyVerified: true,
  placeVerified: true,
};
async function submit(
  evaluation: "RECOMMEND" | "HOLD" | "NOT_RECOMMEND" = "RECOMMEND",
) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users(id,email,display_name,role,created_at,updated_at) VALUES (?,?,'관리자','ADMIN',?,?)",
  )
    .bind(admin, `${admin}@example.com`, now, now)
    .run();
  return publishReviewerVisit(createDb(env.DB), {
    id: crypto.randomUUID(),
    reviewerUserId: reviewer,
    placeId: place,
    categoryId: category,
    categoryName: "라멘",
    evaluation,
    badges: [],
    golden: false,
    goldenReason: null,
    publishedPhotoCount: 0,
    visitedOn: "2026-11-12",
    visitNote: "현장 식사 방문",
    disclosure: "NONE",
    now,
  });
}
async function approve(id: string, version = 1) {
  return moderateReviewerVisit(createDb(env.DB), {
    reviewId: id,
    actorUserId: admin,
    expectedVersion: version,
    status: "APPROVED",
    reason: "방문과 권리 및 공개 적합성 확인",
    checks,
    now,
  });
}

it("only an admin can approve and an approval creates one bound reviewer signal", async () => {
  const db = createDb(env.DB);
  const review = await submit();
  const epoch = await getPublicationEpoch(db);
  await expect(
    moderateReviewerVisit(db, {
      reviewId: review.id,
      actorUserId: reviewer,
      expectedVersion: 1,
      status: "APPROVED",
      reason: "self",
      checks,
      now,
    }),
  ).rejects.toThrow("ADMIN_REQUIRED");
  const approved = await approve(review.id);
  expect(approved).toMatchObject({
    status: "APPROVED",
    version: 2,
    approvedContentVersion: 1,
  });
  expect(
    await env.DB.prepare(
      "SELECT e.source,e.review_id FROM current_votes c JOIN vote_events e ON e.id=c.event_id WHERE c.user_id=? AND c.place_id=?",
    )
      .bind(reviewer, place)
      .first(),
  ).toEqual({ source: "REVIEWER", review_id: review.id });
  expect(await getPublicationEpoch(db)).toBeGreaterThan(epoch);
  await expect(approve(review.id, 2)).rejects.toThrow(
    "REVIEW_TRANSITION_INVALID",
  );
});

it("requires literal boolean approval checks and resolved disclosures", async () => {
  const db = createDb(env.DB);
  const review = await submit();
  await expect(
    moderateReviewerVisit(db, {
      reviewId: review.id,
      actorUserId: admin,
      expectedVersion: 1,
      status: "APPROVED",
      reason: "check",
      checks: {
        visitVerified: "false",
        rightsVerified: "false",
        privacyVerified: "false",
        placeVerified: "false",
      } as never,
      now,
    }),
  ).rejects.toThrow("REVIEW_CHECKS_REQUIRED");
  await env.DB.prepare(
    "UPDATE reviewer_visit_reviews SET disclosure='DECLARED' WHERE id=?",
  )
    .bind(review.id)
    .run();
  await expect(approve(review.id)).rejects.toThrow(
    "REVIEW_DISCLOSURE_UNRESOLVED",
  );
});

it("preserves a newer general reaction when approving an earlier submission", async () => {
  const db = createDb(env.DB);
  const review = await submit();
  await castVote(db, {
    placeId: place,
    userId: reviewer,
    value: -1,
    eventId: crypto.randomUUID(),
    now,
  });
  await approve(review.id);
  expect(
    await env.DB.prepare(
      "SELECT e.source,c.value FROM current_votes c JOIN vote_events e ON e.id=c.event_id WHERE c.user_id=? AND c.place_id=?",
    )
      .bind(reviewer, place)
      .first(),
  ).toEqual({ source: "GENERAL", value: -1 });
});

it("does not resurrect a reaction after a newer general create-then-withdraw ABA", async () => {
  const db = createDb(env.DB);
  const review = await submit();
  await castVote(db, {
    placeId: place,
    userId: reviewer,
    value: 1,
    eventId: crypto.randomUUID(),
    now,
  });
  await withdrawVote(db, {
    placeId: place,
    userId: reviewer,
    eventId: crypto.randomUUID(),
    now,
  });
  await approve(review.id);
  expect(
    await env.DB.prepare(
      "SELECT * FROM current_votes WHERE user_id=? AND place_id=?",
    )
      .bind(reviewer, place)
      .first(),
  ).toBeNull();
});

it("approves HOLD without a neutral vote, and withdraws an unchanged prior reaction", async () => {
  const db = createDb(env.DB);
  const empty = await submit("HOLD");
  await approve(empty.id);
  expect(
    await env.DB.prepare(
      "SELECT * FROM vote_events WHERE user_id=? AND place_id=?",
    )
      .bind(reviewer, place)
      .all(),
  ).toMatchObject({ results: [] });
  await castVote(db, {
    placeId: place,
    userId: reviewer,
    value: 1,
    eventId: crypto.randomUUID(),
    now,
  });
  const edited = await editReviewerVisit(db, {
    reviewId: empty.id,
    reviewerUserId: reviewer,
    expectedVersion: 2,
    evaluation: "HOLD",
    badges: [],
    golden: false,
    goldenReason: null,
    visitedOn: "2026-11-12",
    visitNote: "재검토",
    disclosure: "NONE",
    photoMetadata: [],
    reason: "수정",
    now,
  });
  await approve(edited.id, edited.version);
  expect(
    await env.DB.prepare(
      "SELECT * FROM current_votes WHERE user_id=? AND place_id=?",
    )
      .bind(reviewer, place)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare(
      "SELECT value,event_type FROM vote_events WHERE review_id=?",
    )
      .bind(edited.id)
      .first(),
  ).toEqual({ value: 1, event_type: "WITHDRAW" });
});

it("allows only one concurrent approval and preserves immutable audit history", async () => {
  const review = await submit();
  const results = await Promise.allSettled([
    approve(review.id),
    approve(review.id),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await env.DB.prepare("SELECT id FROM vote_events WHERE review_id=?")
      .bind(review.id)
      .all(),
  ).toMatchObject({ results: [{ id: expect.any(String) }] });
  expect(
    await env.DB.prepare(
      "SELECT to_version FROM reviewer_review_transitions WHERE review_id=? ORDER BY to_version",
    )
      .bind(review.id)
      .all(),
  ).toMatchObject({ results: [{ to_version: 1 }, { to_version: 2 }] });
  await expect(
    env.DB.prepare(
      "UPDATE reviewer_review_transitions SET reason='changed' WHERE review_id=?",
    )
      .bind(review.id)
      .run(),
  ).rejects.toThrow();
});

it("resubmits edits privately, rejects stale versions and other owners", async () => {
  const db = createDb(env.DB);
  const review = await submit();
  await approve(review.id);
  const data = {
    reviewId: review.id,
    reviewerUserId: reviewer,
    expectedVersion: 2,
    evaluation: "NOT_RECOMMEND" as const,
    badges: [],
    golden: false,
    goldenReason: null,
    visitedOn: "2026-11-12",
    visitNote: "재방문 설명",
    disclosure: "NONE" as const,
    photoMetadata: [],
    reason: "보완",
    now,
  };
  await expect(
    editReviewerVisit(db, { ...data, reviewerUserId: admin }),
  ).rejects.toThrow("REVIEW_OWNER_REQUIRED");
  expect(await editReviewerVisit(db, data)).toMatchObject({
    status: "PENDING",
    version: 3,
    contentVersion: 2,
  });
  await expect(editReviewerVisit(db, data)).rejects.toThrow(
    "REVIEW_VERSION_CONFLICT",
  );
  expect(await getPlaceBySlug(db, place)).toMatchObject({
    positive: 0,
    negative: 0,
  });
});

it("preserves legacy copies and enforces a single new current review per author/place", async () => {
  const db = createDb(env.DB);
  await submit();
  await expect(submit()).rejects.toThrow();
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM reviewer_visit_reviews WHERE reviewer_user_id=? AND is_current=1",
    )
      .bind(reviewer)
      .first(),
  ).toEqual({ n: 1 });
});

it("withdraws by ownership without deleting another author's general reaction", async () => {
  const db = createDb(env.DB);
  const review = await submit();
  await approve(review.id);
  await castVote(db, {
    placeId: place,
    userId: reviewer,
    value: -1,
    eventId: crypto.randomUUID(),
    now,
  });
  await withdrawReviewerVisit(db, {
    reviewId: review.id,
    reviewerUserId: reviewer,
    expectedVersion: 2,
    reason: "철회",
    now,
  });
  expect(
    await env.DB.prepare(
      "SELECT value FROM current_votes WHERE user_id=? AND place_id=?",
    )
      .bind(reviewer, place)
      .first(),
  ).toEqual({ value: -1 });
});

it("keeps a finite Golden grant through explicit reapproval without consuming quota or extending time", async () => {
  const db = createDb(env.DB);
  const review = await submit();
  const photoId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE reviewer_visit_reviews SET photo_count=1,golden_requested=1,golden_reason=?,badges_json=? WHERE id=?",
    ).bind(
      "직접 방문한 음식의 상태가 꾸준하여 다시 추천합니다.",
      JSON.stringify(["육수 농도 선명", "면 익힘 알맞음"]),
      review.id,
    ),
    env.DB.prepare(
      "INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,content_version,taken_on,rights_basis,caption,privacy_checked,created_at,updated_at) VALUES(?,?,?,'image/jpeg',4,0,1,'2026-11-12','OWN_WORK','직접 촬영 음식',1,?,?)",
    ).bind(photoId, review.id, `reviews/${review.id}/${photoId}.jpg`, now, now),
  ]);
  await approve(review.id);
  const original = await env.DB.prepare(
    "SELECT * FROM golden_pick_events WHERE review_id=?",
  )
    .bind(review.id)
    .first();
  const { listActiveGoldenPicks } =
    await import("../../app/features/ratings/golden-pick.server");
  expect(await listActiveGoldenPicks(db, now, reviewer)).toHaveLength(1);
  await editReviewerVisit(db, {
    reviewId: review.id,
    reviewerUserId: reviewer,
    expectedVersion: 2,
    visitedOn: "2026-11-12",
    visitNote: "식사 방문 근거 보완",
    disclosure: "NONE",
    categoryId: category,
    categoryName: "라멘",
    evaluation: "RECOMMEND",
    badges: ["육수 농도 선명", "면 익힘 알맞음"],
    golden: true,
    goldenReason: "직접 방문한 음식의 상태가 꾸준하여 다시 추천합니다.",
    photoMetadata: [
      {
        photoId,
        position: 0,
        takenOn: "2026-11-12",
        rightsBasis: "OWN_WORK",
        rightsNote: "",
        caption: "수정한 직접 촬영 음식",
        privacyChecked: true,
      },
    ],
    reason: "사진 설명 보완",
    now,
  });
  expect(await listActiveGoldenPicks(db, now, reviewer)).toHaveLength(0);
  await approve(review.id, 3);
  expect(
    await env.DB.prepare("SELECT * FROM golden_pick_events WHERE review_id=?")
      .bind(review.id)
      .all(),
  ).toMatchObject({ results: [original] });
  expect(await listActiveGoldenPicks(db, now, reviewer)).toHaveLength(1);
  expect(
    await listActiveGoldenPicks(db, "2027-03-01T00:00:00.000Z", reviewer),
  ).toHaveLength(0);
  await moderateReviewerVisit(db, {
    reviewId: review.id,
    actorUserId: admin,
    expectedVersion: 4,
    status: "WITHDRAWN",
    reason: "검수 회수",
    checks,
    now,
  });
  expect(await listActiveGoldenPicks(db, now, reviewer)).toHaveLength(0);
});

it("blocks edits and approval while an owner-requested exact-key deletion remains pending", async () => {
  const db = createDb(env.DB);
  const review = await submit();
  const photoId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE reviewer_visit_reviews SET photo_count=1 WHERE id=?",
    ).bind(review.id),
    env.DB.prepare(
      "INSERT INTO reviewer_visit_photos(id,review_id,object_key,content_type,byte_size,position,content_version,taken_on,rights_basis,caption,privacy_checked,created_at,updated_at) VALUES(?,?,?,'image/jpeg',4,0,1,'2026-11-12','OWN_WORK','직접 촬영',1,?,?)",
    ).bind(photoId, review.id, `reviews/${review.id}/${photoId}.jpg`, now, now),
  ]);
  await approve(review.id);
  await withdrawReviewerVisit(db, {
    reviewId: review.id,
    reviewerUserId: reviewer,
    expectedVersion: 2,
    reason: "직접 사진 삭제",
    now,
    bucket: {
      delete: async () => {
        throw new Error("synthetic outage");
      },
    },
  });
  await expect(
    editReviewerVisit(db, {
      reviewId: review.id,
      reviewerUserId: reviewer,
      expectedVersion: 3,
      visitedOn: "2026-11-12",
      visitNote: "재제출",
      disclosure: "NONE",
      categoryId: category,
      categoryName: "라멘",
      evaluation: "RECOMMEND",
      badges: [],
      golden: false,
      goldenReason: null,
      photoMetadata: [],
      reason: "재제출",
      now,
    }),
  ).rejects.toThrow("REVIEW_PHOTO_DELETE_PENDING");
  await env.DB.prepare(
    "UPDATE reviewer_visit_reviews SET status='PENDING',is_current=1 WHERE id=?",
  )
    .bind(review.id)
    .run();
  await expect(approve(review.id, 3)).rejects.toThrow(
    "REVIEW_PHOTO_DELETE_PENDING",
  );
});

it("paginates owner and admin history by updatedAt and id without crossing owner scope", async () => {
  const db = createDb(env.DB);
  const first = await submit();
  await withdrawReviewerVisit(db, {
    reviewId: first.id,
    reviewerUserId: reviewer,
    expectedVersion: 1,
    reason: "철회",
    now,
  });
  const second = await submit();
  const { listReviewerVisitHistory } =
    await import("../../app/features/ratings/reviewer-visit.server");
  const { listReviewerModerationQueue } =
    await import("../../app/features/ratings/reviewer-moderation.server");
  const ordered = [first.id, second.id].sort().reverse();
  const own = await listReviewerVisitHistory(db, reviewer, 1);
  expect(own.map((r) => r.id)).toEqual([ordered[0]]);
  const ownNext = await listReviewerVisitHistory(db, reviewer, 1, {
    updatedAt: now,
    id: own[0]!.id,
  });
  expect(ownNext.map((r) => r.id)).toEqual([ordered[1]]);
  expect(
    await listReviewerVisitHistory(db, "another-owner", 1, {
      updatedAt: now,
      id: own[0]!.id,
    }),
  ).toEqual([]);
  const queue = await listReviewerModerationQueue(db, {
    actorUserId: admin,
    limit: 1,
  });
  const next = await listReviewerModerationQueue(db, {
    actorUserId: admin,
    limit: 1,
    before: { updatedAt: queue[0]!.updatedAt, id: queue[0]!.id },
  });
  expect(next[0]!.id).not.toBe(queue[0]!.id);
});

it("requires the current review to be withdrawn before another preserved legacy record is resubmitted",async()=>{
  const db=createDb(env.DB);const ids=[crypto.randomUUID(),crypto.randomUUID()];
  for(const id of ids)await env.DB.prepare("INSERT INTO reviewer_visit_reviews(id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,published_at,created_at,updated_at) VALUES(?,?,?,?,'RECOMMEND','[]',0,?,?,?)").bind(id,place,reviewer,category,now,now,now).run();
  const edit=(id:string)=>editReviewerVisit(db,{reviewId:id,reviewerUserId:reviewer,expectedVersion:1,visitedOn:"2026-11-12",visitNote:"원본 방문 기록 보완",disclosure:"NONE",evaluation:"RECOMMEND",badges:[],golden:false,goldenReason:null,photoMetadata:[],reason:"명시 재검수 요청",now});
  await edit(ids[0]!);
  const before=await env.DB.prepare("SELECT * FROM reviewer_visit_reviews WHERE id=?").bind(ids[1]!).first();
  await expect(edit(ids[1]!)).rejects.toThrow("REVIEW_CURRENT_EXISTS");
  expect(await env.DB.prepare("SELECT * FROM reviewer_visit_reviews WHERE id=?").bind(ids[1]!).first()).toEqual(before);
  expect(await env.DB.prepare("SELECT count(*) n FROM reviewer_review_transitions WHERE review_id=?").bind(ids[1]!).first()).toEqual({n:0});
  await withdrawReviewerVisit(db,{reviewId:ids[0]!,reviewerUserId:reviewer,expectedVersion:2,reason:"다른 원본 방문 기록 보완",now});
  expect(await edit(ids[1]!)).toMatchObject({status:"PENDING",isCurrent:true,version:2});
});
