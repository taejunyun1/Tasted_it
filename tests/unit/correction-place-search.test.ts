import { describe, expect, it, vi } from "vitest";
import { correctionPlaceSearchHref, encodeCorrectionPlaceCursor, parseCorrectionPlaceSearch } from "../../app/features/places/correction-place-search";

describe("correction place search boundary", () => {
  it("round trips bounded Korean search and cursor without treating wildcard text as syntax", () => {
    const query = "광주 %_국밥";
    const cursor = encodeCorrectionPlaceCursor({ query, id: "place-1001" });
    const href = correctionPlaceSearchHref(query, "request-1", cursor);
    expect(parseCorrectionPlaceSearch(new URL(href, "https://example.com").searchParams)).toMatchObject({ query, requestKey: "request-1", after: { query, id: "place-1001" } });
  });
  it.each(["q=a&q=b", `q=${"가".repeat(101)}`, "q=%00", "q=%0Aabc", "cursor=bad", "cursor=x&cursor=y", "requestKey=%3Cscript%3E"])("rejects ambiguous or malformed input: %s", input => {
    expect(() => parseCorrectionPlaceSearch(new URLSearchParams(input))).toThrow("CORRECTION_PLACE_SEARCH_INVALID");
  });
  it("rejects a cursor reused for another query", () => {
    expect(() => parseCorrectionPlaceSearch(new URLSearchParams({ q: "다른 조건", cursor: encodeCorrectionPlaceCursor({ query: "원래 조건", id: "place" }) }))).toThrow("CORRECTION_PLACE_SEARCH_INVALID");
  });
});

vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));
vi.mock("../../app/db/client.server", () => ({ createDb: vi.fn() }));
vi.mock("../../app/features/places/correction-place-search.server", () => ({ listCorrectionPlacePage: vi.fn() }));

it("keeps a failed search retryable without exposing transport details or clearing the draft", async () => {
  const { clientLoader } = await import("../../app/routes/correction-places-resource");
  const result = await clientLoader({ request: new Request("https://example.com/resources/correction-places?requestKey=lookup-3"), serverLoader: async () => { throw new TypeError("private connection detail"); } } as never);
  expect(result).toMatchObject({ ok: false, requestKey: "lookup-3" });
  expect(JSON.stringify(result)).not.toContain("private connection detail");
});

it("preserves redirect semantics instead of swallowing a route redirect", async () => {
  const { clientLoader } = await import("../../app/routes/correction-places-resource");
  const redirect = new Response(null, { status: 302, headers: { Location: "/corrections/new" } });
  await expect(clientLoader({ request: new Request("https://example.com/resources/correction-places"), serverLoader: async () => { throw redirect; } } as never)).rejects.toBe(redirect);
});
