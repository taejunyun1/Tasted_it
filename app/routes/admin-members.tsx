import { env } from "cloudflare:workers";
import { data, Form, isRouteErrorResponse, Link, redirect, useLocation, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-members";
import { getAdminAssurance } from "../features/auth/admin-assurance.server";
import { requireAdminSession } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { commitMemberChange, getMemberPreview, listMembers, prepareMemberChange } from "../features/members/member-admin.server";
import "../styles/admin-home.css";
import "../styles/admin-members.css";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
const memberId = z.string().min(1).max(128);
const searchFields = { q: z.string().max(100).optional(), cursor: z.string().max(2048).optional(), user: memberId.optional() };
const querySchema = z.object({ ...searchFields, operation: z.uuid().optional() }).strict();
const prepareSchema = z.object({
  ...searchFields, intent: z.literal("prepare"), targetUserId: memberId,
  action: z.enum(["RESTRICT", "LIFT", "REVOKE_SESSIONS"]), reason: z.string().trim().min(2).max(300),
  durationDays: z.coerce.number().int().min(1).max(90).optional(),
  selectedSessionRef: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^[a-f0-9]{64}$/).optional()),
}).strict();
const commitSchema = z.object({ ...searchFields, intent: z.literal("commit"), operationId: z.uuid() }).strict();

function memberUrl(input: { q?: string; cursor?: string; user?: string; operation?: string } = {}) {
  const params = new URLSearchParams();
  for (const key of ["q", "cursor", "user", "operation"] as const) if (input[key]) params.set(key, input[key]!);
  return `/admin/members${params.size ? `?${params}` : ""}`;
}

function queryInput(url: URL) {
  const values: Record<string, string> = {};
  for (const key of ["q", "cursor", "user", "operation"] as const) {
    if (url.searchParams.getAll(key).length > 1) throw new Error("MEMBER_INPUT_INVALID");
    const value = url.searchParams.get(key);
    if (value !== null && value !== "") values[key] = value;
  }
  return querySchema.parse(values);
}

async function readForm(request: Request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) throw new Error("MEMBER_INPUT_INVALID");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new Error("MEMBER_INPUT_INVALID"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const values: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(body))) {
    if (Object.hasOwn(values, key)) throw new Error("MEMBER_INPUT_INVALID");
    values[key] = value;
  }
  return values;
}

function publicError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "MEMBER_LAST_ADMIN") return "접근 가능한 마지막 관리자는 제한할 수 없습니다.";
  if (code === "MEMBER_SELF_RESTRICTION") return "현재 접속한 계정의 접근 상태는 이 화면에서 변경할 수 없습니다.";
  if (code === "MEMBER_NOT_FOUND") return "회원을 찾을 수 없습니다. 목록을 다시 조회해 주세요.";
  if (code === "MEMBER_INPUT_INVALID" || error instanceof z.ZodError) return "검색 조건, 사유와 제한 기간을 확인해 주세요.";
  return "대상 상태가 바뀌었거나 미리보기가 만료되었습니다. 새로 조회한 뒤 다시 미리보기해 주세요.";
}

export const headers: Route.HeadersFunction = () => PRIVATE_HEADERS;
export const meta: Route.MetaFunction = () => [{ title: "회원 관리 | Re:Taste" }, { name: "robots", content: "noindex, nofollow" }];

