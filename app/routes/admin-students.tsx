import { env } from "cloudflare:workers";
import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-students";
import { createDb } from "../db/client.server";
import { requireAdminSession } from "../features/auth/session.server";
import { studentAdminData } from "../features/students/admin.server";
import { commitStudentAdminOperation, getStudentAdminOperation, prepareStudentAdminOperation, type StudentAdminCommand, type StudentAdminView } from "../features/students/admin-commands.server";
import { consumeStudentWriteLimit, ensureStudentWorkspace, readStudentForm, studentFailure, studentLoadFailure } from "../features/students/http.server";
import { NO_STORE_HEADERS, seatCodeSchema, taskKindSchema } from "../features/students/policy";
import { StudentFrame } from "../components/students/StudentFrame";
import { StudentManagement } from "../components/students/StudentManagement";
export { StudentErrorBoundary as ErrorBoundary } from "../components/students/StudentFrame";
export function headers({actionHeaders,loaderHeaders}:Route.HeadersArgs) {
  const h = new Headers(Array.from(actionHeaders).length ? actionHeaders : loaderHeaders);
  for (const [key,value] of Object.entries(NO_STORE_HEADERS)) h.set(key,value);
  h.set("Vary",[...new Set([...(h.get("Vary")??"").split(",").map(v=>v.trim()).filter(Boolean),"Cookie"])].join(", "));
  return h;
}
export const meta = () => [{ title: "학생 계정과 업무 배정 — Re:Taste" }, { name: "robots", content: "noindex,nofollow" }];
const assignmentForm = z.object({ intent: z.enum(["assign", "assign-batch"]), kind: taskKindSchema, assignedSeat: seatCodeSchema, checkerSeat: seatCodeSchema, targetId: z.string().max(512), title: z.string().max(120), targetIds: z.string().max(13_000) }).strict();
export async function loader({ request }: Route.LoaderArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED); const {user,sessionId} = await requireAdminSession(request);
  try {
    const url = new URL(request.url), operationId = url.searchParams.get("operation");
    let operation: StudentAdminView | null = null, operationUnavailable = false;
    if (operationId) { try { operation = await getStudentAdminOperation(env.DB,{actorUserId:user.id,sessionId,operationId,now:new Date().toISOString()}); } catch { operationUnavailable = true; } }
    return data({...await studentAdminData(createDb(env.DB),user.id,url),operation,operationUnavailable},{headers:NO_STORE_HEADERS});
  } catch (error) { return studentLoadFailure(error); }
}
export async function action({ request }: Route.ActionArgs) {
  ensureStudentWorkspace(env.STUDENT_WORKSPACE_ENABLED); const {user,sessionId} = await requireAdminSession(request);
  try {
    const form = await readStudentForm(request), now = new Date();
    const caller = {actorUserId:user.id,sessionId,now:now.toISOString()};
    await consumeStudentWriteLimit(createDb(env.DB),user.id,now,"WORK");
    if (form.intent === "confirm") {
      const {operationId} = z.object({intent:z.literal("confirm"),operationId:z.uuid()}).strict().parse(form);
      try {
        const result = await commitStudentAdminOperation(env.DB,{...caller,operationId});
        const receipt = await getStudentAdminOperation(env.DB,{...caller,operationId});
        const invite = result.invitation;
        const url = new URL("/student/join",request.url); if (invite) url.hash = invite.token;
        return data({message:result.replayed?"이미 확정된 결과입니다. 초대 원문은 다시 표시하지 않습니다.":"변경을 확정했습니다.",receipt,...(invite?{invite:{url:url.toString(),expiresAt:invite.expiresAt,seatCode:invite.seatCode}}:{})},{headers:NO_STORE_HEADERS});
      } catch(error) {
        if (error instanceof Error && error.message === "ADMIN_RECENT_AUTH_REQUIRED") return redirect(`/admin/reauth?returnTo=${encodeURIComponent(`/admin/students?operation=${operationId}`)}`,{headers:NO_STORE_HEADERS});
        throw error;
      }
    }
    let command:StudentAdminCommand;
    if (form.intent === "invite") {
      const v = z.object({intent:z.literal("invite"),seatCode:seatCodeSchema}).strict().parse(form); command = {change:"ISSUE_INVITE",seatCode:v.seatCode};
    } else if (form.intent === "access") {
      const v = z.object({intent:z.literal("access"),seatCode:seatCodeSchema,active:z.enum(["0","1"])}).strict().parse(form); command = {change:"SET_ACCESS",seatCode:v.seatCode,active:v.active === "1"};
    } else if (form.intent === "cancel") {
      const v = z.object({intent:z.literal("cancel"),taskId:z.string().min(1).max(128)}).strict().parse(form); command = {change:"CANCEL_TASK",taskId:v.taskId};
    } else {
      const v = assignmentForm.parse(form);
      if (v.intent === "assign-batch") {
        if (v.kind !== "PLACE") throw new Error("STUDENT_INPUT_INVALID");
        let targetIds:string[]; try {targetIds = z.array(z.string()).parse(JSON.parse(v.targetIds));} catch {throw new Error("STUDENT_INPUT_INVALID");}
        command = {change:"BATCH_ASSIGN",assignedSeat:v.assignedSeat,checkerSeat:v.checkerSeat,targetIds};
      } else command = {change:"ASSIGN_TASK",kind:v.kind,assignedSeat:v.assignedSeat,checkerSeat:v.checkerSeat,targetId:v.targetId,title:v.title};
    }
    const result = await prepareStudentAdminOperation(env.DB,{...caller,command});
    return redirect(`/admin/students?operation=${result.operationId}`,{headers:NO_STORE_HEADERS});
  } catch(error) { return studentFailure(error); }
}
export default function AdminStudents({loaderData,actionData}:Route.ComponentProps) {
  return <StudentFrame admin title="학생 계정과 업무 배정" description="A~D별 초대와 점포·리뷰·QA 작업 변경을 미리 확인하고 확정합니다."><StudentManagement result={loaderData} operation={loaderData.operation??undefined} feedback={actionData}/>{loaderData.operationUnavailable && <p role="alert">미리보기나 영수증을 확인할 수 없습니다. 변경 결과를 확인한 뒤 새로 준비해 주세요.</p>}</StudentFrame>;
}
