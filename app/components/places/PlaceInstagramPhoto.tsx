import type { PublicInstagramPhoto } from "../../features/poi-media/instagram-photos";

export function PlaceInstagramPhoto({ photo, placeName }: {
  photo: PublicInstagramPhoto;
  placeName: string;
}) {
  const mediaLabel = photo.postUrl.startsWith("https://www.instagram.com/reel/") ? "영상" : "사진";
  return <figure className="m-0 mx-auto min-w-0 w-full max-w-md">
    <iframe src={photo.embedUrl} title={`${placeName} Instagram ${mediaLabel} 게시물`}
      loading="lazy" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"
      className="block h-[min(660px,180vw)] min-h-[480px] w-full rounded-md border border-neutral-300 bg-white" />
    <figcaption className="text-xs">
      <span>Instagram · </span>
      <a href={photo.postUrl} target="_blank" rel="noopener" referrerPolicy="strict-origin" className="inline-flex min-h-11 items-center underline! underline-offset-4">
        출처
      </a>
    </figcaption>
  </figure>;
}
