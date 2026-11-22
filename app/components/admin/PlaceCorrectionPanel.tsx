import { Form, Link, useNavigation } from "react-router";
import { correctionOperationsHref } from "../../features/places/place-operations-io";

type CorrectionItem = {
  id: string;
  placeId: string | null;
  placeName: string | null;
  status: string;
  requestType: string;
  requesterRelation: string;
  changes: Array<{ label: string; value: string }>;
  evidenceNote: string | null;
  adminResponse: string | null;
  updatedAt: string;
  canApply: boolean;
  canRecall: boolean;
};

const statusLabels: Record<string, string> = { SUBMITTED: "접수 완료", REVIEWING: "검토 중", APPLIED: "적용 완료", REJECTED: "반려" };
const typeLabels: Record<string, string> = { INFORMATION: "정보 정정", MOVED: "이전", TEMPORARILY_CLOSED: "임시휴업", CLOSED: "폐업", RIGHTS: "권리 침해", OTHER: "기타" };

export function PlaceCorrectionPanel({ rows, pagination }: {
  rows: CorrectionItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}) {
  const navigation = useNavigation();
  const pending = navigation.state !== "idle" && ["apply-correction", "prepare-correction-recall", "transition-correction"].includes(String(navigation.formData?.get("intent")));
  const pageHref = correctionOperationsHref(pagination.page);
  return <section className="place-ops-section" aria-labelledby="correction-heading" aria-busy={pending}>
    <h2 id="correction-heading">정보 정정·이의 제기</h2>
    {pending && <p role="status">정정 요청을 처리하고 있습니다.</p>}
    <nav className="place-review-pagination" aria-label="정정 요청 페이지">
      <p><strong>총 {pagination.total}건</strong> · {pagination.page}/{pagination.totalPages} 페이지</p>
      <div>
        {pagination.page > 1 && <Link to={correctionOperationsHref(pagination.page - 1)}>이전 페이지</Link>}
        {pagination.page < pagination.totalPages && <Link to={correctionOperationsHref(pagination.page + 1)}>다음 페이지</Link>}
      </div>
    </nav>
    {rows.length ? rows.map((item) => (
      <article className="ops-card" key={item.id}>
        <div>
          <span>{Object.hasOwn(statusLabels, item.status) ? statusLabels[item.status] : "상태 확인 필요"} · {Object.hasOwn(typeLabels, item.requestType) ? typeLabels[item.requestType] : "유형 확인 필요"}</span>
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
          {item.adminResponse && <p>관리자 검토 메모: {item.adminResponse}</p>}
        </div>
        <div className="ops-actions">
          {item.canRecall && <Form method="post" action={pageHref} className="ops-form">
            <input type="hidden" name="intent" value="prepare-correction-recall" />
            <input type="hidden" name="requestId" value={item.id} />
            <input type="hidden" name="expectedUpdatedAt" value={item.updatedAt} />
            <label>회수 사유<input name="reason" required maxLength={300} /></label>
            <button disabled={pending}>회수 미리보기</button>
            <p className="ops-form-help">여기서는 폐업에 따른 공개 회수를 처리합니다. 함께 제출된 장소 정보는 별도 정정 요청으로 검토해 주세요.</p>
          </Form>}
          {item.requestType === "CLOSED" && !item.canRecall && <p className="ops-form-help">현재 이 장소의 공개 회수를 준비할 수 없습니다. 검토 메모를 남기거나 요청을 반려할 수 있습니다.</p>}
          {item.canApply && <Form method="post" action={pageHref} className="ops-form">
            <input type="hidden" name="intent" value="apply-correction" />
            <input type="hidden" name="requestId" value={item.id} />
            <input type="hidden" name="expectedUpdatedAt" value={item.updatedAt} />
            <label>적용 근거<input name="reason" placeholder="적용 근거" required maxLength={300} /></label>
            <button disabled={pending}>정정 적용</button>
          </Form>}
          <Form method="post" action={pageHref} className="ops-form ops-form-compact">
            <input type="hidden" name="intent" value="transition-correction" />
            <input type="hidden" name="requestId" value={item.id} />
            <input type="hidden" name="expectedUpdatedAt" value={item.updatedAt} />
            <label>검토·반려 사유<input name="reason" placeholder="검토·반려 사유" required maxLength={300} /></label>
            <button className="secondary" name="status" value="REVIEWING" disabled={pending}>검토 메모 저장</button>
            <button className="secondary" name="status" value="REJECTED" disabled={pending}>반려</button>
            <p className="ops-form-help">검토 메모는 관리자 내부 기록입니다.</p>
          </Form>
        </div>
      </article>
    )) : <p>검토할 정정 요청이 없습니다.</p>}
  </section>;
}
