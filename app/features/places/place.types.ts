export type PlaceStatus = "DRAFT" | "PUBLISHED" | "HIDDEN";

export interface PlaceImportRow {
  name: string;
  slug: string;
  address: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  primaryCategory: string;
  phone: string | null;
  parkingSummary: string | null;
  kakaoPlaceId: string | null;
  heroImageUrl: string | null;
  status: PlaceStatus;
  searchText: string;
}

export interface PlaceImportError {
  row: number;
  field: string;
  message: string;
}

export interface PlaceImportResult {
  rows: PlaceImportRow[];
  errors: PlaceImportError[];
}

export interface PlaceSummary {
  id: string;
  slug: string;
  name: string;
  address: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  heroImageUrl: string | null;
  searchText?: string;
  primaryCategory: { slug: string; name: string; emoji: string };
  positive: number;
  negative: number;
  userPositive?: number;
  userNegative?: number;
  reviewerPositive?: number;
  reviewerNegative?: number;
  ratingScore?: number | null;
  ratingSampleCount?: number;
  userRatingScore?: number | null;
  userRatingSampleCount?: number;
  reviewerRatingScore?: number | null;
  reviewerRatingSampleCount?: number;
  ratingIsStale?: boolean;
  ratingComputedAt?: string | null;
  tempCatalog?: import("../temp-catalog/temp-catalog").TempPublicInfo;
}

export interface PlaceDetail extends PlaceSummary {
  phone: string | null;
  parkingSummary: string | null;
  kakaoPlaceId: string | null;
  informationVerifiedOn?: string | null;
  operatingHours?: import("./public-information").PublicOperatingDay[];
}

export interface PlaceFilters {
  tempOnly?: boolean;
  categorySlug?: string;
  query?: string;
  bbox?: [west: number, south: number, east: number, north: number];
  limit?: number;
}

export interface PublicPlaceCounts {
  count: number;
  overallCount: number;
  overallBounds: [number, number, number, number] | null;
}

export interface AdminPlaceSummary {
  id: string;
  slug: string;
  name: string;
  status: PlaceStatus;
  categoryName: string;
  updatedAt: string;
}
