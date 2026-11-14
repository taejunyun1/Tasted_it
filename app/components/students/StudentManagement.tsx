import { useEffect, useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import type { studentAdminData } from "../../features/students/admin.server";
import type { StudentAdminView } from "../../features/students/admin-commands.server";
import { decisionLabels, kindLabels, parseSavedClassification, statusLabels, type TaskKind } from "../../features/students/policy";
import { StudentNotice } from "./StudentFrame";

type Result = Awaited<ReturnType<typeof studentAdminData>>;
type Feedback = { error?: string; message?: string; invite?: { url: string; expiresAt: string; seatCode: string }; receipt?: StudentAdminView };
function kst(date: string) { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(date)); }
const changes: Record<string, string> = { ISSUE_INVITE: "개별 초대 발급", SET_ACCESS: "좌석 접근 변경", CANCEL_TASK: "배정 취소", ASSIGN_TASK: "작업 1건 배정", BATCH_ASSIGN: "표시된 점포 일괄 배정" };
const codes: Record<string, string> = { INVITE_ISSUED: "초대 발급", ACCESS_ENABLED: "좌석 사용 허용", ACCESS_DISABLED: "좌석 접근 중지", TASK_CANCELLED: "배정 취소", ASSIGNED: "배정", ALREADY_ASSIGNED: "기존 배정으로 건너뜀", SOURCE_UNAVAILABLE: "대상 상태 변경으로 건너뜀" };
function invitationState(invite: Result["invitations"][number], asOf: string | null) {
  if (invite.consumedAt) return "수락됨";
  if (invite.revokedAt) return "회수됨";
  if (!asOf) return "발급됨 · 만료 여부 확인 필요";
  return invite.expiresAt <= asOf ? "만료됨" : "발급됨 · 수락 대기";
}
export function StudentManagement({ result, feedback, operation, asOf }: { result: Result; feedback?: Feedback; operation?: StudentAdminView | null; asOf?: string }) {
  const [kind, setKind] = useState<TaskKind>("PLACE"); const [copied, setCopied] = useState(false); const [copyFailed, setCopyFailed] = useState(false);
  const serverTime = asOf ?? result.asOf;
  const [currentTime, setCurrentTime] = useState<string | null>(serverTime ?? null);
  useEffect(() => { setCopied(false); setCopyFailed(false); }, [feedback?.invite?.url]);
  useEffect(() => { setCurrentTime(serverTime ?? new Date().toISOString()); }, [serverTime]);
  const pending = useNavigation().state !== "idle";
  const view = feedback?.receipt && (!operation || feedback.receipt.id === operation.id) ? feedback.receipt : operation;
  const committed = view?.status === "COMMITTED";
  const eligibleSeats = result.seats.filter((s) => s.isActive && (!currentTime || s.expiresAt > currentTime) && (kind === "PLACE" ? s.canClassifyPlaces : kind === "REVIEW" ? s.canClassifyReviews : s.canRecordQa));
  return <>
    <StudentNotice {...feedback} />
    {view && <section className="student-section" aria-labelledby="student-operation-title">
      <h2 id="student-operation-title">{committed ? "학생 관리 확정 영수증" : "학생 관리 변경 미리보기"}</h2>
      <p><strong>{changes[view.change] ?? "학생 관리 변경"}</strong> · 요청 {view.requestedCount}건 · {committed ? `적용 ${view.appliedCount ?? "미확인"}건` : "확정 전"} · 건너뜀 {view.skippedCount}건</p>
      <p className="student-help">작업 번호 <code>{view.id}</code></p>
      {!committed && <p className="student-help">아직 변경되지 않았습니다. 대상과 건너뛸 항목을 확인한 뒤 확정하세요. 미리보기 만료 {kst(view.expiresAt)} KST.</p>}
      <table className="student-data student-data--responsive"><thead><tr><th>대상</th><th>상태</th><th>{committed ? "처리 결과" : "처리 예정"}</th></tr></thead><tbody>{view.rows.map((row, index) => <tr key={`${row.targetRef}-${index}`}><td>{row.label ?? row.targetRef}<br /><small><code>{row.targetRef}</code></small></td><td>{row.outcome === "SKIP" ? "건너뜀" : row.outcome === "APPLIED" ? "적용 완료" : row.outcome === "APPLY" && !committed ? "확정 시 적용" : "확인 필요"}</td><td>{codes[row.code] ?? "확인 필요"}{!committed && row.outcome === "APPLY" ? " 예정" : ""}</td></tr>)}</tbody></table>
      {committed ? <p className="student-help">이 영수증은 확정 결과입니다. 같은 작업을 다시 확정하지 않습니다. 초대 링크 원문은 영수증에 보관하지 않습니다.</p> : <div className="student-actions"><Form method="post"><input type="hidden" name="intent" value="confirm" /><input type="hidden" name="operationId" value={view.id} /><button className="student-button" disabled={pending}>변경 확정</button></Form><Link className="student-link" to={`/admin/reauth?${new URLSearchParams({ returnTo: `/admin/students?operation=${view.id}` })}`}>관리자 재인증 후 돌아오기</Link><Link className="student-link" to="/admin/students">미리보기 닫기</Link></div>}
    </section>}
    {feedback?.invite && <div className="student-invite"><strong>학생 {feedback.invite.seatCode} 개별 초대 · 발급 완료</strong><label>학생에게 전달할 초대 링크<input readOnly value={feedback.invite.url} /></label><button className="student-button" onClick={async () => { try { await navigator.clipboard.writeText(feedback.invite!.url); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); } }}>{copied ? "초대 링크 복사 완료" : "초대 링크 복사"}</button>{copyFailed && <small role="status">자동 복사를 사용할 수 없습니다. 위 링크를 직접 선택해 복사해 주세요.</small>}<small>만료 {kst(feedback.invite.expiresAt)} KST · 이 응답에서만 원문 링크를 확인할 수 있습니다.</small></div>}
    <p className="student-help">초대 발급 응답을 잃었거나 새로고침해 원문 링크를 볼 수 없으면, 새 미리보기에서 초대를 재발급하세요. 이전 미사용 링크는 무효화되며 영수증에서 원문을 복구할 수 없습니다.</p>
    <section className="student-section"><h2>학생 4명 개별 계정</h2><p>학생이 본인 이메일 가입·인증 후 초대를 수락합니다. A·B는 점포 분류와 신규 등록 인가, C·D는 리뷰·사진 분류를 맡고 모두 QA를 기록합니다. 전체 관리자 권한은 부여하지 않습니다.</p>
      <table className="student-data student-data--responsive"><thead><tr><th>학생</th><th>연결과 권한</th><th>기한 KST</th><th>초대와 접근 관리</th></tr></thead><tbody>{result.seats.map((s) => <tr key={s.code}><td><strong>{s.label}</strong></td><td>{s.connected ? "개인 계정 연결 완료" : "계정 연결 전"}<br />{s.isActive ? "사용 허용" : "접근 중지"} · {s.canClassifyPlaces ? "점포 분류 · 등록 인가" : "리뷰·사진 분류"} · QA</td><td>{kst(new Date(Date.parse(s.expiresAt) - 1).toISOString())}</td><td>{!s.connected && s.isActive && <Form method="post"><input type="hidden" name="intent" value="invite" /><input type="hidden" name="seatCode" value={s.code} /><button disabled={pending}>학생 {s.code} 초대 발급 미리보기</button></Form>}<Form method="post"><input type="hidden" name="intent" value="access" /><input type="hidden" name="seatCode" value={s.code} /><input type="hidden" name="active" value={s.isActive ? "0" : "1"} /><button disabled={pending}>{s.isActive ? "접근 중지 검토" : "접근 허용 검토"}</button></Form></td></tr>)}</tbody></table>
      <p className="student-help">좌석을 중지하면 연결된 학생의 작업 접근이 즉시 차단됩니다. 다시 허용해도 좌석 소유자와 기존 작업 이력은 바뀌지 않습니다.</p>
      <h3>최근 초대 상태</h3>
      {result.invitations.length ? <table className="student-data student-data--responsive"><thead><tr><th>학생</th><th>상태</th><th>만료 KST</th></tr></thead><tbody>{result.invitations.map((invite, index) => <tr key={`${invite.seatCode}-${invite.expiresAt}-${index}`}><td>학생 {invite.seatCode}</td><td>{invitationState(invite, currentTime)}</td><td>{kst(invite.expiresAt)}</td></tr>)}</tbody></table> : <p className="student-help">발급된 초대가 없습니다.</p>}
    </section>
    <section className="student-section"><h2>작업 대상과 담당자 배정</h2><Form method="get" className="student-form"><label>점포 검수 단계<select name="step" defaultValue={result.query.step}>{["원천 확인", "외부 정보 대조", "세부 업종", "중복 검토", "등록 인가 검토"].map((s, n) => <option key={s} value={n + 1}>{n + 1} {s}</option>)}</select></label><label>점포명 또는 주소 검색<input name="q" maxLength={80} defaultValue={result.query.query} /></label><button>배정할 점포 찾기</button></Form>
      <p className="student-help">현재 점포 대기표 {result.queue.pagination.total}건 중 {result.queue.rows.length}건 표시</p>
      <Form method="post" className="student-form" key={kind}><label>업무 종류<select name="kind" value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>{Object.entries(kindLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>1차 담당<select name="assignedSeat" defaultValue={eligibleSeats[0]?.code}>{eligibleSeats.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></label>
        <label>다른 학생의 교차 확인<select name="checkerSeat" defaultValue={eligibleSeats[1]?.code}>{eligibleSeats.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></label>
        {kind === "QA" ? <label>시험할 서비스 경로<input name="targetId" defaultValue="/places" maxLength={512} required /></label> : <label>배정할 대상<select name="targetId" required><option value="">대상을 선택하세요</option>{kind === "PLACE" ? result.queue.rows.map((r) => <option key={r.workItemId} value={r.workItemId}>{r.name} · {r.address}</option>) : result.reviews.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.id.slice(0, 8)}</option>)}</select></label>}
        <label>학생에게 보일 작업명<input name="title" minLength={2} maxLength={120} required defaultValue={kindLabels[kind]} /></label>
        <input type="hidden" name="targetIds" value={JSON.stringify(result.queue.rows.map((r) => r.workItemId))} />
        <div className="student-actions"><button name="intent" value="assign" disabled={pending}>선택 작업 1건 배정 미리보기</button>{kind === "PLACE" && <button className="student-button--secondary" name="intent" value="assign-batch" disabled={pending || !result.queue.rows.length} formNoValidate>표시된 점포 최대 25건 배정 미리보기</button>}</div>
      </Form>
      <nav className="student-pagination" aria-label="점포 대기표 페이지">{result.query.page > 1 && <Link to={`?step=${result.query.step}&q=${encodeURIComponent(result.query.query)}&page=${result.query.page - 1}`}>이전 점포</Link>}<span>{result.queue.pagination.page} / {result.queue.pagination.totalPages}</span>{result.queue.pagination.page < result.queue.pagination.totalPages && <Link to={`?step=${result.query.step}&q=${encodeURIComponent(result.query.query)}&page=${result.queue.pagination.page + 1}`}>다음 점포</Link>}</nav>
    </section>
    <section className="student-section"><h2>작업 결과와 등록 인가</h2><p>학생 인가는 신규 점포의 근거 확인 기록입니다. 실제 공개는 <Link className="student-link" to="/admin/place-operations?step=5">장소 운영의 최종 검수</Link>에서 원천·업종·중복을 다시 확인한 뒤 실행합니다.</p>
      <table className="student-data student-data--responsive"><thead><tr><th>작업</th><th>담당과 상태</th><th>분류와 확인 근거</th><th>배정</th></tr></thead><tbody>{result.tasks.map((t) => { const saved = parseSavedClassification(t.classificationJson); return <tr key={t.id}><td><strong>{t.title}</strong><br />{kindLabels[t.kind]}</td><td>{t.assignedSeat} → {t.checkerSeat}<br />{statusLabels[t.status]}<br />{t.checkedAt ? kst(t.checkedAt) : ""}</td><td>{saved ? <details><summary>{decisionLabels[saved.decision]}</summary><p className="student-record">{saved.note}</p>{saved.evidenceUrl && <a className="student-link" href={saved.evidenceUrl} target="_blank" rel="noopener noreferrer">근거 링크</a>}{t.reviewNote && <p className="student-record">교차 확인 {t.reviewNote}</p>}</details> : "제출 대기"}</td><td>{t.isActive ? <Form method="post"><input type="hidden" name="intent" value="cancel" /><input type="hidden" name="taskId" value={t.id} /><button disabled={pending}>배정 취소 미리보기</button></Form> : "취소됨"}</td></tr>; })}</tbody></table>
      {!result.tasks.length && <p>배정된 작업이 없습니다.</p>}
      <nav className="student-pagination" aria-label="전체 작업 페이지">{result.taskPage > 1 && <Link to={`?taskPage=${result.taskPage - 1}`}>이전 작업</Link>}<span>{result.taskPage}쪽 · 총 {result.taskTotal}건</span>{result.taskPage * 50 < result.taskTotal && <Link to={`?taskPage=${result.taskPage + 1}`}>다음 작업</Link>}</nav>
    </section>
  </>;
}
