import type { PublicDataSource } from "./public-data";

export type PlaceTrait =
  | "soloFriendly"
  | "groupFriendly"
  | "lateNight"
  | "family"
  | "date"
  | "quickMeal"
  | "alcoholFriendly"
  | "dessert"
  | "parkingFriendly";

export type CategoryV5State = "GREEN" | "YELLOW" | "ORANGE" | "RED";
export type CategoryV5Decision = "AUTO" | "MANUAL" | "EXCLUDE";
export type CategoryEvidenceLevel = 1 | 2 | 3 | 4 | 5;

export interface CategoryEvidenceV5 {
  code: string;
  slug: string;
  level: CategoryEvidenceLevel;
  origin: "NAME" | "SUBTYPE" | "SOURCE";
  score: number;
}

export interface PlaceCategoryProfileV5 {
  algorithmVersion: "place-category-v5";
  primarySlug: string;
  secondarySlugs: string[];
  traits: PlaceTrait[];
  foodPlaceScore: number;
  state: CategoryV5State;
  decision: CategoryV5Decision;
  evidence: CategoryEvidenceV5[];
  reasonCodes: string[];
}

export interface PlaceCategoryV5Input {
  sourceType: PublicDataSource;
  businessName: string;
  businessSubtype?: string | null;
  exclusionStatus?: "OVERRIDDEN" | null;
}
