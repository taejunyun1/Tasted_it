import { describe, expect, it } from "vitest";
import {
  categories,
  adminAuditLogs,
  businessLicenses,
  currentVotes,
  places,
  placeSourceLinks,
  publicDataSyncRuns,
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
});
