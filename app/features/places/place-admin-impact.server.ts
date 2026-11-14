import { REVIEWER_PUBLICATION_RULE } from "../ratings/reviewer-publication.server";
import {
  CU_CONVENIENCE_PREFIX,
  NON_RESTAURANT_PUBLIC_NAME_PREFIXES,
  NON_RESTAURANT_PUBLIC_NAME_TERMS,
  NON_RESTAURANT_SOURCE_SUBTYPE_TERMS,
} from "./food-venue-policy";
import type { PlaceSnapshot } from "./place-admin-snapshot.server";

type Row = Record<string, unknown>;
type Flag = -1 | 0 | 1;
type ImpactInput = {
  change: "PUBLISH" | "MERGE" | "RECALL" | "RESTORE_RECALL";
  targetId: string;
  sourceId?: string;
  now: string;
  publishedCategoryId?: string;
  publishedLicenseId?: string;
};
const UNKNOWN = -1;
const truth = (value: unknown) => value === true || value === 1;
const has = (row: Row, keys: string[]) => keys.every((key) => Object.hasOwn(row, key));
const at = (rows: PlaceSnapshot, key: string) => Array.isArray(rows[key]) ? rows[key] : undefined;
const rowsAt = (rows: PlaceSnapshot, key: string, id: string, field = "placeId") => at(rows, key)?.filter((row) => row[field] === id);
const count = (rows: Row[] | undefined) => rows?.length ?? UNKNOWN;
const asciiLower = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
// Match SQLite lower()/replace(), not the broader ingestion NFKC normalization.
const venueText = (value: unknown) => asciiLower(typeof value === "string" ? value : "").replace(/[\t\n\r \u00a0\u3000]/g, "");
const sqlTrim = (value: unknown) => typeof value === "string" ? value.replace(/^ +| +$/g, "") : "";
const combine = (...values: Flag[]): Flag => values.includes(0) ? 0 : values.includes(UNKNOWN) ? UNKNOWN : 1;

function nonRestaurantName(value: unknown) {
  const name = venueText(value);
  return NON_RESTAURANT_PUBLIC_NAME_TERMS.some((term) => name.includes(term))
    || NON_RESTAURANT_PUBLIC_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))
    || name === CU_CONVENIENCE_PREFIX || /^cu(?:[가-힣]|[0-9])/.test(name);
}

/** Mirrors publicVenueVisibilityCondition, including any linked override and every source. */
function venueAllowed(rows: PlaceSnapshot, place: Row | undefined, placeId: string): Flag {
  if (!place || !Object.hasOwn(place, "name")) return UNKNOWN;
  const links = rowsAt(rows, "sourceLinks", placeId), licenses = at(rows, "licenses"), exclusions = at(rows, "exclusions");
  if (!links || !licenses || !exclusions) return UNKNOWN;
  let override = false;
  for (const link of links) {
    if (!Object.hasOwn(link, "businessLicenseId")) return UNKNOWN;
    const decisions = exclusions.filter((row) => row.businessLicenseId === link.businessLicenseId);
    if (decisions.some((row) => row.status === "OVERRIDDEN")) override = true;
    const license = licenses.find((row) => row.id === link.businessLicenseId);
    if (!license || !has(license, ["businessName", "businessSubtype"])) return UNKNOWN;
    const sourceExcluded = nonRestaurantName(license.businessName)
      || NON_RESTAURANT_SOURCE_SUBTYPE_TERMS.some((term) => venueText(license.businessSubtype).includes(term));
    // The SQL left join rejects a non-overridden exclusion row, even if another override exists.
    if (sourceExcluded && (!decisions.length || decisions.some((row) => row.status !== "OVERRIDDEN"))) return 0;
  }
  return !nonRestaurantName(place.name) || override ? 1 : 0;
}

