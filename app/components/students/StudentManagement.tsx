import { useEffect, useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import type { studentAdminData } from "../../features/students/admin.server";
import { decisionLabels, kindLabels, parseSavedClassification, statusLabels, type TaskKind } from "../../features/students/policy";
import { StudentNotice } from "./StudentFrame";

type Result = Awaited<ReturnType<typeof studentAdminData>>;
type Feedback = { error?: string; message?: string; invite?: { url: string; expiresAt: string; seatCode: string } };
function kst(date: string) { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(date)); }
export function StudentManagement({ result, feedback }: { result: Result; feedback?: Feedback }) {
  const [kind, setKind] = useState<TaskKind>("PLACE"); const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [feedback?.invite?.url]);
  const pending = useNavigation().state !== "idle";
  const eligibleSeats = result.seats.filter((s) => s.isActive && (kind === "PLACE" ? s.canClassifyPlaces : kind === "REVIEW" ? s.canClassifyReviews : s.canRecordQa));
  return <>
    <StudentNotice {...feedback} />
    {feedback?.invite && <div className="student-invite"><strong>학생 {feedback.invite.seatCode} 개별 초대</strong><label>학생에게 전달할 초대 링크<input readOnly value={feedback.invite.url} /></label><button className="student-button" onClick={async () => { await navigator.clipboard.writeText(feedback.invite!.url); setCopied(true); }}>{copied ? "초대 링크 복사 완료" : "초대 링크 복사"}</button><small>만료 {kst(feedback.invite.expiresAt)} KST · 이 화면을 떠나면 원문 링크를 다시 볼 수 없습니다.</small></div>}
    <section className="student-section"><h2>학생 4명 개별 계정</h2><p>학생이 본인 이메일 가입·인증 후 초대를 수락합니다. A·B는 점포 분류와 신규 등록 인가, C·D는 리뷰·사진 분류를 맡고 모두 QA를 기록합니다. 전체 관리자 권한은 부여하지 않습니다.</p>
      <table className="student-data student-data--responsive"><thead><tr><th>학생</th><th>연결과 권한</th><th>기한 KST</th><th>초대와 접근 관리</th></tr></thead><tbody>{result.seats.map((s) => <tr key={s.code}><td><strong>{s.label}</strong></td><td>{s.connected ? "개인 계정 연결 완료" : "초대 수락 대기"}<br />{s.isActive ? "사용 허용" : "접근 중지"} · {s.canClassifyPlaces ? "점포 분류 · 등록 인가" : "리뷰·사진 분류"} · QA</td><td>{kst(new Date(Date.parse(s.expiresAt) - 1).toISOString())}</td><td>{!s.connected && s.isActive && <Form method="post"><input type="hidden" name="intent" value="invite" /><input type="hidden" name="seatCode" value={s.code} /><button disabled={pending}>학생 {s.code} 초대 발급</button></Form>}<Form method="post"><input type="hidden" name="intent" value="access" /><input type="hidden" name="seatCode" value={s.code} /><input type="hidden" name="active" value={s.isActive ? "0" : "1"} /><button disabled={pending}>{s.isActive ? "접근 중지" : "접근 허용"}</button></Form></td></tr>)}</tbody></table>
      <p className="student-help">미사용 초대를 다시 발급하면 이전 링크는 무효화됩니다. 접근 중지는 기존 로그인에도 즉시 적용됩니다.</p>
    </section>
    <section className="student-section"><h2>작업 대상과 담당자 배정</h2><Form method="get" className="student-form"><label>점포 검수 단계<select name="step" defaultValue={result.query.step}>{["원천 확인", "외부 정보 대조", "세부 업종", "중복 검토", "등록 인가 검토"].map((s, n) => <option key={s} value={n + 1}>{n + 1} {s}</option>)}</select></label><label>점포명 또는 주소 검색<input name="q" maxLength={80} defaultValue={result.query.query} /></label><button>배정할 점포 찾기</button></Form>
      <p className="student-help">현재 점포 대기표 {result.queue.pagination.total}건 중 {result.queue.rows.length}건 표시</p>
      <Form method="post" className="student-form" key={kind}><label>업무 종류<select name="kind" value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>{Object.entries(kindLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>1차 담당<select name="assignedSeat" defaultValue={eligibleSeats[0]?.code}>{eligibleSeats.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></label>
        <label>다른 학생의 교차 확인<select name="checkerSeat" defaultValue={eligibleSeats[1]?.code}>{eligibleSeats.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></label>
        {kind === "QA" ? <label>시험할 서비스 경로<input name="targetId" defaultValue="/places" maxLength={512} required /></label> : <label>배정할 대상<select name="targetId" required><option value="">대상을 선택하세요</option>{kind === "PLACE" ? result.queue.rows.map((r) => <option key={r.workItemId} value={r.workItemId}>{r.name} · {r.address}</option>) : result.reviews.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.id.slice(0, 8)}</option>)}</select></label>}
        <label>학생에게 보일 작업명<input name="title" minLength={2} maxLength={120} required defaultValue={kindLabels[kind]} /></label>
        <input type="hidden" name="targetIds" value={JSON.stringify(result.queue.rows.map((r) => r.workItemId))} />
        <div className="student-actions"><button name="intent" value="assign" disabled={pending}>선택 작업 1건 배정</button>{kind === "PLACE" && <button className="student-button--secondary" name="intent" value="assign-batch" disabled={pending || !result.queue.rows.length} formNoValidate>표시된 점포 최대 25건 배정</button>}</div>
      </Form>
      <nav className="student-pagination" aria-label="점포 대기표 페이지">{result.query.page > 1 && <Link to={`?step=${result.query.step}&q=${encodeURIComponent(result.query.query)}&page=${result.query.page - 1}`}>이전 점포</Link>}<span>{result.queue.pagination.page} / {result.queue.pagination.totalPages}</span>{result.queue.pagination.page < result.queue.pagination.totalPages && <Link to={`?step=${result.query.step}&q=${encodeURIComponent(result.query.query)}&page=${result.queue.pagination.page + 1}`}>다음 점포</Link>}</nav>
    </section>
    <section className="student-section"><h2>작업 결과와 등록 인가</h2><p>학생 인가는 신규 점포의 근거 확인 기록입니다. 실제 공개는 <Link className="student-link" to="/admin/place-operations?step=5">장소 운영의 최종 검수</Link>에서 원천·업종·중복을 다시 확인한 뒤 실행합니다.</p>
      <table className="student-data student-data--responsive"><thead><tr><th>작업</th><th>담당과 상태</th><th>분류와 확인 근거</th><th>배정</th></tr></thead><tbody>{result.tasks.map((t) => { const saved = parseSavedClassification(t.classificationJson); return <tr key={t.id}><td><strong>{t.title}</strong><br />{kindLabels[t.kind]}</td><td>{t.assignedSeat} → {t.checkerSeat}<br />{statusLabels[t.status]}<br />{t.checkedAt ? kst(t.checkedAt) : ""}</td><td>{saved ? <details><summary>{decisionLabels[saved.decision]}</summary><p className="student-record">{saved.note}</p>{saved.evidenceUrl && <a className="student-link" href={saved.evidenceUrl} target="_blank" rel="noopener noreferrer">근거 링크</a>}{t.reviewNote && <p className="student-record">교차 확인 {t.reviewNote}</p>}</details> : "제출 대기"}</td><td>{t.isActive ? <Form method="post"><input type="hidden" name="intent" value="cancel" /><input type="hidden" name="taskId" value={t.id} /><button disabled={pending}>배정 취소</button></Form> : "취소됨"}</td></tr>; })}</tbody></table>
      {!result.tasks.length && <p>배정된 작업이 없습니다.</p>}
      <nav className="student-pagination" aria-label="전체 작업 페이지">{result.taskPage > 1 && <Link to={`?taskPage=${result.taskPage - 1}`}>이전 작업</Link>}<span>{result.taskPage}쪽 · 총 {result.taskTotal}건</span>{result.taskPage * 50 < result.taskTotal && <Link to={`?taskPage=${result.taskPage + 1}`}>다음 작업</Link>}</nav>
    </section>
  </>;
}
