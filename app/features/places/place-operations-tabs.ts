export const placeOperationsTabs = ["audit", "naver", "liveness", "suggestions", "corrections", "duplicates"] as const;

export type PlaceOperationsTab = (typeof placeOperationsTabs)[number];

export function parsePlaceOperationsTab(value: string | null): PlaceOperationsTab {
  return placeOperationsTabs.includes(value as PlaceOperationsTab) ? value as PlaceOperationsTab : "naver";
}
