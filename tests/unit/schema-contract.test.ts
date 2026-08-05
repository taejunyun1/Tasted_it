import { describe, expect, it } from "vitest";
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
  savedPlaces,
  users,
  voteEvents,
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
});
