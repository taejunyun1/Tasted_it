import type { DiscoveryPlace } from "../../features/places/place-discovery";
import { PlaceCard } from "./PlaceCard";

export function PlaceDiscoveryRail({
  title,
  description,
  places,
  kind,
  onOpenDetail,
}: {
  title: string;
  description: string;
  places: DiscoveryPlace[];
  kind: "personal" | "trusted" | "golden";
  onOpenDetail?: (slug: string) => void;
}) {
  return <section className="discovery-section" data-kind={kind} aria-labelledby={`discovery-${kind}`}>
    <header className="discovery-heading">
      <div>
        <p className="eyebrow">{kind === "personal" ? "TASTE / EXPLORE" : kind === "trusted" ? "RE:TASTE / TRUST" : "GOLDEN / RELAY"}</p>
        <h2 id={`discovery-${kind}`}>{title}</h2>
      </div>
      <p>{description}</p>
    </header>
    {places.length ? <div className="discovery-rail">
      {places.map((place, index) => <PlaceCard
        key={place.id}
        place={place}
        variant={kind === "personal" && index === 0 ? "featured" : kind}
        relayIndex={kind === "golden" ? index + 1 : undefined}
        distanceMeters={kind === "personal" ? place.distanceMeters : undefined}
        goldenPickAt={kind === "golden" ? place.goldenPickAt : undefined}
        recommendationLabel={kind === "trusted" ? "평가 신뢰도 추천" : kind === "golden" ? "리뷰어의 최근 선택" : undefined}
        onOpenDetail={onOpenDetail}
      />)}
    </div> : <p className="discovery-empty">{kind === "trusted" ? "평가가 충분히 쌓인 추천 장소를 준비하고 있어요." : kind === "golden" ? "아직 활성 Golden Pick이 없습니다." : "이 지도 범위에서 추천할 장소를 찾지 못했어요."}</p>}
  </section>;
}
