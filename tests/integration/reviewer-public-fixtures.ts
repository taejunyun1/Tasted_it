import { eq } from "drizzle-orm";
import type { AppDb } from "../../app/db/client.server";
import { categories, currentVotes, placeCategories, reviewerProfiles, reviewerVisitPhotos, reviewerVisitReviews, users, voteEvents } from "../../app/db/schema";
import { getPlaceVoteRevision, getPublicationEpoch, REVIEWER_PUBLICATION_RULE } from "../../app/features/ratings/reviewer-publication.server";

// Synthetic fixtures explicitly carry approval provenance; timestamps or matching
// users/places are never used to upgrade a legacy row into an approved review.
export async function seedApprovedReviewerVote(db: AppDb, input: {
  reviewerId: string; placeId: string; eventId: string; value: -1 | 1; now: string; projectVote?: boolean; withPhoto?: boolean;
}) {
  const adminId = "public-fixture-admin";
  await db.insert(users).values({id:adminId,email:"public-fixture-admin@example.test",displayName:"합성 검수 관리자",role:"ADMIN",createdAt:input.now,updatedAt:input.now}).onConflictDoNothing();
  await db.insert(reviewerProfiles).values({userId:input.reviewerId,slug:input.reviewerId,status:"ACTIVE",occupation:"합성시험",tasteDirection:"균형",regionCode:"GWANGJU",specialtySlugs:"[]",lastActivityAt:input.now,approvedAt:input.now,approvedBy:adminId,createdAt:input.now,updatedAt:input.now}).onConflictDoNothing();
  let primary = await db.query.placeCategories.findFirst({where:eq(placeCategories.placeId,input.placeId)});
  if (!primary) {
    const categoryId="public-fixture-category";
    await db.insert(categories).values({id:categoryId,slug:categoryId,name:"라멘",emoji:"🍜",sortOrder:999,isActive:true,createdAt:input.now,updatedAt:input.now}).onConflictDoNothing();
    await db.insert(placeCategories).values({placeId:input.placeId,categoryId,isPrimary:true});
    primary = await db.query.placeCategories.findFirst({where:eq(placeCategories.placeId,input.placeId)});
  }
  const reviewId=`review-${input.eventId}`;
  await db.insert(reviewerVisitReviews).values({
    id:reviewId,placeId:input.placeId,reviewerUserId:input.reviewerId,categoryId:primary!.categoryId,
    evaluation:input.value===1?"RECOMMEND":"NOT_RECOMMEND",badgesJson:"[]",photoCount:input.withPhoto ? 1 : 0,
    status:"APPROVED",isCurrent:true,contentVersion:1,approvedContentVersion:1,visitedOn:input.now.slice(0,10),visitNote:"합성 방문 근거",disclosure:"NONE",
    reviewedBy:adminId,reviewedAt:input.now,ruleVersion:REVIEWER_PUBLICATION_RULE,reviewReason:"합성 fixture 명시 승인",version:2,publishedAt:input.now,createdAt:input.now,updatedAt:input.now,
  }).onConflictDoNothing();
  if (input.withPhoto) {
    await db.insert(reviewerVisitPhotos).values({id:`photo-${input.eventId}`,reviewId,contentVersion:1,takenOn:input.now.slice(0,10),rightsBasis:"OWN_WORK",rightsNote:null,caption:"합성 직접 촬영 사진",privacyChecked:true,objectKey:`reviews/${reviewId}/fixture.jpg`,contentType:"image/jpeg",byteSize:4,position:0,createdAt:input.now,updatedAt:input.now}).onConflictDoNothing();
  }
  if (input.projectVote !== false) {
  await db.insert(voteEvents).values({id:input.eventId,placeId:input.placeId,userId:input.reviewerId,value:input.value,eventType:"CREATE",source:"REVIEWER",reviewId,reviewVersion:1,createdAt:input.now}).onConflictDoNothing();
  await db.insert(currentVotes).values({placeId:input.placeId,userId:input.reviewerId,eventId:input.eventId,value:input.value,updatedAt:input.now}).onConflictDoNothing();
  }
  return { reviewId };
}

export async function publicationSnapshotStamp(db: AppDb, placeId: string) {
  const [moderationEpoch,voteRevision]=await Promise.all([getPublicationEpoch(db),getPlaceVoteRevision(db,placeId)]);
  return { moderationEpoch, voteRevision };
}
