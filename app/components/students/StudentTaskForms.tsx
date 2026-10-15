import { Form, useNavigation } from "react-router";
import type { getStudentTask } from "../../features/students/tasks.server";
import { decisionLabels, parseSavedClassification } from "../../features/students/policy";

type Detail = Awaited<ReturnType<typeof getStudentTask>>;
export function StudentTaskForms({ detail }: { detail: Detail }) {
  const { seat, task, subject, categories } = detail;
  const nav = useNavigation(); const pending = nav.state !== "idle";
  const saved = parseSavedClassification(task.classificationJson);
  if (seat.code === task.assignedSeat) {
    const decisions = task.kind === "PLACE" ? ["ELIGIBLE", "EXCLUDE", "HOLD"] as const : task.kind === "REVIEW" ? ["VERIFIED", "NEEDS_INFO", "ESCALATE"] as const : ["PASS", "FAIL", "NOT_RUN"] as const;
    return <section className="student-section"><h2>분류 결과 제출</h2><p>사유와 직접 확인한 근거를 기록하세요. 재제출하면 교차 확인과 기존 인가를 다시 받아야 합니다.</p>
      <Form method="post" className="student-form" key={`${task.id}-${task.version}`}>
        <input type="hidden" name="intent" value="submit" /><input type="hidden" name="version" value={task.version} /><input type="hidden" name="fingerprint" value={detail.fingerprint} /><input type="hidden" name="kind" value={task.kind} />
        <label>분류 결과<select name="decision" defaultValue={saved?.decision ?? decisions[0]}>{decisions.map((d) => <option key={d} value={d}>{decisionLabels[d]}</option>)}</select></label>
        {task.kind === "PLACE" && <label>세부 음식 종류<select name="categoryId" defaultValue={saved?.kind === "PLACE" ? saved.categoryId ?? "" : subject.categoryId ?? ""}><option value="">추가 확인 필요</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label>{task.kind === "QA" ? "기기와 재현 순서 기대 결과 실제 결과" : "분류 사유와 확인한 사실"}<textarea name="note" minLength={10} maxLength={1500} required defaultValue={saved?.note ?? ""} /></label>
        <label>근거 링크 선택<input type="url" name="evidenceUrl" maxLength={1000} placeholder="https://" defaultValue={saved?.evidenceUrl ?? ""} /></label>
        <button disabled={pending}>분류 제출하고 교차 확인 요청</button>
      </Form>
    </section>;
  }
  if (task.status !== "SUBMITTED" || !saved) return <p className="student-empty">1차 담당자의 제출 후 교차 확인할 수 있습니다.</p>;
  const canAttest = task.kind === "PLACE" && saved.kind === "PLACE" && saved.decision === "ELIGIBLE" && saved.categoryId === subject.categoryId && seat.canApproveRegistration && subject.registrationReady && !detail.sourceChanged;
  return <section className="student-section"><h2>다른 학생의 근거 확인</h2><p>확인이 어려우면 보완 요청을 남기세요. 신규 등록 인가는 최종 검수 조건을 갖춘 점포에만 가능합니다.</p>
    <Form method="post" className="student-form"><input type="hidden" name="version" value={task.version} /><label>교차 확인 근거 또는 보완할 내용<textarea name="reviewNote" minLength={10} maxLength={1500} required /></label>
      <div className="student-actions"><button name="intent" value="check" disabled={pending || detail.sourceChanged}>교차 확인 완료</button><button className="student-button--secondary" name="intent" value="request-changes" disabled={pending || detail.sourceChanged}>보완 요청</button>{canAttest && <button name="intent" value="attest" disabled={pending}>신규 점포 등록 인가</button>}</div>
    </Form><p className="student-help">등록 인가는 근거 확인 기록입니다. 실제 공개는 운영 담당자가 기존 검수 화면에서 실행합니다.</p>
  </section>;
}
