import { isRegionCode, type RegionCode } from "../regions/region-pack";

export type ReviewStepNumber = 1 | 2 | 3 | 4 | 5;

export type PlaceReviewQuery = {
  step: ReviewStepNumber;
  page: number;
  pageSize: 25 | 50 | 100;
  status: "pending" | "attention" | "hold" | null;
  region: RegionCode | null;
  query: string;
};

const reviewSteps = new Set<ReviewStepNumber>([1, 2, 3, 4, 5]);
const pageSizes = new Set<PlaceReviewQuery["pageSize"]>([25, 50, 100]);

export function parsePlaceReviewQuery(url: URL): PlaceReviewQuery {
  const requestedStep = Number(url.searchParams.get("step"));
  const requestedSize = Number(url.searchParams.get("pageSize"));
  const rawStatus = url.searchParams.get("status");
  const rawRegion = url.searchParams.get("region");

  return {
    step: reviewSteps.has(requestedStep as ReviewStepNumber) ? requestedStep as ReviewStepNumber : 1,
    page: Math.max(1, Number(url.searchParams.get("page")) || 1),
    pageSize: pageSizes.has(requestedSize as PlaceReviewQuery["pageSize"])
      ? requestedSize as PlaceReviewQuery["pageSize"]
      : 25,
    status: rawStatus === "attention" || rawStatus === "hold" ? rawStatus : "pending",
    region: isRegionCode(rawRegion) ? rawRegion : null,
    query: (url.searchParams.get("q") ?? "").trim().slice(0, 80),
  };
}

export function buildPlaceReviewPageHref(query: PlaceReviewQuery, page: number) {
  const params = new URLSearchParams({
    flow: "review",
    step: String(query.step),
    page: String(Math.max(1, page)),
    pageSize: String(query.pageSize),
  });

  if (query.status) params.set("status", query.status);
  if (query.region) params.set("region", query.region);
  if (query.query) params.set("q", query.query);

  return `?${params.toString()}`;
}

export function buildPlaceReviewNextStepHref(query: PlaceReviewQuery) {
  const nextStep = Math.min(5, query.step + 1) as ReviewStepNumber;
  return buildPlaceReviewPageHref({ ...query, step: nextStep, page: 1 }, 1);
}