export async function loader({ request }: Route.LoaderArgs) {
  const { user, sessionId } = await requireAdminSession(request);
  const url = new URL(request.url);
  let query: z.infer<typeof querySchema>;
  try { query = queryInput(url); }
  catch { throw new Response(null, { status: 400, headers: PRIVATE_HEADERS }); }
  const now = new Date();
  const actor = { actorUserId: user.id, sessionId, now: now.toISOString() };
  try {
    const result = await listMembers(env.DB, { ...actor, query: query.q, cursor: query.cursor, targetUserId: query.user });
    let preview: (Awaited<ReturnType<typeof getMemberPreview>> & { committed?: boolean }) | null = null;
    let previewUnavailable = false;
    if (query.operation) {
      try { preview = await getMemberPreview(env.DB, { ...actor, operationId: query.operation }); }
      catch { previewUnavailable = true; }
    }
    return data({ ...result, query, preview, previewUnavailable, currentUserId: user.id,
      assurance: await getAdminAssurance(env.DB, { actorUserId: user.id, sessionId, now }) }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    throw new Response(null, { status: error instanceof Error && error.message === "MEMBER_INPUT_INVALID" ? 400 : 503, headers: PRIVATE_HEADERS });
  }
}

export async function action({ request }: Route.ActionArgs) {
  const { user, sessionId } = await requireAdminSession(request);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: "POST" } });
  if (!isSameOriginMutation(request)) return data({ error: "현재 사이트에서 다시 실행해 주세요." }, { status: 403, headers: PRIVATE_HEADERS });
  const actor = { actorUserId: user.id, sessionId, now: new Date().toISOString() };
  let returnTo = "/admin/members";
  try {
    const form = await readForm(request);
    if (form.intent === "commit") {
      const input = commitSchema.parse(form);
      returnTo = memberUrl({ ...input, operation: input.operationId });
      await commitMemberChange(env.DB, { ...actor, operationId: input.operationId });
      return redirect(memberUrl({ ...input, operation: input.operationId }), { headers: PRIVATE_HEADERS });
    }
    const input = prepareSchema.parse(form);
    returnTo = memberUrl({ ...input, user: input.targetUserId });
    const preview = await prepareMemberChange(env.DB, { ...actor, targetUserId: input.targetUserId, action: input.action,
      reason: input.reason, durationDays: input.durationDays, selectedSessionRef: input.selectedSessionRef });
    return redirect(memberUrl({ ...input, user: input.targetUserId, operation: preview.operationId }), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_RECENT_AUTH_REQUIRED") {
      return redirect(`/admin/reauth?${new URLSearchParams({ returnTo })}`, { headers: PRIVATE_HEADERS });
    }
    return data({ error: publicError(error) }, { status: error instanceof z.ZodError || (error instanceof Error && error.message === "MEMBER_INPUT_INVALID") ? 400 : 409, headers: PRIVATE_HEADERS });
  }
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const invalid = isRouteErrorResponse(error) && error.status === 400;
  const location = useLocation();
  return <main id="main" className="admin-home admin-members"><h1>{invalid ? "조회 조건을 확인해 주세요." : "회원 정보를 불러올 수 없습니다."}</h1>
    <p>{invalid ? "검색과 페이지 조건을 지우고 다시 조회해 주세요." : "응답을 확인하지 못했다면 같은 작업을 다시 조회해 확정 여부를 확인하세요."}</p>
    {!invalid && <p><Link reloadDocument to={`${location.pathname}${location.search}`}>현재 작업 다시 조회</Link></p>}<Link to="/admin/members">회원 목록 처음으로</Link></main>;
}

function timestamp(value: string | null) {
  if (!value) return "없음";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(date) : "미확인";
}
const roles: Record<string, string> = { USER: "일반 회원", REVIEWER: "리뷰어", ADMIN: "관리자" };
const actions = { RESTRICT: "접근 제한", LIFT: "접근 제한 해제", REVOKE_SESSIONS: "세션 회수" };

