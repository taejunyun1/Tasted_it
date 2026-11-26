import type { PlacePhotoOriginalSource } from "../../features/poi-media/photo-original-sources";

export function PlacePhotoOriginalLink({ source }: { source: PlacePhotoOriginalSource }) {
  return <p className="text-xs [overflow-wrap:anywhere]">
    외부 장소 사진 · {source.publisher}{" "}
    <a href={source.url} target="_blank" rel="noopener" referrerPolicy="strict-origin"
      className="inline-flex min-h-11 items-center underline! underline-offset-4">출처</a>
  </p>;
}