function flags(rows: PlaceSnapshot, id: string, knownAbsent = false): { public: Flag; recommendation: Flag; reviewer: Flag } {
  const place = at(rows, "places")?.find((row) => row.id === id);
  if (!place) return { public: knownAbsent ? 0 : UNKNOWN, recommendation: knownAbsent ? 0 : UNKNOWN, reviewer: knownAbsent ? 0 : UNKNOWN };
  const published: Flag = place.status === "PUBLISHED" ? 1 : Object.hasOwn(place, "status") ? 0 : UNKNOWN;
  const venue = venueAllowed(rows, place, id);
  const links = rowsAt(rows, "placeCategories", id), categories = at(rows, "categories");
  const category: Flag = !links || !categories ? UNKNOWN
    : links.some((row) => truth(row.isPrimary) && categories.some((item) => item.id === row.categoryId)) ? 1 : 0;
  const liveness = rowsAt(rows, "liveness", id);
  const notExcluded: Flag = !liveness ? UNKNOWN : liveness.some((row) => truth(row.recommendationExcluded)) ? 0 : 1;
  const reviews = rowsAt(rows, "reviews", id);
  const currentReview: Flag = !reviews ? UNKNOWN : reviews.some((row) => truth(row.isCurrent)) ? 1 : 0;
  const open: Flag = !Object.hasOwn(place, "closedAt") ? UNKNOWN : place.closedAt === null ? 1 : 0;
  const publicFlag = combine(published, venue, category);
  return { public: publicFlag, recommendation: combine(publicFlag, notExcluded), reviewer: combine(published, open, venue, notExcluded, currentReview) };
}

/** Mirrors eligibleReviewCondition; it does not infer publication from approval alone. */
function reviewVisible(rows: PlaceSnapshot, review: Row, placeFlag: Flag): Flag {
  if (placeFlag === 0) return 0;
  const required = ["status", "isCurrent", "contentVersion", "approvedContentVersion", "reviewedBy", "reviewedAt", "ruleVersion", "visitedOn", "visitNote", "disclosure", "reviewerUserId", "photoCount"];
  if (!has(review, required)) return UNKNOWN;
  if (review.status !== "APPROVED" || !truth(review.isCurrent) || review.approvedContentVersion !== review.contentVersion
    || review.reviewedBy === null || review.reviewedAt === null || review.ruleVersion !== REVIEWER_PUBLICATION_RULE
    || review.visitedOn === null || !sqlTrim(review.visitNote) || review.disclosure !== "NONE") return 0;
  const profiles = at(rows, "profiles"), people = at(rows, "people"), photos = at(rows, "photos");
  if (!profiles || !people || !photos) return UNKNOWN;
  const profile = profiles.find((row) => row.userId === review.reviewerUserId), person = people.find((row) => row.id === review.reviewerUserId);
  if (!profile || !person) return 0;
  if (profile.status !== "ACTIVE" || person.role !== "REVIEWER") return 0;
  if (typeof person.email !== "string") return UNKNOWN;
  if (/^withdrawn\..*@invalid\.local$/.test(asciiLower(person.email))) return 0;
  const currentPhotos = photos.filter((row) => row.reviewId === review.id && row.contentVersion === review.contentVersion);
  if (review.photoCount !== currentPhotos.length) return 0;
  for (const photo of currentPhotos) {
    if (!has(photo, ["takenOn", "rightsBasis", "caption", "privacyChecked", "rightsNote"])) return UNKNOWN;
    if (photo.takenOn === null || photo.rightsBasis === null || !sqlTrim(photo.caption) || !truth(photo.privacyChecked)
      || (photo.rightsBasis === "PERMISSION" && !sqlTrim(photo.rightsNote))) return 0;
  }
  return placeFlag;
}

