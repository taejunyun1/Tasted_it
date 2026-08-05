export const DEFAULT_BBOX = [126.72, 35.03, 127.02, 35.25] as const;

export interface MapState {
  bbox: [number, number, number, number];
  selected: string | null;
  query: string;
  view: "map" | "list";
}

export function parseMapState(search: string): MapState {
  const params = new URLSearchParams(search);
  const parts = params.get("bbox")?.split(",").map(Number);
  const valid = parts?.length === 4 && parts.every(Number.isFinite) &&
    parts[0] >= 124 && parts[2] <= 132 && parts[1] >= 33 && parts[3] <= 39 &&
    parts[0] < parts[2] && parts[1] < parts[3];

  return {
    bbox: valid ? parts as [number, number, number, number] : [...DEFAULT_BBOX],
    selected: params.get("selected") || null,
    query: params.get("q")?.trim() ?? "",
    view: params.get("view") === "list" ? "list" : "map",
  };
}
