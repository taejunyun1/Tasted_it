import { useRef } from "react";

import {
  HomeCurationCards,
  HomeCurationModeControls,
  type HomeCurationPresentationProps,
} from "./HomeCurationCards";

export type HomeSheetSnap = "peek" | "half" | "full";

export type HomeCurationSheetProps = HomeCurationPresentationProps & {
  snap: HomeSheetSnap;
  onSnapChange: (snap: HomeSheetSnap) => void;
};

const SNAP_ORDER: HomeSheetSnap[] = ["peek", "half", "full"];

export function homeSheetSnapAfterDrag(snap: HomeSheetSnap, deltaY: number): HomeSheetSnap {
  if (Math.abs(deltaY) < 36) return snap;
  const direction = deltaY < 0 ? 1 : -1;
  const index = Math.max(0, Math.min(SNAP_ORDER.length - 1, SNAP_ORDER.indexOf(snap) + direction));
  return SNAP_ORDER[index]!;
}

export function homeSheetSnapAfterPlaceSelect(): HomeSheetSnap {
  return "peek";
}

export function HomeCurationSheet({ snap, onSnapChange, ...props }: HomeCurationSheetProps) {
  const pointerStartY = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const handlePlaceSelect = (placeId: string) => {
    onSnapChange(homeSheetSnapAfterPlaceSelect());
    props.onSelect(placeId);
  };

  return <aside className="home-curation-sheet" data-snap={snap} aria-label="홈 맛집 추천">
    <button
      type="button"
      className="home-curation-sheet__handle"
      aria-label={snap === "full" ? "추천 목록 접기" : "추천 목록 펼치기"}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onSnapChange(snap === "full" ? "half" : "full");
      }}
      onPointerDown={(event) => {
        suppressClick.current = false;
        pointerStartY.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        const start = pointerStartY.current;
        pointerStartY.current = null;
        if (start !== null) {
          const deltaY = event.clientY - start;
          suppressClick.current = Math.abs(deltaY) >= 36;
          onSnapChange(homeSheetSnapAfterDrag(snap, deltaY));
        }
      }}
      onPointerCancel={() => {
        pointerStartY.current = null;
        suppressClick.current = false;
      }}
    ><span aria-hidden="true" /></button>
    <div className="home-curation-sheet__summary">
      <div><p className="eyebrow">NEARBY / CURATED</p><h1>지금 갈 만한 5곳</h1></div>
      <button type="button" className="home-curation-locate" onClick={props.onLocate}>내 위치</button>
    </div>
    <div className="home-curation-sheet__body">
      {props.page.notice && <p className="home-curation-intro" role="status">{props.page.notice}</p>}
      <HomeCurationModeControls {...props} />
      {props.error && <p className="home-curation-error" role="status">{props.error} <button type="button" onClick={props.onRetry}>다시 시도</button></p>}
      <HomeCurationCards {...props} onSelect={handlePlaceSelect} />
      <footer className="home-curation-footer">
        <span>{props.page.radiusMeters / 1_000}km 안에서 추천</span>
      </footer>
    </div>
  </aside>;
}
