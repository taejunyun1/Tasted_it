import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import { publicVenueVisibilityCondition } from "../places/public-venue-visibility.server";
import type { AppDb } from "../../db/client.server";
import {
  currentVotes,
  places,
  reviewerPublicationState,
} from "../../db/schema";

export const REVIEWER_PUBLICATION_RULE = "cst-reviewer-publication-v1";

export function currentPublicationEpochSql() {
  return sql<number>`(select epoch from reviewer_publication_state where id='global')`;
}

export async function getPublicationEpoch(db: AppDb) {
  const state = await db
    .select()
    .from(reviewerPublicationState)
    .where(eq(reviewerPublicationState.id, "global"))
    .limit(1);
  if (!state[0]) throw new Error("PUBLICATION_STATE_UNAVAILABLE");
  return state[0].epoch;
}

export async function getPlaceVoteRevision(db: AppDb, placeId: string) {
  const [row] = await db
    .select({ revision: places.voteRevision })
    .from(places)
    .where(eq(places.id, placeId))
    .limit(1);
  if (!row) throw new Error("PLACE_NOT_FOUND");
  return row.revision;
}

/** Place-level predicate for submissions, including places with no review yet. */
export function reviewerSubmissionPlaceCondition() {
  return and(
    sql`${places.status}='PUBLISHED' and ${places.closedAt} is null`,
    publicVenueVisibilityCondition(),
    sql`not exists(select 1 from place_liveness_states where place_id=${places.id} and recommendation_excluded=1)`,
  );
}

/** Optimized predicate for the place referenced by an existing review. */
export function eligibleReviewPlaceCondition(placeId: SQLWrapper | string) {
  return sql<boolean>`exists(select 1 from reviewer_public_place_ids where id=${placeId})`;
}

export function eligibleReviewCondition(
  reviewId: SQLWrapper | string,
  contentVersion?: SQLWrapper | number,
) {
  return sql<boolean>`exists(select 1 from reviewer_visit_reviews public_review
    inner join reviewer_profiles public_profile on public_profile.user_id=public_review.reviewer_user_id
    inner join users public_author on public_author.id=public_review.reviewer_user_id
    where (public_review.id=${reviewId}
    ${contentVersion === undefined ? sql`` : sql`and public_review.content_version=${contentVersion}`}
    and public_review.status='APPROVED' and public_review.is_current=1
    and public_review.approved_content_version=public_review.content_version)
    and (public_review.reviewed_by is not null and public_review.reviewed_at is not null)
    and (public_review.rule_version=${REVIEWER_PUBLICATION_RULE}
    and public_review.visited_on is not null and length(trim(public_review.visit_note))>0
    and public_review.disclosure='NONE')
    and (public_profile.status='ACTIVE' and public_author.role='REVIEWER'
    and not (lower(public_author.email) like 'withdrawn.%@invalid.local'))
    and ${eligibleReviewPlaceCondition(sql`public_review.place_id`)}
    and public_review.photo_count=(select count(*) from reviewer_visit_photos pp where pp.review_id=public_review.id and pp.content_version=public_review.content_version)
    and not exists(select 1 from reviewer_visit_photos pp where pp.review_id=public_review.id and pp.content_version=public_review.content_version and (
      pp.taken_on is null or pp.rights_basis is null or length(trim(pp.caption))=0 or pp.caption is null
      or pp.privacy_checked<>1 or (pp.rights_basis='PERMISSION' and coalesce(length(trim(pp.rights_note)),0)=0)
    )))`;
}

export function eligibleVoteCondition() {
  return sql<boolean>`exists(select 1 from vote_events public_vote where public_vote.id=${currentVotes.eventId}
    and public_vote.place_id=${currentVotes.placeId} and public_vote.user_id=${currentVotes.userId}
    and public_vote.value=${currentVotes.value} and public_vote.event_type<>'WITHDRAW'
    and not exists(select 1 from invalidated_vote_events ive where ive.vote_event_id=public_vote.id)
    and (public_vote.source='GENERAL' or (public_vote.source='REVIEWER'
      and exists(select 1 from reviewer_visit_reviews bound_review where bound_review.id=public_vote.review_id and bound_review.reviewer_user_id=public_vote.user_id and bound_review.place_id=public_vote.place_id and ((bound_review.evaluation='RECOMMEND' and public_vote.value=1) or (bound_review.evaluation='NOT_RECOMMEND' and public_vote.value=-1)))
      and ${eligibleReviewCondition(sql`public_vote.review_id`, sql`public_vote.review_version`)})))`;
}
