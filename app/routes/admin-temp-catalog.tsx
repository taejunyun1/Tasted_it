import { env } from "cloudflare:workers";
import { Form, Link, data, redirect } from "react-router";
import type { Route } from "./+types/admin-temp-catalog";
import { requireAdmin, readSessionId } from "../features/auth/session.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { getAdminOperation } from "../features/operations/admin-operation.server";
import { readTempForm } from "../features/temp-catalog/temp-catalog-http";
import { createNaverLocalSearchAdapter } from "../features/candidates/naver-local-search.server";
import { commitTempPublication, confirmTempCoordinateEvidence, geocodeNextTempEntry, prepareTempPublication, stageTempCatalog, tempCatalogStatus } from "../features/temp-catalog/temp-catalog.server";

export async function loader({ request }: Route.LoaderArgs) {
  const admin = await requireAdmin(request);
  const query = new URL(request.url).searchParams;
  const batchId = query.get("batch"), candidate = query.get("operation");
  const operationKind = query.get("operationKind") === "TEMP_UNPUBLISH" ? "TEMP_UNPUBLISH" as const : "TEMP_PUBLISH" as const;
  const sessionId = readSessionId(request);
  const operationId = candidate && /^[a-f0-9-]{36}$/.test(candidate) ? candidate : null;
  const operation = operationId && sessionId ? await getAdminOperation(env.DB, { actorUserId: admin.id, sessionId, operationId, kind: operationKind, now: new Date().toISOString() }).catch(() => null) : null;
  const target = operation?.status === "COMMITTED" ? operation.result : operation?.payload;
  const safeOperation = target && typeof target === "object" && !Array.isArray(target) && target.batchId === batchId ? operation : null;
  return { batch: batchId ? await tempCatalogStatus(env.DB, batchId) : null,
    operationId: safeOperation?.id ?? null, operationKind, operation: safeOperation ? { status: safeOperation.status, result: safeOperation.result } : null };
}
export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  if (!isSameOriginMutation(request)) return data({ ok: false, error: "동일 사이트에서 다시 실행해 주세요." }, { status: 403 });
  let form: FormData;
  try { form = await readTempForm(request); }
  catch (error) { return data({ ok: false, error: error instanceof Error && error.message === "TEMP_REQUEST_TOO_LARGE" ? "요청은 2MiB 이하여야 합니다." : "입력 형식을 확인해 주세요." }, { status: error instanceof Error && error.message === "TEMP_REQUEST_TOO_LARGE" ? 413 : 400 }); }
  const intent = String(form.get("intent") ?? "");
  const now = new Date().toISOString(), batchId = String(form.get("batchId") ?? "");
  try {
    if (intent === "stage") {
      const file = form.get("manifest");
      if (!(file instanceof File) || file.size > 2 * 1024 * 1024) throw new Error("TEMP_MANIFEST_INVALID");
      const result = await stageTempCatalog(env.DB, { actorUserId: admin.id, manifest: JSON.parse(await file.text()), now });
      return redirect(`/admin/temp-catalog?batch=${encodeURIComponent(result.batchId)}`);
    }
    if (intent === "geocode") return { ok: true, ...(await geocodeNextTempEntry(env.DB, { actorUserId: admin.id, batchId, now, adapter: createNaverLocalSearchAdapter(env, { database: env.DB }) })) };
    if (intent === "coordinate-source") {
      const raw = form.get("evidence");
      if (typeof raw !== "string" || raw.length > 8192) throw new Error("TEMP_COORDINATE_INVALID");
      return { ok: true, ...(await confirmTempCoordinateEvidence(env.DB, { actorUserId: admin.id, batchId, now, evidence: JSON.parse(raw) })) };
    }
    // Session identity must come from the authenticated cookie, never a hidden form field.
    const sessionId = readSessionId(request);
    if (!sessionId) throw new Error("ADMIN_REQUIRED");
    const publish = intent === "preview-publish" || intent === "publish";
    const operationKind = publish ? "TEMP_PUBLISH" as const : "TEMP_UNPUBLISH" as const;
    if (intent === "preview-publish" || intent === "preview-withdraw") return { ok: true, operationKind, ...(await prepareTempPublication(env.DB, env.REVIEW_PHOTOS, { actorUserId: admin.id, sessionId, batchId, now, publish })) };
    if (intent === "publish" || intent === "withdraw") return { ok: true, operationKind, ...(await commitTempPublication(env.DB, env.REVIEW_PHOTOS, { actorUserId: admin.id, sessionId, operationId: String(form.get("operationId") ?? ""), kind: operationKind, now })) };
    throw new Error("TEMP_INTENT_INVALID");
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+(?::temp100-\d{3})?$/.test(error.message) ? error.message : "TEMP_REQUEST_INVALID";
    return data({ ok: false, error: code, operationId: ["publish", "withdraw"].includes(intent) ? String(form.get("operationId") ?? "") : null, operationKind: intent === "withdraw" ? "TEMP_UNPUBLISH" as const : "TEMP_PUBLISH" as const }, { status: code.includes("AUTH") ? 403 : 400 });
  }
}
export default function AdminTempCatalog({ loaderData, actionData }: Route.ComponentProps) {
  const batch = loaderData.batch;
  const operationId = actionData && "operationId" in actionData ? actionData.operationId : loaderData.operationId;
  const operationKind = actionData && "operationKind" in actionData ? actionData.operationKind : loaderData.operationKind;
  const returnTo = batch ? `/admin/temp-catalog?${new URLSearchParams({ batch: batch.id, ...(operationId ? { operation: operationId, operationKind } : {}) })}` : "/admin/temp-catalog";
  return <main className="shell admin-page"><Link to="/admin">← 관리자</Link><h1>TEMP 100 베타 공개</h1>
    <p>공식 출처 100곳과 사용 근거가 확인된 사진 23장을 다룹니다. 일반 평가·방문 이력은 만들지 않습니다.</p>
    {actionData && <p role="status">{"error" in actionData ? actionData.error : JSON.stringify(actionData)}</p>}
    {loaderData.operation?.status === "COMMITTED" && <p role="status">완료 영수증: {JSON.stringify(loaderData.operation.result)}</p>}
    {actionData && "error" in actionData && actionData.error === "ADMIN_RECENT_AUTH_REQUIRED" && <p><Link to={`/admin/reauth?${new URLSearchParams({ returnTo })}`}>관리자 재인증 후 같은 변경으로 돌아가기</Link></p>}
    <Form method="post" encType="multipart/form-data"><input type="hidden" name="intent" value="stage" /><label>검증된 공개 manifest <input type="file" name="manifest" accept="application/json" required /></label><button>비공개 준비</button></Form>
    {batch && <><h2>배치 {batch.id}</h2><p>{batch.status} · 좌표 {batch.matched}/100 · 기존 장소 {batch.reused} · 보류 {batch.failed.length}</p>
      <Form method="post"><input type="hidden" name="batchId" value={batch.id} /><button name="intent" value="geocode" disabled={batch.status !== "STAGED" || !!batch.failed.length || !batch.pending}>다음 1곳 좌표 확인</button></Form>
      <p>조회 실패·주소 불일치는 즉시 중단합니다. 100곳 좌표와 사진 업로드가 모두 준비되어야 공개할 수 있습니다.</p>
      <Form method="post"><input type="hidden" name="batchId" value={batch.id} /><button name="intent" value={batch.status === "PUBLISHED" ? "preview-withdraw" : "preview-publish"}>영향 미리보기</button></Form>
      {operationId && loaderData.operation?.status !== "COMMITTED" && <Form method="post"><input type="hidden" name="batchId" value={batch.id} /><input type="hidden" name="operationId" value={operationId} /><button name="intent" value={operationKind === "TEMP_UNPUBLISH" ? "withdraw" : "publish"}>미리본 변경 확정·결과 재확인</button></Form>}
      <p>회수하면 신규 TEMP 장소만 숨기고 기존 장소·회원 평가·저장은 보존합니다. 공개 확정에는 최근 관리자 인증이 필요합니다.</p></>}
  </main>;
}
