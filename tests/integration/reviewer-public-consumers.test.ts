import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../../app/db/client.server";
import { categories, currentVotes, placeCategories, places, ratingSnapshots, reviewerProfiles, reviewerReliabilitySnapshots, reviewerVisitReviews, users, voteEvents } from "../../app/db/schema";
import { getLatestRatingSnapshot, recomputePlaceRating } from "../../app/features/ratings/recompute.server";

import { listPlaces } from "../../app/features/places/place.server";
import { loadPlaceLivenessEvidence } from "../../app/features/places/place-liveness.server";
import { getPublicationEpoch } from "../../app/features/ratings/reviewer-publication.server";
import { seedApprovedReviewerVote } from "./reviewer-public-fixtures";

const now = "2026-11-13T00:00:00.000Z";
let placeId = "";

beforeEach(async () => {
  placeId=`public-consumer-${crypto.randomUUID()}`;
  await createDb(env.DB).insert(places).values({
    id: placeId, slug: placeId, name: "집계 검수 식당", status: "PUBLISHED", address: "광주", neighborhood: "동명동",
    latitude: 35.15, longitude: 126.92, searchText: "집계 검수", createdAt: now, updatedAt: now,
  }).onConflictDoNothing();
  await createDb(env.DB).insert(categories).values({id:"public-consumer-category",slug:"public-consumer-category",name:"라멘",emoji:"🍜",sortOrder:999,isActive:true,createdAt:now,updatedAt:now}).onConflictDoNothing();
  await createDb(env.DB).insert(placeCategories).values({placeId,categoryId:"public-consumer-category",isPrimary:true}).onConflictDoNothing();
});

