import {
  HomeCurationCards,
  HomeCurationModeControls,
  type HomeCurationPresentationProps,
} from "./HomeCurationCards";

export function HomeCurationPanel(props: HomeCurationPresentationProps) {
  return <aside className="home-curation-panel" aria-label="홈 맛집 추천">
    <header className="home-curation-header">
      <div>
        <p className="eyebrow">NEARBY / CURATED</p>
        <h1>지금 갈 만한 5곳</h1>
      </div>
      <button type="button" className="home-curation-locate" onClick={props.onLocate}>내 위치</button>
    </header>
    <p className="home-curation-intro">모든 장소 대신, 거리·취향·시간대·평가를 함께 본 다섯 곳만 보여드려요.</p>
    <HomeCurationModeControls {...props} />
    {props.error && <p className="home-curation-error" role="status">{props.error} <button type="button" onClick={props.onRetry}>다시 시도</button></p>}
    <HomeCurationCards {...props} />
    <footer className="home-curation-footer">
      <span>{props.page.radiusMeters / 1_000}km 안에서 추천</span>
    </footer>
  </aside>;
}
