import { useId } from "react";
import { Link } from "react-router";

export function PlaceRatingBadges({ goldenPick, hiddenGem }: { goldenPick: boolean; hiddenGem: boolean }) {
  return <>
    {goldenPick && <span className="rating-badge">GOLDEN PICK · 90일</span>}
    {hiddenGem && <span className="rating-badge rating-badge-hidden">HIDDEN GEM · 노출 대비 높은 평가</span>}
  </>;
}

export function PlaceCorrectionLink({ placeId }: { placeId: string }) {
  return <p><Link to={`/corrections/new?${new URLSearchParams({ placeId })}`}>이 장소 정보 정정 요청</Link></p>;
}

export function PlaceReviewPhotos({ placeName, photos }: { placeName: string; photos: readonly { id: string; url: string }[] }) {
  const title = useId();
  if (!photos.length) return null;
  return <section className="review-photo-gallery" aria-labelledby={title}>
    <div><p className="eyebrow">REVIEWER / PHOTO</p><h2 id={title}>리뷰어가 남긴 사진</h2></div>
    <div>{photos.map((photo) => <img key={photo.id} src={photo.url} alt={`${placeName} 리뷰 사진`} loading="lazy" />)}</div>
  </section>;
}