function visibleContent(rows: PlaceSnapshot, id: string, placeFlag: Flag) {
  const reviews = rowsAt(rows, "reviews", id), photos = at(rows, "photos");
  if (placeFlag === 0) return { reviews: 0, photos: 0 };
  if (!reviews || !photos) return { reviews: UNKNOWN, photos: UNKNOWN };
  let visibleReviews = 0, visiblePhotos = 0;
  for (const review of reviews) {
    const visible = reviewVisible(rows, review, placeFlag);
    if (visible === UNKNOWN) return { reviews: UNKNOWN, photos: UNKNOWN };
    if (visible === 1) {
      visibleReviews++;
      visiblePhotos += photos.filter((photo) => photo.reviewId === review.id && photo.contentVersion === review.contentVersion).length;
    }
  }
  return { reviews: visibleReviews, photos: visiblePhotos };
}

function afterSnapshot(rows: PlaceSnapshot, input: ImpactInput): PlaceSnapshot {
  const after = Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.map((row) => ({ ...row }))]));
  let target = after.places?.find((row) => row.id === input.targetId);
  if (!target && input.change === "PUBLISH" && input.publishedLicenseId) {
    const license = after.licenses?.find((row) => row.id === input.publishedLicenseId);
    if (license) {
      target = { id: input.targetId, name: license.businessName, status: "PUBLISHED", closedAt: null };
      after.places.push(target);
    }
  }
  if (target && input.change !== "MERGE") target.status = input.change === "RECALL" ? "HIDDEN" : "PUBLISHED";
  if (input.change === "PUBLISH") {
    if (input.publishedCategoryId && after.placeCategories) {
      after.placeCategories = after.placeCategories.map((row) => row.placeId === input.targetId ? { ...row, isPrimary: false } : row);
      const selected = after.placeCategories.find((row) => row.placeId === input.targetId && row.categoryId === input.publishedCategoryId);
      if (selected) selected.isPrimary = true;
      else after.placeCategories.push({ placeId: input.targetId, categoryId: input.publishedCategoryId, isPrimary: true });
    } else delete after.placeCategories;
    if (input.publishedLicenseId && after.sourceLinks && !after.sourceLinks.some((row) => row.placeId === input.targetId && row.businessLicenseId === input.publishedLicenseId))
      after.sourceLinks.push({ placeId: input.targetId, businessLicenseId: input.publishedLicenseId });
  }
  if (input.change === "MERGE" && input.sourceId) {
    const source = after.places?.find((row) => row.id === input.sourceId);
    if (source) source.status = "HIDDEN";
    if (after.sourceLinks) after.sourceLinks = after.sourceLinks.map((row) => row.placeId === input.sourceId ? { ...row, placeId: input.targetId } : row);
    if (after.placeCategories) {
      const sourceCategories = after.placeCategories.filter((row) => row.placeId === input.sourceId);
      after.placeCategories = after.placeCategories.filter((row) => row.placeId !== input.sourceId);
      for (const row of sourceCategories) if (!after.placeCategories.some((item) => item.placeId === input.targetId && item.categoryId === row.categoryId))
        after.placeCategories.push({ ...row, placeId: input.targetId, isPrimary: false });
    }
  }
  return after;
}

