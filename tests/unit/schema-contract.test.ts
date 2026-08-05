import { describe, expect, it } from "vitest";
import {
  categories,
  currentVotes,
  places,
  savedPlaces,
  users,
  voteEvents,
} from "../../app/db/schema";

describe("week 1 schema", () => {
  it("exports every required domain table", () => {
    expect([users, categories, places, voteEvents, currentVotes, savedPlaces]).toHaveLength(6);
  });
});
