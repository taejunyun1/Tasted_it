import { expect, it } from "vitest";
import { encodeReviewerPlaceCursor, parseReviewerPlaceSearch, reviewerPlaceSearchHref } from "../../app/features/ratings/reviewer-place-search";

it("keeps a cursor bound to its literal query and validates untrusted cursor content", () => {
  const cursor = encodeReviewerPlaceCursor({ query: "라멘", id: "place-last", reviewed: 0 });
  expect(parseReviewerPlaceSearch(new URLSearchParams({ q: "라멘", cursor, requestKey: "search-1" }))).toMatchObject({ query: "라멘", after: { id: "place-last", reviewed: 0 } });
  for (const search of [new URLSearchParams({ q: "다른 검색", cursor }), new URLSearchParams({ cursor: "malformed%" }), new URLSearchParams({ q: "가".repeat(101) }), new URLSearchParams("q=first&q=second")]) {
    expect(() => parseReviewerPlaceSearch(search)).toThrow("REVIEWER_PLACE_SEARCH_INVALID");
  }
});

it("encodes search and selected IDs without turning input into another route or option", () => {
  const href = reviewerPlaceSearchHref("%_ & 한글", "lookup-2", null, "place&next=other");
  const url = new URL(href, "https://retaste.test");
  expect(url.pathname).toBe("/resources/reviewer-places");
  expect(url.searchParams.get("q")).toBe("%_ & 한글");
  expect(url.searchParams.get("selectedId")).toBe("place&next=other");
  expect(url.searchParams.has("next")).toBe(false);
});

it("rejects unknown fields inside the cursor rather than trusting client sorting metadata", () => {
  const forged = btoa(JSON.stringify({ query: "", id: "place-last", reviewed: 0, role: "ADMIN" })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  expect(() => parseReviewerPlaceSearch(new URLSearchParams({ cursor: forged }))).toThrow("REVIEWER_PLACE_SEARCH_INVALID");
});
