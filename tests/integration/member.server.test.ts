import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../../app/db/client.server";
import { categories, currentVotes, placeCategories, places, savedPlaces, users, voteEvents, reviewerVisitReviews, userTasteBadges } from "../../app/db/schema";
import { listMemberTaste } from "../../app/features/members/member.server";

import { seedApprovedReviewerVote } from "./reviewer-public-fixtures";
import { refreshInferredTasteSignals } from "../../app/features/members/taste-learning.server";

describe("member taste", () => {
  it("returns only the member's published saved and rated places", async () => {
    const db = createDb(env.DB); const id = crypto.randomUUID(); const other = crypto.randomUUID(); const now = "2026-08-05T12:00:00Z"; const category = `member-category-${id}`; const place = `member-place-${id}`; const hidden = `member-hidden-${id}`;
    await db.insert(users).values([{ id, email: `${id}@example.com`, displayName: "나", role: "USER", createdAt: now, updatedAt: now }, { id: other, email: `${other}@example.com`, displayName: "남", role: "USER", createdAt: now, updatedAt: now }]);
    await db.insert(categories).values({ id: category, slug: category, name: "테스트", emoji: "🍚", sortOrder: 1, isActive: true, createdAt: now, updatedAt: now });
    await db.insert(places).values([{ id: place, slug: place, name: "공개 장소", status: "PUBLISHED", address: "광주 동명동", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "공개", createdAt: now, updatedAt: now }, { id: hidden, slug: hidden, name: "숨김 장소", status: "HIDDEN", address: "광주 동명동", neighborhood: "동명동", latitude: 35.1, longitude: 126.9, searchText: "숨김", createdAt: now, updatedAt: now }]);
    await db.insert(placeCategories).values([{ placeId: place, categoryId: category, isPrimary: true }, { placeId: hidden, categoryId: category, isPrimary: true }]);
    await db.insert(savedPlaces).values([{ userId: id, placeId: place, createdAt: now }, { userId: id, placeId: hidden, createdAt: now }, { userId: other, placeId: place, createdAt: now }]);
    const eventId = crypto.randomUUID(); await db.insert(voteEvents).values({ id: eventId, placeId: place, userId: id, value: 1, eventType: "CREATE", createdAt: now }); await db.insert(currentVotes).values({ placeId: place, userId: id, eventId, value: 1, updatedAt: now });
    const result = await listMemberTaste(db, id);
    expect(result.saved.map((row) => row.name)).toEqual(["공개 장소"]);
    expect(result.rated).toEqual([expect.objectContaining({ name: "공개 장소", value: 1 })]);
  });
  it("keeps explicit GENERAL choices but excludes legacy and pending reviewer signals from taste inference", async () => {
    const db=createDb(env.DB);const prefix=`member-source-${crypto.randomUUID()}`;const userId=`${prefix}-reviewer`;const now="2026-11-13T00:00:00.000Z";
    await db.insert(users).values({id:userId,email:`${userId}@example.test`,displayName:"리뷰어",role:"REVIEWER",createdAt:now,updatedAt:now});
    const ramen=`${prefix}-ramen`;const gukbap=`${prefix}-gukbap`;
    await db.insert(categories).values([{id:ramen,slug:ramen,name:"라멘",emoji:"🍜",sortOrder:1,isActive:true,createdAt:now,updatedAt:now},{id:gukbap,slug:gukbap,name:"국밥·해장국",emoji:"🍲",sortOrder:2,isActive:true,createdAt:now,updatedAt:now}]);
    const legacy=`${prefix}-legacy`;const pending=`${prefix}-pending`;const general=`${prefix}-general`;
    await db.insert(places).values([legacy,pending,general].map(id=>({id,slug:id,name:id===general?"국밥":"라멘",status:"PUBLISHED" as const,address:"광주",neighborhood:"동명동",latitude:35.1,longitude:126.9,searchText:id,createdAt:now,updatedAt:now})));
    await db.insert(placeCategories).values([{placeId:legacy,categoryId:ramen,isPrimary:true},{placeId:pending,categoryId:ramen,isPrimary:true},{placeId:general,categoryId:gukbap,isPrimary:true}]);
    await db.insert(voteEvents).values([{id:`${prefix}-legacy-event`,userId,placeId:legacy,value:1,eventType:"CREATE",source:"LEGACY_REVIEWER",createdAt:now},{id:`${prefix}-general-event`,userId,placeId:general,value:1,eventType:"CREATE",source:"GENERAL",createdAt:now}]);
    await db.insert(currentVotes).values([{userId,placeId:legacy,eventId:`${prefix}-legacy-event`,value:1,updatedAt:now},{userId,placeId:general,eventId:`${prefix}-general-event`,value:1,updatedAt:now}]);
    const {reviewId}=await seedApprovedReviewerVote(db,{reviewerId:userId,placeId:pending,eventId:`${prefix}-approved-event`,value:1,now});
    expect((await listMemberTaste(db,userId)).rated.map(row=>row.id).sort()).toEqual([general,pending].sort());
    await db.update(reviewerVisitReviews).set({status:"PENDING",approvedContentVersion:null}).where(eq(reviewerVisitReviews.id,reviewId));
    expect((await listMemberTaste(db,userId)).rated.map(row=>row.id)).toEqual([general]);
    await refreshInferredTasteSignals(db,userId,now);
    const badges=await db.select().from(userTasteBadges).where(eq(userTasteBadges.userId,userId));
    expect(badges.some(row=>row.badgeId==="food-gukbap"&&row.source==="INFERRED")).toBe(true);
    expect(badges.some(row=>row.badgeId==="food-ramen"&&row.source==="INFERRED")).toBe(false);
  });

});
