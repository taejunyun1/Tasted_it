const PLACES_SINGLE_VALUE_FILTERS = new Set(["bbox", "category", "q"]);
const PLACES_MULTI_VALUE_FILTERS = new Set(["badge"]);

export function canonicalPlacesReturnTo(value: string | URL) {
  const source = typeof value === "string"
    ? new URL(value, "https://retaste.invalid")
    : value;
  const filters = new URLSearchParams();
  const seenSingleValueFilters = new Set<string>();

  for (const [key, filterValue] of source.searchParams) {
    if (PLACES_MULTI_VALUE_FILTERS.has(key)) {
      filters.append(key, filterValue);
      continue;
    }
    if (!PLACES_SINGLE_VALUE_FILTERS.has(key) || seenSingleValueFilters.has(key)) continue;
    filters.set(key, filterValue);
    seenSingleValueFilters.add(key);
  }

  const search = filters.toString();
  return `/places${search ? `?${search}` : ""}`;
}

export function safeOnboardingReturnTo(value: string | null | undefined) {
  const fallback = "/places";
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;

  try {
    const base = new URL("https://retaste.invalid");
    const destination = new URL(value, base);
    const rawPathname = value.split(/[?#]/u, 1)[0];
    if (destination.origin !== base.origin || destination.hash) return fallback;
    if (rawPathname !== "/places" && rawPathname !== "/places.data") return fallback;
    if (destination.pathname !== rawPathname) return fallback;
    return canonicalPlacesReturnTo(destination);
  } catch {
    return fallback;
  }
}
