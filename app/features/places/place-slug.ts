import { regionFromAddress, slugPrefixForRegion } from "../regions/region-pack";

export function slugifyPlaceName(name: string, slugPrefix = "") {
  const slug = name
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const body = slug || "place";
  return slugPrefix ? `${slugPrefix}-${body}` : body;
}

export function slugifyPlaceNameForAddress(name: string, address: string) {
  return slugifyPlaceName(name, slugPrefixForRegion(regionFromAddress(address)));
}

export function nextUniqueSlug(base: string, existing: ReadonlySet<string>) {
  if (!existing.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
}

export function prefixedSlugRedirect(name: string, slugPrefix: string) {
  const current = slugifyPlaceName(name, slugPrefix);
  const unprefixed = slugifyPlaceName(name);
  return {
    current,
    unprefixed,
    needsRedirect: Boolean(slugPrefix) && current !== unprefixed,
    loops: current === unprefixed,
  };
}
