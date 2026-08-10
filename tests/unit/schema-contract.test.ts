import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import {
  categories,
  adminAuditLogs,
  businessLicenses,
  currentVotes,
  places,
  placeSourceLinks,
  publicDataSyncRuns,
  reviewerApplications,
  reviewerProfiles,
  ratingConfigs,
  ratingSnapshots,
  reviewerReliabilitySnapshots,
  reviewerSimilarityEdges,
  ratingRecomputeJobs,
  goldenPickEvents,
  flavorTemplates,
  flavorRatings,
  placeDailyMetrics,
  integrityCases,
  invalidatedVoteEvents,
  placeSuggestions,
  placeCorrectionRequests,
  placeDuplicateCandidates,
  placeSlugRedirects,
  placeRevisions,
  placeRevalidationCases,
  aiClassificationRuns,
  operationalAlerts,
  savedPlaces,
  users,
  voteEvents,
  parkingDataSnapshots,
  parkingSyncRuns,
  parkingFacilities,
  evChargingStations,
  parkingEvLinks,
  authIdentities,
  oauthRequests,
  tasteBadges,
  userTasteBadges,
  guestTasteSessions,
  guestTasteBadges,
  recommendationFeedback,
  productEvents,
  tasteLearningStates,
} from "../../app/db/schema";

describe("week 1 schema", () => {
  it("exports every required domain table", () => {
    expect([users, categories, places, voteEvents, currentVotes, savedPlaces]).toHaveLength(6);
  });

  it("exports public data candidate tables", () => {
    expect([businessLicenses, placeSourceLinks, publicDataSyncRuns, adminAuditLogs]).toHaveLength(4);
  });

  it("exports reviewer application and profile tables", () => {
    expect(reviewerApplications.status).toBeDefined();
    expect(reviewerProfiles.status).toBeDefined();
  });

  it("exports the versioned rating foundation tables", () => {
    expect([
      ratingConfigs,
      ratingSnapshots,
      reviewerReliabilitySnapshots,
      reviewerSimilarityEdges,
      ratingRecomputeJobs,
      goldenPickEvents,
      flavorTemplates,
      flavorRatings,
      placeDailyMetrics,
      integrityCases,
      invalidatedVoteEvents,
    ]).toHaveLength(11);
    expect(ratingConfigs.algorithmVersion).toBeDefined();
    expect(ratingSnapshots.inputHash).toBeDefined();
    expect(integrityCases.status).toBeDefined();
  });

  it("exports place operations and revision tables", () => {
    expect([placeSuggestions, placeCorrectionRequests, placeDuplicateCandidates, placeSlugRedirects, placeRevisions, placeRevalidationCases]).toHaveLength(6);
    expect(places.lastVerifiedAt).toBeDefined();
    expect(placeSuggestions.status).toBeDefined();
    expect(placeRevisions.action).toBeDefined();
  });

  it("exports AI classification history and operational alerts", () => {
    expect([aiClassificationRuns, operationalAlerts]).toHaveLength(2);
    expect(aiClassificationRuns.inputHash).toBeDefined();
    expect(operationalAlerts.occurrenceCount).toBeDefined();
  });

  it("exports parking snapshot and facility tables", () => {
    expect([parkingDataSnapshots, parkingSyncRuns, parkingFacilities, evChargingStations, parkingEvLinks]).toHaveLength(5);
    expect(parkingFacilities.reliabilityGrade).toBeDefined();
    expect(parkingDataSnapshots.status).toBeDefined();
  });

  it("exports provider-aware OAuth identity and request fields", () => {
    expect(authIdentities.provider).toBeDefined();
    expect(oauthRequests.provider).toBeDefined();
    expect(oauthRequests.flow).toBeDefined();
    expect(oauthRequests.codeVerifier).toBeDefined();
    expect(oauthRequests.userId).toBeDefined();
  });

  it("exports profile taste badge and source score tables", () => {
    expect(tasteBadges.category).toBeDefined();
    expect(tasteBadges.headlineNoun).toBeDefined();
    expect(userTasteBadges.score).toBeDefined();
    expect(userTasteBadges.source).toBeDefined();
  });

  it("exports app-first onboarding and feedback tables", () => {
    expect(guestTasteSessions.expiresAt).toBeDefined();
    expect(guestTasteSessions.mergedUserId).toBeDefined();
    expect(guestTasteBadges.badgeId).toBeDefined();
    expect(recommendationFeedback.reason).toBeDefined();
    expect(productEvents.eventName).toBeDefined();
    expect(getTableConfig(productEvents).indexes.map((eventIndex) => ({
      name: eventIndex.config.name,
      unique: eventIndex.config.unique,
    }))).toEqual(expect.arrayContaining([
      { name: "product_events_guest_event_uidx", unique: true },
    ]));
  });

  it("exports dedicated per-user taste learning concurrency state", () => {
    expect(tasteLearningStates.userId).toBeDefined();
    expect(tasteLearningStates.versionToken).toBeDefined();
    expect(tasteLearningStates.createdAt).toBeDefined();
    expect(tasteLearningStates.updatedAt).toBeDefined();
    expect(getTableConfig(tasteLearningStates).foreignKeys).toEqual([
      expect.objectContaining({ onDelete: "cascade" }),
    ]);
  });
});
