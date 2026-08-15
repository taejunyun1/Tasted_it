export type PlaceNameGroupItem = { id: string; name: string; address: string };

export type PlaceNameGroup = {
  normalizedName: string;
  label: string;
  placeIds: string[];
  count: number;
};

export function normalizePlaceName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR")
    .replace(/<[^>]+>/gu, "")
    .replace(/[^0-9a-z가-힣]/gu, "");
}

/** Same-name groups are verification shortcuts only; address/coordinates still distinguish branches. */
export function groupPlacesByNormalizedName(places: PlaceNameGroupItem[]): PlaceNameGroup[] {
  const grouped = new Map<string, PlaceNameGroupItem[]>();
  for (const place of places) {
    const normalizedName = normalizePlaceName(place.name);
    if (!normalizedName) continue;
    grouped.set(normalizedName, [...(grouped.get(normalizedName) ?? []), place]);
  }
  return [...grouped.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([normalizedName, items]) => ({
      normalizedName,
      label: items[0]!.name,
      placeIds: items.map((item) => item.id),
      count: items.length,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "ko-KR"));
}
