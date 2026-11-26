import { useEffect, useState } from "react";
import { allowsPlaceVisualFrames, type PlacePhotoOriginalSource } from "../../features/poi-media/photo-original-sources";

export function PlacePhotoOriginalLink({ source }: { source: PlacePhotoOriginalSource }) {
  const [showEmbed, setShowEmbed] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const { embed } = source;
  const youtube = embed?.provider === "youtube";
  const platformName = youtube ? "YouTube" : "Threads";
  const mediaLabel = source.mediaKind === "video" ? "영상" : "사진";

  useEffect(() => {
    if (!embed) return;
    // Client-side navigation keeps the initial document's frame policy.
    const initialUrl = window.performance.getEntriesByType("navigation")[0]?.name;
    if (initialUrl) setNeedsReload(!allowsPlaceVisualFrames(new URL(initialUrl, window.location.href).pathname));
  }, [embed]);

  function toggleEmbed() {
    if (needsReload) window.location.reload();
    else setShowEmbed((open) => !open);
  }

  return <>
    {embed && <>
      <button type="button" aria-expanded={needsReload ? undefined : showEmbed} onClick={toggleEmbed}
        className="my-2 min-h-11 rounded-md border border-neutral-400 bg-white px-3 text-sm font-medium">
        {needsReload ? `${mediaLabel}을 보려면 장소 상세 다시 열기` :
          showEmbed ? `${platformName} ${mediaLabel} 닫기` : `${platformName}에 연결해 ${mediaLabel} 보기`}
      </button>
      {showEmbed && <iframe src={embed.url} title={`${source.publisher} 장소 ${mediaLabel}`}
        sandbox={youtube ? "allow-scripts allow-same-origin" : "allow-scripts"}
        referrerPolicy={youtube ? "strict-origin-when-cross-origin" : "no-referrer"}
        allow={youtube ? "encrypted-media; fullscreen; picture-in-picture" : undefined}
        className={`block w-full min-w-0 rounded-md border border-neutral-300 bg-white ${youtube ? "aspect-video min-h-[200px]" : "h-[560px]"}`} />}
    </>}
    <p className="text-xs [overflow-wrap:anywhere]">
      외부 장소 {mediaLabel} · {source.publisher}
      {source.disclosure && ` · ${source.disclosure}`}{" "}
      <a href={source.url} target="_blank" rel="noopener" referrerPolicy="strict-origin"
        className="inline-flex min-h-11 items-center underline! underline-offset-4">출처</a>
    </p>
  </>;
}
