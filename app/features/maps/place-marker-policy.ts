export type MarkerInfluence = "base" | "medium" | "high";

export function getMarkerInfluence(positive: number, negative: number): MarkerInfluence {
  const votes = Math.max(0, positive) + Math.max(0, negative);
  if (votes >= 25) return "high";
  if (votes >= 8) return "medium";
  return "base";
}

export function getMarkerFocusZoom(currentZoom: number, targetZoom = 16): number | null {
  return currentZoom < targetZoom ? targetZoom : null;
}

export function getClusterFocusZoom(level: "DISTRICT" | "NEIGHBORHOOD"): number {
  return level === "DISTRICT" ? 13 : 15;
}

export function getClusterFocusBounds(
  bounds: [west: number, south: number, east: number, north: number],
  level: "DISTRICT" | "NEIGHBORHOOD",
): [west: number, south: number, east: number, north: number] {
  const [west, south, east, north] = bounds;
  const minimumLongitudePadding = level === "DISTRICT" ? 0.04 : 0.005;
  const minimumLatitudePadding = level === "DISTRICT" ? 0.03 : 0.005;
  const longitudePadding = Math.max((east - west) * 0.05, minimumLongitudePadding);
  const latitudePadding = Math.max((north - south) * 0.05, minimumLatitudePadding);
  const round = (value: number) => Number(value.toFixed(6));
  return [
    round(west - longitudePadding),
    round(south - latitudePadding),
    round(east + longitudePadding),
    round(north + latitudePadding),
  ];
}
