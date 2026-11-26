import { z } from "zod";

export const REVIEWER_PLACE_PAGE_SIZE = 20;
export type ReviewerPlaceOption = { placeId: string; placeName: string; address: string; neighborhood: string | null; categoryId: string; categoryName: string; categoryEmoji: string };
export type ReviewerPlacePage = { query: string; places: ReviewerPlaceOption[]; nextCursor: string | null };
export type ReviewerPlaceResponse = { ok: true; requestKey: string; page: ReviewerPlacePage; selectedPlace: ReviewerPlaceOption | null } | { ok: false; requestKey: string; message: string; restartSearch?: true };
const safeText = z.string().regex(/^[^\u0000-\u001f\u007f]*$/u);
const id = safeText.min(1).max(128);
const cursorSchema = z.object({ query: safeText.max(100), id, reviewed: z.union([z.literal(0), z.literal(1)]) }).strict();
const inputSchema = z.object({ query: safeText.trim().max(100), cursor: z.string().max(2048).optional(), selectedId: id.optional(), requestKey: z.string().regex(/^[A-Za-z0-9_-]{0,80}$/) });
export class ReviewerPlaceSearchInputError extends Error {
  constructor() { super("REVIEWER_PLACE_SEARCH_INVALID"); }
}
export type ReviewerPlaceSearchInput = z.infer<typeof inputSchema> & { after?: z.infer<typeof cursorSchema> };

export function encodeReviewerPlaceCursor(value: z.infer<typeof cursorSchema>) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export function parseReviewerPlaceSearch(search: URLSearchParams): ReviewerPlaceSearchInput {
  try {
    for (const key of ["q", "cursor", "selectedId", "requestKey"]) if (search.getAll(key).length > 1) throw new Error();
    const parsed = inputSchema.parse({ query: search.get("q") ?? "", cursor: search.get("cursor") || undefined, selectedId: search.get("selectedId") || undefined, requestKey: search.get("requestKey") ?? "" });
    if (!parsed.cursor) return parsed;
    if (!/^[A-Za-z0-9_-]+$/.test(parsed.cursor)) throw new Error();
    const bytes = Uint8Array.from(atob(parsed.cursor.replaceAll("-", "+").replaceAll("_", "/")), (character) => character.charCodeAt(0));
    const after = cursorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (after.query !== parsed.query) throw new Error();
    return { ...parsed, after };
  } catch { throw new ReviewerPlaceSearchInputError(); }
}

export function reviewerPlaceSearchHref(query: string, requestKey: string, cursor?: string | null, selectedId?: string) {
  const search = new URLSearchParams({ q: query, requestKey });
  if (cursor) search.set("cursor", cursor);
  if (selectedId) search.set("selectedId", selectedId);
  return `/resources/reviewer-places?${search}`;
}
