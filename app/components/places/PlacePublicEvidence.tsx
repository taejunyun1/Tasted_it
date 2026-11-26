import { useId } from "react";
import { Link } from "react-router";
import type { PublicPlaceReviewPhoto } from "../../features/ratings/reviewer-visit.server";

export function PlaceRatingBadges({ goldenPick, hiddenGem }: { goldenPick: boolean; hiddenGem: boolean }) {
  return <>
    {goldenPick && <span className="rating-badge">GOLDEN PICK · 90일</span>}
    {hiddenGem && <span className="rating-badge rating-badge-hidden">HIDDEN GEM · 노출 대비 높은 평가</span>}
  </>;
}

export function PlaceCorrectionLink({ placeId }: { placeId: string }) {
  return <p><Link to={`/corrections/new?${new URLSearchParams({ placeId })}`}>이 장소 정보 정정 요청</Link></p>;
}

export function PlacePublicReviewers({ reviewers, heading: Heading = "h2" }: {
  reviewers: readonly { slug: string; displayName: string }[];
  heading?: "h2" | "h3";
}) {
  const title = useId();
  if (!reviewers.length) return null;
  return <section className="place-public-reviewers mt-6" aria-labelledby={title}>
    <Heading id={title} className="font-semibold">승인된 방문을 남긴 리뷰어</Heading>
    <ul className="flex flex-wrap gap-x-4">
      {reviewers.map(({ slug, displayName }) => <li key={slug} className="min-w-0">
        <Link className="inline-flex min-h-11 items-center underline! underline-offset-4 [overflow-wrap:anywhere]" to={`/reviewers/${encodeURIComponent(slug)}`}>{displayName}</Link>
      </li>)}
    </ul>
  </section>;
}

export function PlaceReviewPhotos({ placeName, photos }: { placeName: string; photos: readonly PublicPlaceReviewPhoto[] }) {
  const title = useId();
  if (!photos.length) return null;
  return <section className="review-photo-gallery" aria-labelledby={title}>
    <div><p className="eyebrow">REVIEWER / PHOTO</p><h2 id={title}>리뷰어가 남긴 사진</h2></div>
    <div>{photos.map((photo) => <figure key={photo.id} className="min-w-0">
      <img src={photo.url} alt={`${placeName} 리뷰 사진`} loading="lazy" />
      <figcaption className="text-xs text-neutral-700 [overflow-wrap:anywhere]">
        <Link className="inline-flex min-h-11 max-w-full items-center underline! underline-offset-4" to={`/reviewers/${encodeURIComponent(photo.reviewerSlug)}`}>
          <span>사진 제공 · {photo.reviewerDisplayName}</span>
        </Link>
      </figcaption>
    </figure>)}</div>
  </section>;
}
