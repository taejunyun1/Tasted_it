import type { PlaceSummary } from "../places/place.types";

interface MapSearchChange {
  selected?: string | null;
  q?: string | null;
  category?: string | null;
  bbox?: string | null;
}

export function findSelectedPlace(places: PlaceSummary[], selectedId: string | null) {
  return selectedId ? places.find((place) => place.id === selectedId) ?? null : null;
}

export function updateMapSearch(current: URLSearchParams, change: MapSearchChange) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(change)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}