describe("reviewer publication consumers", () => {
  it.each(["author", "place", "evaluation"] as const)("rejects a reviewer event pointing to another approved review's %s", async (mismatch) => {
    const db=createDb(env.DB);
    const reviewerId=`corrupt-author-${placeId}`;
    const otherReviewerId=`corrupt-other-${placeId}`;
    await db.insert(users).values([reviewerId,otherReviewerId].map(id=>({id,email:`${id}@example.test`,displayName:"합성 리뷰어",role:"REVIEWER" as const,createdAt:now,updatedAt:now})));
    const otherPlaceId=`other-${placeId}`;
    await db.insert(places).values({id:otherPlaceId,slug:otherPlaceId,name:"다른 라멘",status:"PUBLISHED",address:"광주",neighborhood:"동명동",latitude:35.15,longitude:126.92,searchText:"다른 라멘",createdAt:now,updatedAt:now});
    await db.insert(placeCategories).values({placeId:otherPlaceId,categoryId:"public-consumer-category",isPrimary:true});
    const {reviewId}=await seedApprovedReviewerVote(db,{reviewerId:mismatch==="author"?otherReviewerId:reviewerId,placeId:mismatch==="place"?otherPlaceId:placeId,eventId:`unprojected-${placeId}`,value:1,now,projectVote:false});
    const eventId=`corrupt-${placeId}`;
    const value=mismatch==="evaluation"?-1:1;
    await db.insert(voteEvents).values({id:eventId,placeId,userId:reviewerId,value,eventType:"CREATE",source:"REVIEWER",reviewId,reviewVersion:1,createdAt:now});
    await db.insert(currentVotes).values({placeId,userId:reviewerId,eventId,value,updatedAt:now});

    expect((await listPlaces(db)).find(row=>row.id===placeId)).toMatchObject({positive:0,negative:0,reviewerPositive:0});
    expect(await recomputePlaceRating(db,{placeId,now})).toMatchObject({userSampleCount:0,reviewerSampleCount:0,overallSampleCount:0});
    expect(await db.query.currentVotes.findFirst({where:eq(currentVotes.eventId,eventId)})).toBeDefined();
  });

  it("classifies an explicit general reaction independently of the author's current reviewer role", async () => {
    const db = createDb(env.DB);
    const userId = "public-consumer-reviewer";
    await db.insert(users).values({ id:userId,email:`${userId}@example.com`,displayName:"리뷰어",role:"REVIEWER",createdAt:now,updatedAt:now });
    await db.insert(voteEvents).values({ id:"general-by-reviewer",userId,placeId,value:1,eventType:"CREATE",createdAt:now });
    await db.insert(currentVotes).values({userId,placeId,eventId:"general-by-reviewer",value:1,updatedAt:now});
    const snapshot = await recomputePlaceRating(db,{placeId,now});
    expect(snapshot).toMatchObject({userSampleCount:1,reviewerSampleCount:0,overallSampleCount:1});
    expect((await listPlaces(db)).find((row)=>row.id===placeId)).toMatchObject({userPositive:1,userNegative:0,reviewerPositive:0,reviewerNegative:0});
  });

  it("never reuses an unbound legacy snapshot solely because isStale is false", async () => {
    const db=createDb(env.DB);
    await db.insert(ratingSnapshots).values({
      id:"unbound-legacy-snapshot",placeId,configId:"rating-config-v2",inputHash:"unbound-legacy",overallScore:99,userScore:99,reviewerScore:99,
      overallSampleCount:100,userSampleCount:50,reviewerSampleCount:50,reviewerRawWeight:50,reviewerCombinedWeight:50,reviewerWeightShare:.5,
      reasonsJson:"{}",isStale:false,computedAt:now,createdAt:now,updatedAt:now,
    });
    expect(await getLatestRatingSnapshot(db,placeId)).toBeUndefined();
  });
  it("excludes immutable legacy reviewer signals from raw counts and recomputation after role downgrade", async () => {
    const db=createDb(env.DB); const userId="legacy-downgraded-reviewer";
    await db.insert(users).values({id:userId,email:`${userId}@example.com`,displayName:"이전 리뷰어",role:"USER",createdAt:now,updatedAt:now});
    await db.insert(voteEvents).values({id:"legacy-reviewer-vote",userId,placeId,value:1,eventType:"CREATE",source:"LEGACY_REVIEWER",createdAt:now});
    await db.insert(currentVotes).values({userId,placeId,eventId:"legacy-reviewer-vote",value:1,updatedAt:now});
    expect((await listPlaces(db)).find((row)=>row.id===placeId)).toMatchObject({positive:0,negative:0});
    expect(await recomputePlaceRating(db,{placeId,now})).toMatchObject({userSampleCount:0,reviewerSampleCount:0});
    expect(await db.query.voteEvents.findFirst({where:eq(voteEvents.id,"legacy-reviewer-vote")})).toMatchObject({source:"LEGACY_REVIEWER"});
  });

  it("invalidates snapshots and raw signals when an approved review returns to pending", async () => {
    const db=createDb(env.DB);const reviewerId="approved-consumer-reviewer";
    await db.insert(users).values({id:reviewerId,email:`${reviewerId}@example.com`,displayName:"리뷰어",role:"REVIEWER",createdAt:now,updatedAt:now});
    const {reviewId}=await seedApprovedReviewerVote(db,{reviewerId,placeId,eventId:"approved-consumer-event",value:1,now,withPhoto:true});
    const snapshot=await recomputePlaceRating(db,{placeId,now});
    expect(snapshot.reviewerSampleCount).toBe(1);
    expect((await listPlaces(db)).find((row)=>row.id===placeId)).toMatchObject({userPositive:0,reviewerPositive:1});
    expect(await getLatestRatingSnapshot(db,placeId)).toBeDefined();
    expect(await loadPlaceLivenessEvidence(db,{placeId,now})).toMatchObject({reviewerVisitReviewCount:1,reviewerPhotoCount:1});
    await db.update(reviewerVisitReviews).set({status:"PENDING",contentVersion:2,approvedContentVersion:null}).where(eq(reviewerVisitReviews.id,reviewId));
    expect(await getLatestRatingSnapshot(db,placeId)).toBeUndefined();
    expect((await listPlaces(db)).find((row)=>row.id===placeId)).toMatchObject({positive:0,negative:0});
    expect(await loadPlaceLivenessEvidence(db,{placeId,now})).toMatchObject({reviewerVisitReviewCount:0,reviewerPhotoCount:0});
  });

  it("never reclassifies an approved reviewer signal as general when the reviewer is suspended", async () => {
    const db=createDb(env.DB);const reviewerId="suspended-consumer-reviewer";
    await db.insert(users).values({id:reviewerId,email:`${reviewerId}@example.com`,displayName:"리뷰어",role:"REVIEWER",createdAt:now,updatedAt:now});
    await seedApprovedReviewerVote(db,{reviewerId,placeId,eventId:"suspended-consumer-event",value:1,now});
    await recomputePlaceRating(db,{placeId,now});
    await db.batch([
      db.update(reviewerProfiles).set({status:"SUSPENDED"}).where(eq(reviewerProfiles.userId,reviewerId)),
      db.update(users).set({role:"USER"}).where(eq(users.id,reviewerId)),
    ]);
    expect(await getLatestRatingSnapshot(db,placeId)).toBeUndefined();
    expect(await recomputePlaceRating(db,{placeId,now})).toMatchObject({userSampleCount:0,reviewerSampleCount:0});
  });

  it("uses neutral reviewer trust instead of a reliability from another moderation epoch", async () => {
    const db=createDb(env.DB);const reviewerId="trust-epoch-reviewer";
    await db.insert(users).values({id:reviewerId,email:`${reviewerId}@example.com`,displayName:"리뷰어",role:"REVIEWER",createdAt:now,updatedAt:now});
    await seedApprovedReviewerVote(db,{reviewerId,placeId,eventId:"trust-epoch-event",value:1,now});
    await db.insert(reviewerReliabilitySnapshots).values({id:"stale-reliability",reviewerUserId:reviewerId,configId:"rating-config-v2",inputHash:"stale-reliability",eligibleCount:10,correctCount:10,posteriorAccuracy:1,reliabilityWeight:1.4,calibrationStatus:"ACTIVE",moderationEpoch:(await getPublicationEpoch(db))-1,computedAt:now});
    expect(await recomputePlaceRating(db,{placeId,now})).toMatchObject({reviewerRawWeight:1});
  });

  it("rejects a snapshot whose input epoch changes while its hash is being computed", async () => {
    const db=createDb(env.DB);const reviewerId="race-epoch-reviewer";
    await db.insert(users).values({id:reviewerId,email:`${reviewerId}@example.com`,displayName:"리뷰어",role:"REVIEWER",createdAt:now,updatedAt:now});
    const {reviewId}=await seedApprovedReviewerVote(db,{reviewerId,placeId,eventId:"race-epoch-event",value:1,now});
    const digest=crypto.subtle.digest.bind(crypto.subtle);
    const spy=vi.spyOn(crypto.subtle,"digest").mockImplementationOnce(async (algorithm,data)=>{
      await db.update(reviewerVisitReviews).set({status:"WITHDRAWN"}).where(eq(reviewerVisitReviews.id,reviewId));
      return digest(algorithm,data);
    });
    try {
      await recomputePlaceRating(db,{placeId,now});
      expect(await getLatestRatingSnapshot(db,placeId)).toBeUndefined();
      expect((await listPlaces(db)).find((row)=>row.id===placeId)).toMatchObject({positive:0,negative:0});
    } finally { spy.mockRestore(); }
  });

  it("rejects a snapshot if a general reaction changes while its input hash is computed", async () => {
    const db=createDb(env.DB);const userId="general-revision-user";
    await db.insert(users).values({id:userId,email:`${userId}@example.com`,displayName:"일반 반응",role:"USER",createdAt:now,updatedAt:now});
    await db.insert(voteEvents).values({id:"general-revision-first",placeId,userId,value:1,eventType:"CREATE",source:"GENERAL",createdAt:now});
    await db.insert(currentVotes).values({placeId,userId,value:1,eventId:"general-revision-first",updatedAt:now});
    const digest=crypto.subtle.digest.bind(crypto.subtle);
    const spy=vi.spyOn(crypto.subtle,"digest").mockImplementationOnce(async (algorithm,data)=>{
      await db.batch([
        db.insert(voteEvents).values({id:"general-revision-second",placeId,userId,value:-1,eventType:"CHANGE",previousEventId:"general-revision-first",source:"GENERAL",createdAt:now}),
        db.update(currentVotes).set({value:-1,eventId:"general-revision-second",updatedAt:now}).where(eq(currentVotes.userId,userId)),
      ]);
      return digest(algorithm,data);
    });
    try {
      await recomputePlaceRating(db,{placeId,now});
      expect(await getLatestRatingSnapshot(db,placeId)).toBeUndefined();
      expect((await listPlaces(db)).find((row)=>row.id===placeId)).toMatchObject({positive:0,negative:1,userNegative:1,reviewerNegative:0});
    } finally { spy.mockRestore(); }
  });

});

