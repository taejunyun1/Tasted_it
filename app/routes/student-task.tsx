import { env } from "cloudflare:workers";
import { data, Form } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/student-task";
import { createDb } from "../db/client.server";
import { requireUser } from "../features/auth/session.server";
import { consumeStudentWriteLimit, ensureStudentWorkspace, readStudentForm, studentFailure, studentLoadFailure } from "../features/students/http.server";
import { getStudentTask, requireStudentSeat, reviewStudentTask, submitStudentTask } from "../features/students/tasks.server";
import { decisionLabels, NO_STORE_HEADERS, parseSavedClassification, statusLabels, taskKindSchema } from "../features/students/policy";
import { StudentFrame, StudentNotice } from "../components/students/StudentFrame";
import { StudentTaskForms } from "../components/students/StudentTaskForms";
export { StudentErrorBoundary as ErrorBoundary } from "../components/students/StudentFrame";
export const headers = () => NO_STORE_HEADERS;
export const meta = () => [{ title: "배정 자료 확인 — Re:Taste" }, { name: "robots", content: "noindex,nofollow" }];
const version = z.coerce.number().int().min(0);
const submitSchema = z.object({ intent: z.literal("submit"), version, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), kind: taskKindSchema, decision: z.string(), categoryId: z.string().optional(), note: z.string(), evidenceUrl: z.string() }).strict();
const checkSchema = z.object({ intent: z.enum(["check", "request-changes", "attest"]), version, reviewNote: z.string() }).strict();
export async function loader({ request, params }: Route.LoaderArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED); const user = await requireUser(request);
  try { return data(await getStudentTask(createDb(env.DB), { userId: user.id, taskId: params.taskId, now: new Date().toISOString() }), { headers: NO_STORE_HEADERS }); }
  catch (error) { return studentLoadFailure(error); }
}
export async function action({ request, params }: Route.ActionArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED); const user = await requireUser(request);
  try {
    const db = createDb(env.DB); const now = new Date(); await requireStudentSeat(db, user.id, now.toISOString());
    const form = await readStudentForm(request); await consumeStudentWriteLimit(db, user.id, now, "WORK");
    if (form.intent === "submit") {
      const { intent: _intent, version, fingerprint, ...classification } = submitSchema.parse(form);
      await submitStudentTask(db, { userId: user.id, taskId: params.taskId, expectedVersion: version, targetFingerprint: fingerprint, classification, now: now.toISOString() });
    } else {
      const values = checkSchema.parse(form);
      await reviewStudentTask(db, { userId: user.id, taskId: params.taskId, expectedVersion: values.version, approveRegistration: values.intent === "attest", requestChanges: values.intent === "request-changes", reviewNote: values.reviewNote, now: now.toISOString() });
    }
    return data({ message: "기록을 저장했습니다." }, { headers: NO_STORE_HEADERS });
  } catch (error) { return studentFailure(error); }
}
export default function StudentTask({ loaderData: detail, actionData }: Route.ComponentProps) {
  const { task, subject } = detail; const saved = parseSavedClassification(task.classificationJson);
  return <StudentFrame title={task.title} description={`1차 담당 ${task.assignedSeat} · 교차 확인 ${task.checkerSeat} · ${statusLabels[task.status]}`}>
    <StudentNotice {...actionData} />{detail.sourceChanged && <StudentNotice error="원천 정보가 바뀌었습니다. 1차 담당자가 다시 확인하고 제출해야 합니다." />}
    <section className="student-section"><h2>{subject.title}</h2><div className="student-facts"><p>{subject.address}</p>{subject.details.map((text) => <p key={text}>{text}</p>)}</div>
      {task.kind === "QA" && <p><a className="student-link" href={subject.address} target="_blank" rel="noopener">시험 화면 새 창</a></p>}
      {subject.photos.length > 0 && <div className="student-photo-list">{subject.photos.map((id, n) => <img key={id} src={`/review-photos/${id}`} alt={`검토할 점포 사진 ${n + 1}`} width="150" height="120" />)}</div>}
    </section>
    {saved && <section className="student-section"><h2>제출된 분류</h2><p><strong>{decisionLabels[saved.decision]}</strong></p><p className="student-record">{saved.note}</p>{saved.evidenceUrl && <a className="student-link" href={saved.evidenceUrl} target="_blank" rel="noopener noreferrer">확인 근거 새 창</a>}{task.reviewNote && <p className="student-record">교차 확인 {task.reviewNote}</p>}</section>}
    <StudentTaskForms detail={detail} />
    {detail.history.length > 0 && <section className="student-section"><h2>작업 이력</h2><ul>{detail.history.map((r) => <li key={r.version}>{r.version}차 기록 · 학생 {r.actorSeat} · {r.eventType === "SUBMIT" ? "분류 제출" : r.eventType === "REGISTRATION_ATTEST" ? "등록 인가" : "교차 확인"}</li>)}</ul></section>}
  </StudentFrame>;
}
