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

  let decoded = value;
  try {
    for (let count = 0; count < 3; count += 1) {
      const next = decodeURIComponent(decoded);
      if (next.includes("\\") || next.startsWith("//")) return fallback;
      if (next === decoded) break;
      decoded = next;
    }
    const base = new URL("https://retaste.invalid");
    const destination = new URL(decoded, base);
    if (destination.origin !== base.origin) return fallback;
    if (destination.pathname === "/places" || destination.pathname === "/places.data") {
      return canonicalPlacesReturnTo(destination);
    }
    return value;
  } catch {
    return fallback;
  }
}
