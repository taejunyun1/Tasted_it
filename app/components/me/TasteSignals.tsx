import { Link } from "react-router";

import { selectTasteSignals, type TasteGraph } from "../../features/members/taste-signals";

export function TasteSignals({ graph }: { graph: TasteGraph }) {
  const summary = selectTasteSignals(graph);

  return <section className="member-signals" aria-labelledby="taste-signals-title">
    <header className="member-section-heading">
      <div>
        <p className="eyebrow">MY TASTE SIGNALS</p>
        <h2 id="taste-signals-title">나의 취향 신호</h2>
      </div>
      <span>{graph.placeCount}곳 반영</span>
    </header>

    {summary.status === "VISIBLE" ? <>
      <ul className="member-signal-list" aria-label="대표 취향">
        {summary.signals.map((signal, index) => <li data-primary={index === 0 || undefined} key={signal.key}>{signal.label}</li>)}
      </ul>
      <div className="member-taste-meters">
        {graph.dimensions.map((dimension) => <div key={dimension.key}>
          <span>{dimension.key}</span>
          <meter aria-label={`${dimension.key} 취향 값`} min="1" max="5" value={dimension.value}>{dimension.value.toFixed(1)}</meter>
          <strong>{dimension.value.toFixed(1)}</strong>
        </div>)}
      </div>
    </> : <div className="member-learning">
      <span className="member-learning-badge">취향 학습 중 {summary.placeCount}/{summary.requiredPlaceCount}</span>
      <progress aria-label="취향 학습 진행도" max={summary.requiredPlaceCount} value={summary.placeCount}>{summary.placeCount}/{summary.requiredPlaceCount}</progress>
      <p>장소를 평가할수록 코스 추천이 더 선명해져요.</p>
      <Link to="/places">맛집 둘러보기</Link>
    </div>}
  </section>;
}
