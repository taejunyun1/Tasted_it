import type { PlaceDetail } from "../../features/places/place.types";
import "../../styles/place-information.css";

const weekdays = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

export function PlaceInformation({ place }: { place: PlaceDetail }) {
  const hours = place.operatingHours ?? [];
  return <>
    <dl className="place-information">
      <div><dt>주소</dt><dd>{place.address}</dd></div>
      <div><dt>전화</dt><dd>{place.phone?.trim() || "정보 미제공"}</dd></div>
      <div><dt>주차</dt><dd>{place.parkingSummary?.trim() || "정보 미확인"}</dd></div>
      <div><dt>장소 정보 확인일</dt><dd>{place.informationVerifiedOn ? <time dateTime={place.informationVerifiedOn}>{place.informationVerifiedOn}</time> : "확인 기록 없음"}</dd></div>
      <div><dt>영업시간</dt><dd>{hours.length ? <ul>{hours.map((day) => <li key={day.weekday}>
        <span>{weekdays[day.weekday]} {day.summary}</span>
        {day.verifiedOn && <> · <time dateTime={day.verifiedOn}>{day.verifiedOn}</time> 확인</>}
      </li>)}</ul> : "정보 미확인"}</dd></div>
    </dl>
    <p className="place-information-note">{hours.length > 0 && "표시되지 않은 요일의 영업시간은 미확인입니다. "}확인일 이후 정보가 달라질 수 있어요. 현재 영업 여부는 방문 전에 매장에 확인해 주세요.</p>
  </>;
}