function mergeImpact(rows: PlaceSnapshot, input: ImpactInput): Record<string, number> {
  const sourceId = input.sourceId!;
  const votes = at(rows, "currentVotes"), events = at(rows, "voteEvents"), invalidations = at(rows, "invalidations");
  const impact: Record<string, number> = {};
  if (!votes || !events || !invalidations) {
    for (const key of ["generalVotesForwarded", "generalVotesBlockedByTargetChoice", "sourceGeneralVotesRemoved", "reviewerVotesRetained"]) impact[key] = UNKNOWN;
  } else {
    const source = votes.filter((row) => row.placeId === sourceId), targetUsers = new Set(votes.filter((row) => row.placeId === input.targetId).map((row) => row.userId));
    const sourceEvent = (vote: Row) => events.find((event) => event.id === vote.eventId);
    const eligible = (vote: Row) => {
      const event = sourceEvent(vote);
      return event?.source === "GENERAL" && event.placeId === vote.placeId && event.userId === vote.userId && event.value === vote.value
        && event.eventType !== "WITHDRAW" && !invalidations.some((row) => row.voteEventId === event.id);
    };
    const forwarded = source.filter((vote) => eligible(vote) && !targetUsers.has(vote.userId));
    const afterTargetUsers = new Set([...targetUsers, ...forwarded.map((row) => row.userId)]);
    impact.generalVotesForwarded = forwarded.length;
    impact.generalVotesBlockedByTargetChoice = source.filter((vote) => eligible(vote) && targetUsers.has(vote.userId)).length;
    impact.sourceGeneralVotesRemoved = source.filter((vote) => sourceEvent(vote)?.source === "GENERAL" && afterTargetUsers.has(vote.userId)).length;
    impact.reviewerVotesRetained = source.filter((vote) => sourceEvent(vote)?.source === "REVIEWER").length;
  }
  impact.reviewerVotesTransferred = 0;
  impact.voteEventsDeleted = 0;
  const saved = at(rows, "savedPlaces"), choices = at(rows, "saveChoices");
  if (!saved || !choices) {
    for (const key of ["memberChoicesCopied", "memberTargetChoicesPreserved", "memberUnsaveProtected", "memberSavesAdded", "memberSavesMoved", "memberSavesRemoved", "memberSavesSourceCleared", "memberSavesDeduplicated"]) impact[key] = UNKNOWN;
  } else {
    const sourceSaved = saved.filter((row) => row.placeId === sourceId), sourceChoices = choices.filter((row) => row.placeId === sourceId);
    const targetChoices = new Map(choices.filter((row) => row.placeId === input.targetId).map((row) => [row.userId, truth(row.saved)]));
    const finalChoices = new Map(targetChoices);
    for (const choice of sourceChoices) if (!finalChoices.has(choice.userId)) finalChoices.set(choice.userId, truth(choice.saved));
    const before = new Set(saved.filter((row) => row.placeId === input.targetId).map((row) => row.userId)), final = new Set(before);
    for (const row of sourceSaved) if (finalChoices.get(row.userId) !== false) final.add(row.userId);
    for (const [userId, shouldSave] of finalChoices) { if (shouldSave) final.add(userId); else final.delete(userId); }
    const sourceUsers = new Set([...sourceSaved, ...sourceChoices].map((row) => row.userId));
    const sourceSaveUsers = new Set([...sourceSaved, ...sourceChoices.filter((row) => truth(row.saved))].map((row) => row.userId));
    impact.memberChoicesCopied = sourceChoices.filter((row) => !targetChoices.has(row.userId)).length;
    impact.memberTargetChoicesPreserved = [...sourceUsers].filter((userId) => targetChoices.has(userId)).length;
    impact.memberUnsaveProtected = [...sourceSaveUsers].filter((userId) => targetChoices.get(userId) === false).length;
    impact.memberSavesAdded = [...final].filter((userId) => !before.has(userId)).length;
    impact.memberSavesMoved = sourceSaved.filter((row) => !before.has(row.userId) && final.has(row.userId)).length;
    impact.memberSavesRemoved = [...before].filter((userId) => !final.has(userId)).length;
    impact.memberSavesSourceCleared = sourceSaved.length;
    impact.memberSavesDeduplicated = sourceSaved.filter((row) => before.has(row.userId) && final.has(row.userId)).length;
  }
  const guests = at(rows, "guestSaves");
  if (!guests) impact.guestSavesMoved = impact.guestSavesDeduplicated = UNKNOWN;
  else {
    const targetSessions = new Set(guests.filter((row) => row.placeId === input.targetId).map((row) => row.sessionId));
    const sourceGuests = guests.filter((row) => row.placeId === sourceId);
    impact.guestSavesMoved = sourceGuests.filter((row) => !targetSessions.has(row.sessionId)).length;
    impact.guestSavesDeduplicated = sourceGuests.filter((row) => targetSessions.has(row.sessionId)).length;
  }
  impact.sourceLinksMoved = count(rowsAt(rows, "sourceLinks", sourceId));
  const sourceCategories = rowsAt(rows, "placeCategories", sourceId), targetCategories = rowsAt(rows, "placeCategories", input.targetId);
  impact.categoriesMoved = sourceCategories && targetCategories ? sourceCategories.filter((row) => !targetCategories.some((target) => target.categoryId === row.categoryId)).length : UNKNOWN;
  impact.categoriesDeduplicated = sourceCategories && targetCategories ? sourceCategories.filter((row) => targetCategories.some((target) => target.categoryId === row.categoryId)).length : UNKNOWN;
  impact.correctionsMoved = count(rowsAt(rows, "corrections", sourceId));
  impact.suggestionsRemapped = count(rowsAt(rows, "suggestions", sourceId, "approvedPlaceId"));
  impact.slugAliasesRetargeted = count(rowsAt(rows, "redirects", sourceId));
  const sourceReviews = rowsAt(rows, "reviews", sourceId), photos = at(rows, "photos");
  impact.sourceReviewsRetained = count(sourceReviews);
  impact.sourcePhotosRetained = sourceReviews && photos ? photos.filter((row) => sourceReviews.some((review) => review.id === row.reviewId)).length : UNKNOWN;
  impact.reviewsTransferred = impact.reviewPhotosTransferred = 0;
  impact.goldenPickRecordsRetained = count(rowsAt(rows, "goldenPicks", sourceId));
  impact.flavorRatingRecordsRetained = count(rowsAt(rows, "flavorRatings", sourceId));
  return impact;
}

