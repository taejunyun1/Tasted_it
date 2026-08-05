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
  primaryCategory: { slug: string; name: string; emoji: string };
  positive: number;
  negative: number;
}

export interface PlaceDetail extends PlaceSummary {
  phone: string | null;
  parkingSummary: string | null;
  kakaoPlaceId: string | null;
}

export interface PlaceFilters {
  categorySlug?: string;
  query?: string;
  bbox?: [west: number, south: number, east: number, north: number];
  limit?: number;
}

export interface AdminPlaceSummary {
  id: string;
  slug: string;
  name: string;
  status: PlaceStatus;
  categoryName: string;
  updatedAt: string;
}
