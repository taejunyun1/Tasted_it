import type { RecommendationChip } from "../../features/places/place-recommendation-options";

export function PlaceRecommendationControls({
  chips,
  selected,
  limitReached,
  pending,
  onToggle,
}: {
  chips: RecommendationChip[];
  selected: string[];
  limitReached: boolean;
  pending: boolean;
  onToggle: (id: string) => void;
}) {
  return <section className="discovery-controls" aria-labelledby="discovery-question">
    <div className="discovery-controls__heading">
      <p className="eyebrow">TASTE / DISCOVERY</p>
      <h2 id="discovery-question">오늘 뭐 먹지?</h2>
      <p>최대 두 가지 기분을 고르면 익숙한 맛과 새로운 발견을 함께 섞어드려요.</p>
    </div>
    <div className="discovery-chip-list" aria-label="추천 방향 선택">
      {chips.map((chip) => <button
        key={chip.id}
        type="button"
        data-kind={chip.kind}
        aria-pressed={selected.includes(chip.id)}
        disabled={pending}
        onClick={() => onToggle(chip.id)}
      >{chip.label}</button>)}
    </div>
    <p className="discovery-selection-status" aria-live="polite">
      {limitReached ? "최대 2개까지 선택할 수 있어요" : pending ? "추천을 다시 고르는 중…" : `${selected.length}/2 선택`}
    </p>
  </section>;
}
