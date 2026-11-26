import type { PublicPoiPhoto } from "../../features/poi-media/poi-media";

export function PlacePoiPhoto({ photo, placeName, heroClassName }: {
  photo: PublicPoiPhoto;
  placeName: string;
  heroClassName: string;
}) {
  return <figure className="m-0 min-w-0">
    <div className={heroClassName} data-has-photo="true">
      <img className="object-contain!" src={photo.url} alt={`${placeName} 장소 사진`} />
    </div>
    <figcaption className="px-4 py-1 text-sm text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
      <span>장소 사진 제공 · {photo.attribution}</span>
      {" "}
      <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer"
        className="inline-flex min-h-11 max-w-full items-center underline! underline-offset-4">
        원본 사진 보기
      </a>
    </figcaption>
  </figure>;
}
