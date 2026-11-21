import { parseMapState } from "../maps/map-state";

export function readPlaceSearchContext(search: string) {
  const params = new URLSearchParams(search);
  const state = parseMapState(search);
  return {
    query: state.query,
    categorySlug: params.get("category") ?? "",
    bbox: state.bbox,
    tempOnly: params.get("temp") === "1",
    badges: params.getAll("badge"),
  };
}

export type PlaceSearchContext = ReturnType<typeof readPlaceSearchContext>;
