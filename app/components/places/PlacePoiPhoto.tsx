import { useEffect, useRef, useState } from "react";
import type { PublicPoiPhoto } from "../../features/poi-media/poi-media";

type PlacePoiPhotoProps = {
  photo: PublicPoiPhoto;
  placeName: string;
  heroClassName: string;
};

export function PlacePoiPhoto(props: PlacePoiPhotoProps) {
  return <PlacePoiPhotoFigure key={props.photo.url} {...props} />;
}

function PlacePoiPhotoFigure({ photo, placeName, heroClassName }: PlacePoiPhotoProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const image = imageRef.current;
    // The server-rendered image can fail before React attaches the error handler.
    if (image?.complete && image.naturalWidth === 0) setUnavailable(true);
  }, []);

  if (unavailable) return <div className={heroClassName} data-has-photo="false">
    <span role="status" className="px-4 text-center text-sm">장소 사진을 불러오지 못했어요.</span>
  </div>;

  return <figure className="m-0 min-w-0">
    <div className={heroClassName} data-has-photo="true">
      <img ref={imageRef} onError={() => setUnavailable(true)}
        className="object-contain!" src={photo.url} alt={`${placeName} 장소 사진`} />
    </div>
    <figcaption className="px-4 py-1 text-xs text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
      <span>장소 사진 제공 · {photo.attribution}</span>
      {" "}
      <a href={photo.sourceUrl} target="_blank" rel="noopener" referrerPolicy="strict-origin"
        className="inline-flex min-h-11 max-w-full items-center underline! underline-offset-4">
        출처
      </a>
    </figcaption>
  </figure>;
}
