import { Form } from "react-router";

type MergePlace = { id: string; name: string; address: string; status: "DRAFT" | "PUBLISHED" | "HIDDEN" };
type SafeGroup = { id: string; label: string; count: number; targetPlaceId: string; sourcePlaceIds: string[] };
type RevisionRow = {
  id: string;
  placeId: string;
  placeName: string;
  action: string;
  reason: string;
  createdAt: string;
  restorable: boolean;
};

export function PlaceMergePanel({
  places,
  safeSameNameMergeGroups,
  revisions,
}: {
  places: MergePlace[];
  safeSameNameMergeGroups: SafeGroup[];
  revisions: RevisionRow[];
}) {
  const absorbedCount = safeSameNameMergeGroups.reduce((total, group) => total + group.sourcePlaceIds.length, 0);
  return <>
    <section className="place-ops-section same-name-merge">
      <div className="ops-section-head">
        <p className="eyebrow">SAFE DUPLICATE CANDIDATES</p>
        <h2>동일 상호 중복 병합</h2>
        <p>프랜차이즈는 제외합니다. 같은 상호이면서 주소가 같거나 좌표가 100m 이내인 후보만 보여 줍니다. 자동 병합은 하지 않으며, 아래 폼에서 남길 장소와 흡수할 장소를 직접 고릅니다.</p>
      </div>
      {safeSameNameMergeGroups.length ? <>
        <div className="same-name-merge-summary">
          <strong>{safeSameNameMergeGroups.length}개 묶음</strong>
          <span>보존 후보 {safeSameNameMergeGroups.length}곳 · 흡수 후보 {absorbedCount}곳 · 자동 병합 없음</span>
        </div>
        <ul className="same-name-merge-list">
          {safeSameNameMergeGroups.slice(0, 12).map((group) => (
            <li key={group.id}><strong>{group.label}</strong><span>동일 위치 {group.count}곳 · 직접 병합</span></li>
          ))}
        </ul>
        {safeSameNameMergeGroups.length > 12 && <p className="same-name-merge-more">외 {safeSameNameMergeGroups.length - 12}개 묶음도 같은 기준입니다.</p>}
      </> : <p className="same-name-merge-empty">지금은 수동 병합 후보가 되는 비프랜차이즈 중복 장소가 없습니다.</p>}
    </section>
    <section className="place-ops-section">
      <h2>중복 장소 병합</h2>
      <Form method="post" className="ops-form merge-form">
        <input type="hidden" name="intent" value="merge" />
        <label>남길 장소
          <select name="targetPlaceId" required>
            {places.map((place) => <option key={place.id} value={place.id}>{place.name} · {place.address} · {place.status} · {place.id}</option>)}
          </select>
        </label>
        <label>흡수할 장소
          <select name="sourcePlaceId" required>
            {places.map((place) => <option key={`source-${place.id}`} value={place.id}>{place.name} · {place.address} · {place.status} · {place.id}</option>)}
          </select>
        </label>
        <label>병합 근거<input name="reason" placeholder="같은 장소임을 확인한 근거" required maxLength={300} /></label>
        <button>병합 미리보기</button>
      </Form>
      <p className="ops-form-help">이름이 같아도 주소와 장소 ID를 구분해 선택하세요. 미리보기에서 남길 장소와 흡수할 장소, 영향 범위를 확인한 뒤 확정합니다.</p>
    </section>
    <section className="place-ops-section">
      <h2>최근 변경 이력</h2>
      <p className="ops-form-help">과거 변경 값으로 되돌리는 기능은 지원하지 않습니다. 공개 회수의 복원은 해당 작업의 확정 영수증에서 확인할 수 있습니다.</p>
      {revisions.length ? revisions.map((item) => (
        <article className="ops-revision" key={item.id}>
          <div>
            <strong>{item.action}</strong>
            <span>{item.placeName}</span>
            <small>{item.reason} · {item.createdAt}</small>
          </div>
        </article>
      )) : <p>변경 이력이 없습니다.</p>}
    </section>
  </>;
}
