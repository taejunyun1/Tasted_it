import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cleanupSqlUrl = new URL("../../scripts/remove-sample-places.sql", import.meta.url);
const sampleIds = Array.from({ length: 6 }, (_, index) => `sample-place-${index + 1}`);

describe("sample place cleanup", () => {
  it("targets only the six known sample restaurant ids", () => {
    const sql = readFileSync(cleanupSqlUrl, "utf8");

    for (const id of sampleIds) expect(sql).toContain(`'${id}'`);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+places\s*;/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+places\s+WHERE\s+1\s*=\s*1/i);
  });

  it("removes restrictive rating rows before deleting sample places", () => {
    const sql = readFileSync(cleanupSqlUrl, "utf8");
    const currentVotes = sql.indexOf("DELETE FROM current_votes");
    const invalidatedVotes = sql.indexOf("DELETE FROM invalidated_vote_events");
    const voteEvents = sql.indexOf("DELETE FROM vote_events");
    const goldenPicks = sql.indexOf("DELETE FROM golden_pick_events");
    const places = sql.indexOf("DELETE FROM places");

    expect(currentVotes).toBeGreaterThanOrEqual(0);
    expect(invalidatedVotes).toBeGreaterThan(currentVotes);
    expect(voteEvents).toBeGreaterThan(invalidatedVotes);
    expect(goldenPicks).toBeGreaterThan(voteEvents);
    expect(places).toBeGreaterThan(goldenPicks);
  });
});
