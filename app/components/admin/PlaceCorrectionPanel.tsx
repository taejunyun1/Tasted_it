import { Form } from "react-router";

type CorrectionItem = {
  id: string;
  placeId: string | null;
  placeName: string | null;
  status: string;
  requestType: string;
  requesterRelation: string;
  changes: Array<{ label: string; value: string }>;
  evidenceNote: string | null;
};

export function PlaceCorrectionPanel({ corrections }: { corrections: CorrectionItem[] }) {
  return <section className="place-ops-section" aria-labelledby="correction-heading">
    <h2 id="correction-heading">정보 정정·이의 제기</h2>
    {corrections.length ? corrections.map((item) => (
      <article className="ops-card" key={item.id}>
        <div>
          <span>{item.status} · {item.requestType}</span>
          <h3>{item.placeName ?? (item.placeId ? "이름 없는 장소" : "목록에 없는 장소")}</h3>
          <p>{item.requesterRelation}</p>
          {item.changes.length ? (
            <dl className="liveness-evidence">
              {item.changes.map((change) => (
                <div key={change.label}><dt>{change.label}</dt><dd>{change.value}</dd></div>
              ))}
            </dl>
          ) : <p className="ops-form-help">표시할 정정 항목이 없습니다.</p>}
          {item.evidenceNote && <small>{item.evidenceNote}</small>}
        </div>
        <div className="ops-actions">
          <Form method="post" className="ops-form">
            <input type="hidden" name="intent" value="apply-correction" />
            <input type="hidden" name="requestId" value={item.id} />
            <input name="reason" placeholder="적용 근거" required maxLength={300} />
            <button>정정 적용</button>
          </Form>
          <Form method="post" className="ops-form ops-form-compact">
            <input type="hidden" name="intent" value="transition-correction" />
            <input type="hidden" name="requestId" value={item.id} />
            <input name="reason" placeholder="반려 사유" required maxLength={300} />
            <button className="secondary" name="status" value="REJECTED">반려</button>
          </Form>
        </div>
      </article>
    )) : <p>검토할 정정 요청이 없습니다.</p>}
  </section>;
}
