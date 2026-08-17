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
