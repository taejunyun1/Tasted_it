import type { DiscoveryPlace } from "../../features/places/place-discovery";
import { PlaceCard } from "./PlaceCard";

export function PlaceDiscoveryRail({
  title,
  description,
  places,
  kind,
}: {
  title: string;
  description: string;
  places: DiscoveryPlace[];
  kind: "nearby" | "service" | "golden";
}) {
  return <section className="discovery-section" aria-labelledby={`discovery-${kind}`}>
    <header className="discovery-heading">
      <div>
        <p className="eyebrow">{kind === "nearby" ? "NEAR YOU" : kind === "service" ? "RE:TASTE CURATION" : "REVIEWER'S PICK"}</p>
        <h2 id={`discovery-${kind}`}>{title}</h2>
      </div>
      <p>{description}</p>
    </header>
    {places.length ? <div className="discovery-rail">
      {places.map((place) => <PlaceCard
        key={place.id}
        place={place}
        distanceMeters={kind === "nearby" ? place.distanceMeters : undefined}
        goldenPickAt={kind === "golden" ? place.goldenPickAt : undefined}
        recommendationLabel={kind === "service" ? "평가 신뢰도 추천" : kind === "golden" ? "리뷰어의 최근 선택" : "현재 지도 중심에서 가까움"}
      />)}
    </div> : <p className="discovery-empty">{kind === "service" ? "평가 8표를 채운 추천 장소를 준비하고 있어요." : kind === "golden" ? "아직 활성 Golden Pick이 없습니다." : "이 지도 범위에서 추천할 장소를 찾지 못했어요."}</p>}
  </section>;
}
