import { z } from "zod";

export const CORRECTION_PLACE_PAGE_SIZE = 20;
const safeText = z.string().regex(/^[^\u0000-\u001f\u007f]*$/u);
export const correctionPlaceIdSchema = safeText.min(1).max(128).refine(value => value.trim() === value);
const cursorSchema = z.object({ query: safeText.max(100), id: correctionPlaceIdSchema }).strict();
const inputSchema = z.object({ query: safeText.trim().max(100), cursor: z.string().max(2048).optional(), requestKey: z.string().regex(/^[A-Za-z0-9_-]{0,80}$/) });
export type CorrectionPlaceOption = { id: string; name: string; address: string };
export type CorrectionPlacePage = { query: string; places: CorrectionPlaceOption[]; nextCursor: string | null };
export type CorrectionPlaceResponse = { ok: true; requestKey: string; page: CorrectionPlacePage } | { ok: false; requestKey: string; message: string };
export type CorrectionPlaceSearchInput = z.infer<typeof inputSchema> & { after?: z.infer<typeof cursorSchema> };
export class CorrectionPlaceSearchInputError extends Error {
  constructor() { super("CORRECTION_PLACE_SEARCH_INVALID"); }
}

export function encodeCorrectionPlaceCursor(value: z.infer<typeof cursorSchema>) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function parseCorrectionPlaceSearch(search: URLSearchParams): CorrectionPlaceSearchInput {
  try {
    for (const key of ["q", "cursor", "requestKey"]) if (search.getAll(key).length > 1) throw new Error();
    const parsed = inputSchema.parse({ query: search.get("q") ?? "", cursor: search.get("cursor") || undefined, requestKey: search.get("requestKey") ?? "" });
    if (!parsed.cursor) return parsed;
    if (!/^[A-Za-z0-9_-]+$/.test(parsed.cursor)) throw new Error();
    const bytes = Uint8Array.from(atob(parsed.cursor.replaceAll("-", "+").replaceAll("_", "/")), character => character.charCodeAt(0));
    const after = cursorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (after.query !== parsed.query) throw new Error();
    return { ...parsed, after };
  } catch { throw new CorrectionPlaceSearchInputError(); }
}

export function correctionPlaceSearchHref(query: string, requestKey: string, cursor?: string | null) {
  const search = new URLSearchParams({ q: query, requestKey });
  if (cursor) search.set("cursor", cursor);
  return `/resources/correction-places?${search}`;
}