/** Only counts and eligibility flags leave this function; no snapshot identifiers or text do. */
export function calculatePlaceAdminImpact(rows: PlaceSnapshot, input: ImpactInput): Record<string, number> {
  const events = at(rows, "voteEvents");
  const impact: Record<string, number> = {
    generalVotes: events ? events.filter((row) => row.source === "GENERAL").length : UNKNOWN,
    reviewerVotes: events ? events.filter((row) => row.source === "REVIEWER").length : UNKNOWN,
    memberSaves: count(at(rows, "savedPlaces")), guestSaves: count(at(rows, "guestSaves")), reviewPhotos: count(at(rows, "photos")),
    reviews: count(at(rows, "reviews")), sourceLinks: count(at(rows, "sourceLinks")), corrections: count(at(rows, "corrections")), categories: count(at(rows, "placeCategories")),
  };
  const after = afterSnapshot(rows, input);
  const ids: Array<[string, string]> = [["target", input.targetId]];
  if (input.sourceId) ids.push(["source", input.sourceId]);
  for (const [prefix, id] of ids) {
    const beforeFlags = flags(rows, id, input.change === "PUBLISH"), afterFlags = flags(after, id);
    impact[`${prefix}PublicBefore`] = beforeFlags.public;
    impact[`${prefix}PublicAfter`] = afterFlags.public;
    impact[`${prefix}RecommendationBefore`] = beforeFlags.recommendation;
    impact[`${prefix}RecommendationAfter`] = afterFlags.recommendation;
    impact[`${prefix}ReviewerEligibilityBefore`] = beforeFlags.reviewer;
    impact[`${prefix}ReviewerEligibilityAfter`] = afterFlags.reviewer;
    const beforeContent = visibleContent(rows, id, beforeFlags.reviewer), afterContent = visibleContent(after, id, afterFlags.reviewer);
    impact[`${prefix}ReviewsVisibleBefore`] = beforeContent.reviews;
    impact[`${prefix}ReviewsVisibleAfter`] = afterContent.reviews;
    impact[`${prefix}ReviewPhotosVisibleBefore`] = beforeContent.photos;
    impact[`${prefix}ReviewPhotosVisibleAfter`] = afterContent.photos;
  }
  if (input.change === "MERGE" && input.sourceId) Object.assign(impact, mergeImpact(rows, input));
  return impact;
}
