export type ReviewStepNumber = 1 | 2 | 3 | 4 | 5;

export type PlaceReviewQuery = {
  step: ReviewStepNumber;
  page: number;
  pageSize: 25 | 50 | 100;
  status: "pending" | "attention" | "hold" | null;
  region: "GWANGJU" | "JEONNAM" | null;
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
    status: rawStatus === "pending" || rawStatus === "attention" || rawStatus === "hold" ? rawStatus : null,
    region: rawRegion === "GWANGJU" || rawRegion === "JEONNAM" ? rawRegion : null,
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