export default function AdminMembers({ loaderData, actionData }: Route.ComponentProps) {
  const { members, selected, preview, query } = loaderData;
  const committed = preview?.committed === true;
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  const otherSessions = selected?.sessions.filter((session) => !session.isCurrent) ?? [];
  const returnTo = memberUrl({ ...query, operation: preview?.operationId ?? query.operation });
  const navigationFields = <><input type="hidden" name="q" value={query.q ?? ""} />{query.cursor && <input type="hidden" name="cursor" value={query.cursor} />}{selected && <input type="hidden" name="user" value={selected.id} />}</>;
  return <main id="main" className="admin-home admin-members">
    <header className="admin-home__header"><div><p className="admin-home__eyebrow">RE:TASTE / ADMIN</p><h1>회원 관리</h1><p>접근 제한과 세션 회수는 회원 역할, 리뷰어 자격과 게시 콘텐츠를 바꾸지 않습니다.</p></div><Link to="/admin">운영 홈</Link></header>
    {!committed && !loaderData.assurance && <p className="admin-members__notice">변경 확정에는 최근 10분 이내 재인증이 필요합니다. <Link to={`/admin/reauth?${new URLSearchParams({ returnTo })}`}>관리자 재인증</Link></p>}
    {committed && <p role="status" className="admin-members__notice admin-members__notice--success">확정 영수증을 확인했습니다. 회수된 세션은 복구되지 않으며 다시 로그인해야 합니다.</p>}
    {actionData?.error && <p role="alert" className="admin-members__notice admin-members__notice--error">{actionData.error}</p>}
    {loaderData.previewUnavailable && <p role="status" className="admin-members__notice">이 미리보기는 더 이상 사용할 수 없습니다. 대상 상태를 확인하고 새로 미리보기해 주세요.</p>}
    {preview && <section className="admin-members__preview" aria-labelledby="member-preview-title"><h2 id="member-preview-title">{committed ? "변경 확정 영수증" : "변경 미리보기"}</h2>
      <p><strong>{preview.displayName}</strong> · {preview.emailMasked}</p><dl><div><dt>변경</dt><dd>{actions[preview.action]}</dd></div>{!committed && <div><dt>사유</dt><dd>{preview.reason}</dd></div>}{preview.expiresAt && <div><dt>제한 종료</dt><dd>{timestamp(preview.expiresAt)} (한국 시간)</dd></div>}<div><dt>{committed ? "회수한 세션" : "회수할 세션"}</dt><dd>{preview.sessionCount}개</dd></div></dl>
      <p>제한 설정·해제 후에는 다시 로그인해야 합니다. 현재 작업 중인 세션은 유지됩니다.</p>
      {committed ? <Link to={memberUrl({ ...query, operation: undefined })}>회원 상태 다시 조회</Link> : <Form method="post" className="admin-members__buttons">{navigationFields}<input type="hidden" name="intent" value="commit" /><input type="hidden" name="operationId" value={preview.operationId} /><button type="submit" disabled={pending} className="admin-members__danger">변경 확정</button><Link to={memberUrl({ ...query, operation: undefined })}>취소</Link></Form>}
    </section>}
    <Form method="get" className="admin-members__search"><label htmlFor="member-search">이름·이메일·회원 ID<input id="member-search" name="q" type="search" defaultValue={query.q ?? ""} maxLength={100} placeholder="검색어를 입력하세요" /></label><button type="submit">검색</button></Form>
    <div className="admin-members__grid"><section className="admin-members__list-section" aria-labelledby="member-list-title"><div className="admin-home__section-heading"><h2 id="member-list-title">회원 목록</h2><span>현재 {members.length}명 · 최대 50명</span></div>
      {members.length ? <ul className="admin-members__list">{members.map((member) => <li key={member.id}><Link to={memberUrl({ ...query, user: member.id, operation: undefined })} aria-current={member.id === selected?.id ? "true" : undefined}>
        <div><strong>{member.displayName}</strong><span>{member.emailMasked}</span><small>{roles[member.role] ?? member.role}{member.id === loaderData.currentUserId ? " · 현재 계정" : ""}</small></div><span className={`admin-members__state${member.accessStatus === "RESTRICTED" ? " admin-members__state--restricted" : ""}`}>{member.accessStatus === "RESTRICTED" ? "접근 제한" : "접근 가능"}</span>
      </Link></li>)}</ul> : <p className="admin-members__empty">검색 조건에 맞는 회원이 없습니다.</p>}
      <nav className="admin-members__pagination" aria-label="회원 목록 페이지"><Link to={memberUrl({ q: query.q })}>처음부터 조회</Link>{loaderData.nextCursor && <Link to={memberUrl({ q: query.q, cursor: loaderData.nextCursor })}>다음 50명</Link>}</nav>
    </section>
      {selected ? <section className="admin-members__detail" aria-labelledby="member-detail-title"><p className="admin-home__eyebrow">선택한 회원</p><h2 id="member-detail-title">{selected.displayName}</h2><p className="admin-members__email">{selected.emailMasked}</p><dl><div><dt>회원 ID</dt><dd><code>{selected.id}</code></dd></div><div><dt>역할</dt><dd>{roles[selected.role] ?? selected.role}</dd></div><div><dt>접근 상태</dt><dd>{selected.accessStatus === "RESTRICTED" ? "접근 제한 중" : "접근 가능"}</dd></div><div><dt>제한 종료</dt><dd>{timestamp(selected.restrictionExpiresAt)}</dd></div>{selected.restrictionReason && <div><dt>최근 제한 사유</dt><dd>{selected.restrictionReason}</dd></div>}</dl>
        {selected.id === loaderData.currentUserId ? <p className="admin-members__muted">현재 접속한 계정의 접근 상태는 변경할 수 없습니다.</p> : <Form method="post" className="admin-members__change-form">{navigationFields}<input type="hidden" name="intent" value="prepare" /><input type="hidden" name="targetUserId" value={selected.id} /><input type="hidden" name="action" value={selected.accessStatus === "RESTRICTED" ? "LIFT" : "RESTRICT"} />
          <h3>{selected.accessStatus === "RESTRICTED" ? "접근 제한 해제" : "접근 제한 설정"}</h3>
          {selected.accessStatus !== "RESTRICTED" && <label htmlFor="restriction-duration">제한 기간<select id="restriction-duration" name="durationDays" defaultValue="7"><option value="1">1일</option><option value="7">7일</option><option value="30">30일</option></select></label>}
          <label htmlFor="restriction-reason">변경 사유<textarea id="restriction-reason" name="reason" minLength={2} maxLength={300} required rows={3} placeholder="판단 근거를 300자 이내로 입력하세요" /></label>
          <p className="admin-members__muted">기한이 지나면 제한은 자동 종료됩니다. 종료·해제 후에도 이전 세션은 복구되지 않습니다.</p><button type="submit" disabled={pending}>{selected.accessStatus === "RESTRICTED" ? "제한 해제 미리보기" : "제한 미리보기"}</button>
        </Form>}
        <section className="admin-members__sessions" aria-labelledby="member-session-title"><h3 id="member-session-title">활성 세션</h3>{selected.sessions.length ? <ul>{selected.sessions.map((session) => <li key={session.ref}><span>로그인 {timestamp(session.createdAt)}</span><span>만료 {timestamp(session.expiresAt)}</span>{session.isCurrent && <strong>현재 작업 중인 세션 · 유지</strong>}</li>)}</ul> : <p className="admin-members__muted">활성 세션이 없습니다.</p>}
          {otherSessions.length > 0 && <Form method="post" className="admin-members__change-form">{navigationFields}<input type="hidden" name="intent" value="prepare" /><input type="hidden" name="targetUserId" value={selected.id} /><input type="hidden" name="action" value="REVOKE_SESSIONS" /><label htmlFor="session-target">회수 대상<select id="session-target" name="selectedSessionRef" defaultValue=""><option value="">다른 활성 세션 모두 ({otherSessions.length}개)</option>{otherSessions.map((session) => <option key={session.ref} value={session.ref}>{timestamp(session.createdAt)} 로그인 세션</option>)}</select></label><label htmlFor="session-reason">세션 회수 사유<textarea id="session-reason" name="reason" minLength={2} maxLength={300} required rows={2} /></label><button type="submit" disabled={pending}>세션 회수 미리보기</button></Form>}
        </section>
      </section> : <aside className="admin-members__empty admin-members__detail"><h2>회원 선택</h2><p>목록에서 회원을 선택하면 접근 상태와 활성 세션을 확인할 수 있습니다.</p></aside>}
    </div>
  </main>;
}
