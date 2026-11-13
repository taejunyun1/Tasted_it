import { and, or, sql, type SQLWrapper } from "drizzle-orm";
import { businessLicenseExclusions, businessLicenses, placeSourceLinks, places } from "../../db/schema";
import {
  CU_CONVENIENCE_PREFIX,
  NON_RESTAURANT_PUBLIC_NAME_TERMS,
  NON_RESTAURANT_PUBLIC_NAME_PREFIXES,
  NON_RESTAURANT_SOURCE_SUBTYPE_TERMS,
} from "./food-venue-policy";

export function normalizedPublicVenueText(column: SQLWrapper) {
  let normalized = sql<string>`coalesce(${column}, '')`;
  // Keep this expression shallow enough for D1's SQLite expression-depth limit.
  // These cover ordinary imported spacing plus the common NBSP/ideographic variants;
  // the ingestion policy still performs full Unicode NFKC + whitespace normalization.
  for (const codePoint of [9, 10, 13, 32, 160, 12288]) {
    normalized = sql<string>`replace(${normalized}, char(${sql.raw(String(codePoint))}), '')`;
  }
  return sql<string>`lower(${normalized})`;
}

export function hasAnyNormalizedVenueTerm(column: ReturnType<typeof normalizedPublicVenueText>, terms: readonly string[]) {
  // A json_each subquery stays shallow when the venue vocabulary grows. Chaining
  // one LIKE per term exceeds D1's SQLite expression-depth limit in list/detail
  // queries, especially after whitespace normalization.
  return sql<boolean>`exists (
    select 1 from json_each(${JSON.stringify(terms)})
    where instr(${column}, json_each.value) > 0
  )`;
}

export function hasAnyNormalizedVenuePrefix(column: ReturnType<typeof normalizedPublicVenueText>, prefixes: readonly string[]) {
  return sql<boolean>`exists (
    select 1 from json_each(${JSON.stringify(prefixes)})
    where ${column} like json_each.value || '%'
  )`;
}

export function hasCuConveniencePrefix(column: ReturnType<typeof normalizedPublicVenueText>) {
  // CU branch names are normally `CU + Korean branch name` or `CU + number`.
  // Do not turn a broad `cu%` match into a false positive for Curry-like names.
  return sql<boolean>`(
    ${column} = ${CU_CONVENIENCE_PREFIX}
    or (
      substr(${column}, 1, 2) = ${CU_CONVENIENCE_PREFIX}
      and (
        (substr(${column}, 3, 1) >= '가' and substr(${column}, 3, 1) <= '힣')
        or (substr(${column}, 3, 1) >= '0' and substr(${column}, 3, 1) <= '9')
      )
    )
  )`;
}

export function publicVenueVisibilityCondition() {
  const normalizedPlaceName = normalizedPublicVenueText(places.name);
  const normalizedSourceName = normalizedPublicVenueText(businessLicenses.businessName);
  const normalizedSourceSubtype = normalizedPublicVenueText(businessLicenses.businessSubtype);
  const placeMatchesNonRestaurantRule = or(
    hasAnyNormalizedVenueTerm(normalizedPlaceName, NON_RESTAURANT_PUBLIC_NAME_TERMS),
    hasAnyNormalizedVenuePrefix(normalizedPlaceName, NON_RESTAURANT_PUBLIC_NAME_PREFIXES),
    hasCuConveniencePrefix(normalizedPlaceName),
  )!;
  const nameDoesNotMatch = sql<boolean>`not (${placeMatchesNonRestaurantRule})`;
  const sourceMatch = or(
    hasAnyNormalizedVenueTerm(normalizedSourceName, NON_RESTAURANT_PUBLIC_NAME_TERMS),
    hasAnyNormalizedVenuePrefix(normalizedSourceName, NON_RESTAURANT_PUBLIC_NAME_PREFIXES),
    hasCuConveniencePrefix(normalizedSourceName),
    hasAnyNormalizedVenueTerm(normalizedSourceSubtype, NON_RESTAURANT_SOURCE_SUBTYPE_TERMS),
  )!;
  const hasAdminOverride = sql<boolean>`exists (
    select 1 from ${placeSourceLinks}
    inner join ${businessLicenseExclusions}
      on ${businessLicenseExclusions.businessLicenseId} = ${placeSourceLinks.businessLicenseId}
    where ${placeSourceLinks.placeId} = ${places.id}
      and ${businessLicenseExclusions.status} = 'OVERRIDDEN'
  )`;
  const hasNoUnapprovedSourceMatch = sql<boolean>`not exists (
    select 1 from ${placeSourceLinks}
    inner join ${businessLicenses}
      on ${businessLicenses.id} = ${placeSourceLinks.businessLicenseId}
    left join ${businessLicenseExclusions}
      on ${businessLicenseExclusions.businessLicenseId} = ${businessLicenses.id}
    where ${placeSourceLinks.placeId} = ${places.id}
      and (${businessLicenseExclusions.status} is null or ${businessLicenseExclusions.status} <> 'OVERRIDDEN')
      and (${sourceMatch})
  )`;
  return and(or(nameDoesNotMatch, hasAdminOverride), hasNoUnapprovedSourceMatch)!;
}
