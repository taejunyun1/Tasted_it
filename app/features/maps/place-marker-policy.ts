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
