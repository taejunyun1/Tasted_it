import { useState } from "react";
import type { PlacePhotoOriginalSource } from "../../features/poi-media/photo-original-sources";

export function PlacePhotoOriginalLink({ source }: { source: PlacePhotoOriginalSource }) {
  const [showEmbed, setShowEmbed] = useState(false);

  return <>
    {source.embedUrl && <>
      <button type="button" aria-expanded={showEmbed} onClick={() => setShowEmbed(!showEmbed)}
        className="my-2 min-h-11 rounded-md border border-neutral-400 bg-white px-3 text-sm font-medium">
        {showEmbed ? "Threads 사진 닫기" : "Threads에 연결해 사진 보기"}
      </button>
      {showEmbed && <iframe src={source.embedUrl} title={`${source.publisher} 장소 사진`}
        sandbox="allow-scripts" referrerPolicy="no-referrer"
        className="block h-[560px] w-full min-w-0 rounded-md border border-neutral-300 bg-white" />}
    </>}
    <p className="text-xs [overflow-wrap:anywhere]">
      외부 장소 사진 · {source.publisher}{" "}
      <a href={source.url} target="_blank" rel="noopener" referrerPolicy="strict-origin"
        className="inline-flex min-h-11 items-center underline! underline-offset-4">출처</a>
    </p>
  </>;
}
