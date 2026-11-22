import { parseMapState } from "../maps/map-state";
import { updateMapSearch } from "../maps/map-selection";
import { parsePublicPlacePage } from "./public-place-pagination";

export function readPublicPlaceBrowse(search: string) {
  const params = new URLSearchParams(search);
  const state = parseMapState(search);
  const categorySlug = params.get("category") || undefined;
  const tempOnly = params.get("temp") === "1";
  return {
    state,
    filters: { categorySlug, query: state.query, bbox: tempOnly ? undefined : state.bbox, tempOnly },
    page: parsePublicPlacePage(search),
  };
}

export function publicPlaceBrowseHref(destination: "map" | "list", search: string, options: {
  selected?: string | null;
  badges?: readonly string[];
  page?: number;
} = {}) {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();
  if (destination === "map") next.set("view", "browse");
  for (const key of ["q", "category", "bbox"]) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  if (current.get("temp") === "1") next.set("temp", "1");
  for (const badge of options.badges ?? current.getAll("badge")) next.append("badge", badge);
  const page = options.page ?? parsePublicPlacePage(search);
  if (page !== null && page > 1) next.set("page", String(page));
  if (options.selected) next.set("selected", options.selected);
  if (current.has("qa")) next.set("qa", "1");
  return `${destination === "map" ? "/" : "/places"}${next.size ? `?${next}` : ""}`;
}

export function updatePublicPlaceBrowseSearch(current: URLSearchParams, change: Parameters<typeof updateMapSearch>[1]) {
  const next = updateMapSearch(current, change);
  next.set("view", "browse");
  const before = readPublicPlaceBrowse(current.toString()).filters;
  const after = readPublicPlaceBrowse(next.toString()).filters;
  if (before.query !== after.query || before.categorySlug !== after.categorySlug
    || before.bbox?.some((value, index) => value !== after.bbox?.[index])) {
    next.delete("page");
    next.delete("place");
  }
  return next;
}
