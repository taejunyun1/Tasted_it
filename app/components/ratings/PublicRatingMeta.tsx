import { publicRatingFromPlace, ratingCalculationLabel, type PublicRatingInput } from "../../features/ratings/public-rating";

export function PublicRatingMeta({ place }: { place: PublicRatingInput }) {
  const rating = publicRatingFromPlace(place);
  return <small className="public-rating-meta" data-rating-stale={rating.isStale}>
    <span>{rating.isStale ? "새 평가 반영 중" : "검증된 최신 결과"}</span>{" · "}
    <time dateTime={rating.computedAt ?? undefined}>{ratingCalculationLabel(place)}</time>
  </small>;
}
