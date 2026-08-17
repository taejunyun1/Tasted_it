export const placeOperationsTabs = ["review", "liveness", "corrections", "duplicates"] as const;

export type PlaceOperationsTab = (typeof placeOperationsTabs)[number];

export function parsePlaceOperationsTab(url: URL): PlaceOperationsTab {
  const tab = url.searchParams.get("tab");
  return tab === "liveness" || tab === "corrections" || tab === "duplicates" ? tab : "review";
}

export function placeOperationsTabHref(tab: PlaceOperationsTab) {
  return tab === "review" ? "/admin/place-operations" : `/admin/place-operations?tab=${tab}`;
}
