import { env } from "cloudflare:workers";
import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-students";
import { createDb } from "../db/client.server";
import { requireAdmin } from "../features/auth/session.server";
import { assignStudentQueueBatch, cancelStudentTask, studentAdminData } from "../features/students/admin.server";
import { createStudentInvite, setStudentSeatActive } from "../features/students/invitations.server";
import { consumeStudentWriteLimit, ensureStudentWorkspace, readStudentForm, studentFailure, studentLoadFailure } from "../features/students/http.server";
import { assignStudentTask } from "../features/students/tasks.server";
import { NO_STORE_HEADERS, seatCodeSchema, taskKindSchema } from "../features/students/policy";
import { StudentFrame } from "../components/students/StudentFrame";
import { StudentManagement } from "../components/students/StudentManagement";
export { StudentErrorBoundary as ErrorBoundary } from "../components/students/StudentFrame";
export const headers = () => NO_STORE_HEADERS;
export const meta = () => [{ title: "학생 계정과 업무 배정 — Re:Taste" }, { name: "robots", content: "noindex,nofollow" }];
const assignmentForm = z.object({ intent: z.enum(["assign", "assign-batch"]), kind: taskKindSchema, assignedSeat: seatCodeSchema, checkerSeat: seatCodeSchema, targetId: z.string().max(512), title: z.string().max(120), targetIds: z.string().max(13_000) }).strict();
export async function loader({ request }: Route.LoaderArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED); const user = await requireAdmin(request);
  try { return data(await studentAdminData(createDb(env.DB), user.id, new URL(request.url)), { headers: NO_STORE_HEADERS }); }
  catch (error) { return studentLoadFailure(error); }
}
export async function action({ request }: Route.ActionArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED); const user = await requireAdmin(request);
  try {
    const form = await readStudentForm(request); const db = createDb(env.DB); const now = new Date();
    await consumeStudentWriteLimit(db, user.id, now, "WORK");
    if (form.intent === "invite") {
      const values = z.object({ intent: z.literal("invite"), seatCode: seatCodeSchema }).strict().parse(form);
      const result = await createStudentInvite(db, { seatCode: values.seatCode, actorUserId: user.id, now: now.toISOString() });
      const url = new URL("/student/join", request.url); url.hash = result.token;
      return data({ message: "개별 초대를 발급했습니다. 해당 학생에게만 전달하세요.", invite: { url: url.toString(), expiresAt: result.expiresAt, seatCode: values.seatCode } }, { headers: NO_STORE_HEADERS });
    }
    if (form.intent === "access") {
      const values = z.object({ intent: z.literal("access"), seatCode: seatCodeSchema, active: z.enum(["0", "1"]) }).strict().parse(form);
      await setStudentSeatActive(db, { seatCode: values.seatCode, isActive: values.active === "1", actorUserId: user.id, now: now.toISOString() });
      return data({ message: "학생 접근 상태를 변경했습니다. 기존 미사용 초대는 무효화했습니다." }, { headers: NO_STORE_HEADERS });
    }
    if (form.intent === "cancel") {
      const values = z.object({ intent: z.literal("cancel"), taskId: z.string().min(1).max(128) }).strict().parse(form);
      await cancelStudentTask(db, { actorUserId: user.id, taskId: values.taskId, now: now.toISOString() });
      return data({ message: "배정을 취소했습니다. 작업 기록은 보존됩니다." }, { headers: NO_STORE_HEADERS });
    }
    const values = assignmentForm.parse(form);
    if (values.intent === "assign-batch") {
      if (values.kind !== "PLACE") throw new Error("STUDENT_INPUT_INVALID");
      let targetIds: string[]; try { targetIds = z.array(z.string()).parse(JSON.parse(values.targetIds)); } catch { throw new Error("STUDENT_INPUT_INVALID"); }
      const result = await assignStudentQueueBatch(db, { actorUserId: user.id, assignedSeat: values.assignedSeat, checkerSeat: values.checkerSeat, targetIds, now: now.toISOString() });
      return data({ message: `점포 ${result.assigned}건 배정 · 기존 배정 ${result.skipped}건 건너뜀` }, { headers: NO_STORE_HEADERS });
    }
    const { intent: _intent, targetIds: _targetIds, ...assignment } = values;
    await assignStudentTask(db, { ...assignment, actorUserId: user.id, now: now.toISOString() });
    return data({ message: "작업을 배정했습니다." }, { headers: NO_STORE_HEADERS });
  } catch (error) { return studentFailure(error); }
}
export default function AdminStudents({ loaderData, actionData }: Route.ComponentProps) {
  return <StudentFrame admin title="학생 계정과 업무 배정" description="A~D별 초대를 발급하고 점포·리뷰·QA 작업을 배정합니다."><StudentManagement result={loaderData} feedback={actionData} /></StudentFrame>;
}