it("revokes cross-place trust and snapshots when an approved reviewer projection is explicitly withdrawn",async()=>{
  const db=createDb(env.DB);const reviewerId=crypto.randomUUID();const secondPlace=crypto.randomUUID();
  await db.insert(users).values({id:reviewerId,email:`${reviewerId}@example.test`,displayName:"합성 리뷰어",role:"REVIEWER",createdAt:now,updatedAt:now});
  await db.insert(places).values({id:secondPlace,slug:secondPlace,name:"합성 두번째 장소",status:"PUBLISHED",address:"합성",neighborhood:"동명동",latitude:35.1,longitude:126.9,searchText:"합성",createdAt:now,updatedAt:now});
  await seedApprovedReviewerVote(db,{reviewerId,placeId,eventId:`${reviewerId}-first`,value:1,now});
  await seedApprovedReviewerVote(db,{reviewerId,placeId:secondPlace,eventId:`${reviewerId}-second`,value:1,now});
  const epoch=await getPublicationEpoch(db);
  await db.insert(reviewerReliabilitySnapshots).values({id:crypto.randomUUID(),reviewerUserId:reviewerId,configId:"rating-config-v2",inputHash:crypto.randomUUID(),eligibleCount:10,correctCount:10,posteriorAccuracy:1,reliabilityWeight:1.4,calibrationStatus:"ACTIVE",moderationEpoch:epoch,computedAt:now});
  expect(await recomputePlaceRating(db,{placeId:secondPlace,now})).toMatchObject({reviewerRawWeight:1.4});
  const {withdrawVote}=await import("../../app/features/ratings/vote.server");
  await withdrawVote(db,{userId:reviewerId,placeId,eventId:crypto.randomUUID(),expectedEventId:`${reviewerId}-first`,clearFeedback:true,now});
  expect(await getPublicationEpoch(db)).toBeGreaterThan(epoch);
  expect(await getLatestRatingSnapshot(db,secondPlace)).toBeUndefined();
  expect(await recomputePlaceRating(db,{placeId:secondPlace,now})).toMatchObject({reviewerRawWeight:1});
  expect(await db.query.reviewerVisitReviews.findFirst({where:eq(reviewerVisitReviews.id,`review-${reviewerId}-first`)})).toMatchObject({status:"APPROVED"});
});

it("chunks calibration reads for 101 reviewer identities within the D1 binding limit",async()=>{
  const db=createDb(env.DB);
  for(let index=0;index<101;index++) {
    const reviewerId=`chunk-${crypto.randomUUID()}`;
    await db.insert(users).values({id:reviewerId,email:`${reviewerId}@example.test`,displayName:"합성 리뷰어",role:"REVIEWER",createdAt:now,updatedAt:now});
    await seedApprovedReviewerVote(db,{reviewerId,placeId,eventId:`${reviewerId}-event`,value:1,now});
  }
  const {refreshReviewerTrust}=await import("../../app/features/ratings/reviewer-trust.server");
  await refreshReviewerTrust(db,{now});
  expect(await recomputePlaceRating(db,{placeId,now})).toMatchObject({userSampleCount:0,reviewerSampleCount:101,reviewerRawWeight:101,reviewerCombinedWeight:101,reviewerWeightShare:1,overallScore:98});
});
