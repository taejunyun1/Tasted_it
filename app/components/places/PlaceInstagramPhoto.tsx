import type { PublicInstagramPhoto } from "../../features/poi-media/instagram-photos";

export function PlaceInstagramPhoto({ photo, placeName }: {
  photo: PublicInstagramPhoto;
  placeName: string;
}) {
  return <figure className="m-0 mx-auto min-w-0 w-full max-w-md">
    <iframe src={photo.embedUrl} title={`${placeName} Instagram 사진 게시물`}
      loading="lazy" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"
      className="block h-[min(660px,180vw)] min-h-[480px] w-full rounded-md border border-neutral-300 bg-white" />
    <figcaption>
      <a href={photo.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-xs underline! underline-offset-4">
        사진 출처 · Instagram 원문
      </a>
    </figcaption>
  </figure>;
}
