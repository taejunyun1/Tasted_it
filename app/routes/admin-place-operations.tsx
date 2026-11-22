import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { data, Form, isRouteErrorResponse, Link, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin-place-operations";
import { PlaceCorrectionPanel } from "../components/admin/PlaceCorrectionPanel";
import { PlaceLivenessPanel } from "../components/admin/PlaceLivenessPanel";
import { PlaceOperationPreview } from "../components/admin/PlaceOperationPreview";
import { PlaceMergePanel } from "../components/admin/PlaceMergePanel";
import { PlaceReviewPipeline } from "../components/admin/PlaceReviewPipeline";
import { PlaceSuggestionReviewCard } from "../components/admin/PlaceSuggestionReviewCard";
import { PlaceSuggestionPagination } from "../components/admin/PlaceSuggestionPagination";
import type { ReviewSkippedItem } from "../components/admin/PlaceReviewSkippedResults";
import { createDb } from "../db/client.server";
import { categories } from "../db/schema";
import { requireAdminSession } from "../features/auth/session.server";
import { getTerminalCategoryIds } from "../features/candidates/category-selection";
import { assertNaverLocalSearchEnabled, createNaverLocalSearchAdapter, NaverLocalSearchError } from "../features/candidates/naver-local-search.server";
import { isAccountRestrictedError, ACCOUNT_RESTRICTED_MESSAGE } from "../features/auth/member-access.server";
import { isSameOriginMutation } from "../features/http/same-origin";
import { listCorrectionOperations, listDuplicateOperations, listLivenessOperations } from "../features/places/place-operations-admin.server";
import {
  checkClearExclusionsRequest,
  checkCorrectionApplyRequest,
  checkCorrectionTransitionRequest,
  checkLivenessResolveRequest,
  checkMergeRequest,
  correctionOperationsHref,
  operationsErrorMessage,
  parseCorrectionOperationsPage,
} from "../features/places/place-operations-io";
import { parsePlaceOperationsTab, placeOperationsTabHref, type PlaceOperationsTab } from "../features/places/place-operations-tabs";
import { applyPlaceCorrection, transitionPlaceCorrection } from "../features/places/place-correction.server";
import { commitPlaceAdminOperation, getPlaceAdminOperation, preparePlaceAdminOperation } from "../features/places/place-admin.server";
import { placeAdminCommandSchema, type PlaceAdminCommand } from "../features/places/place-admin";
import { confirmReviewItemCategories } from "../features/places/place-review-category.server";
import { listReviewDuplicateCandidates, resolveReviewDuplicates } from "../features/places/place-review-duplicates.server";
import { verifyReviewItemsWithNaver } from "../features/places/place-review-naver.server";
import { reviewErrorMessage } from "../features/places/place-review-errors";
import { checkReviewRequest } from "../features/places/place-review-io";
import { parsePlaceReviewQuery } from "../features/places/place-review-pagination";
import { confirmLocalDiningReview } from "../features/places/local-dining-review.server";
import { getPlaceReviewStageCounts, listPlaceReviewWorkItems } from "../features/places/place-review-query.server";
import { isConfidentAdvanceEnabled } from "../features/places/place-review-pipeline";
import { advanceConfidentReviewWorkItems, advancePlaceReviewWorkItems, autoExcludeNonFoodReviewItems, excludePlaceReviewItems, holdPlaceReviewItems, sweepConfidentReviewStage, geocodeMissingReviewCoords, updateReviewItemAddresses } from "../features/places/place-review-work-items.server";
import { applyCategoryFallback } from "../features/places/place-category-fallback.server";
import { clearRecommendationExclusions, resolvePlaceLivenessCase } from "../features/places/place-revalidation.server";
import { checkSuggestionApprovalRequest, checkSuggestionTransitionRequest, suggestionApprovalErrorMessage } from "../features/places/place-suggestion-io";
import { approvePlaceSuggestion, listReviewablePlaceSuggestions, transitionPlaceSuggestion } from "../features/places/place-suggestion.server";
import { listNaverRegionDailyUsage } from "../features/places/naver-region-quota.server";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export function headers({actionHeaders,loaderHeaders}:Route.HeadersArgs) {
  const result = new Headers([...actionHeaders].length ? actionHeaders : loaderHeaders);
  result.set("Cache-Control",PRIVATE["Cache-Control"]);
  result.set("Vary",[...new Set([...(result.get("Vary")??"").split(",").map(v=>v.trim()).filter(Boolean),"Cookie"])].join(", "));
  return result;
}
async function readOperationsForm(request:Request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) throw new Response(null,{status:415,headers:PRIVATE});
  const reader=request.body?.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  if (reader) try { for (;;) { const part=await reader.read(); if(part.done)break; size+=part.value.byteLength; if(size>65536) {await reader.cancel();throw new Response(null,{status:413,headers:PRIVATE});} chunks.push(part.value); } } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let params:URLSearchParams; try {params=new URLSearchParams(new TextDecoder("utf-8",{fatal:true}).decode(bytes));} catch {throw new Response(null,{status:400,headers:PRIVATE});}
  const form=new FormData();
  for(const key of new Set(params.keys())) {
    if(!["workItem","workItemId","autoWorkItem","duplicateCandidate"].includes(key) && params.getAll(key).length!==1) throw new Response(null,{status:400,headers:PRIVATE});
    for(const value of params.getAll(key)) form.append(key,value);
  }
  return form;
}
function placeOperationFailure(error:unknown) {
  if(isAccountRestrictedError(error)) return data({ok:false,error:ACCOUNT_RESTRICTED_MESSAGE},{status:403,headers:PRIVATE});
  const code=error instanceof Error?error.message:"UNKNOWN";
  const message=code==="PLACE_ADMIN_PREVIEW_REQUIRED"?"공개 상태 변경은 장소 공개·회수 미리보기에서 진행해 주세요.":code==="PLACE_ADMIN_RESTRICTED_PARTICIPANT"?"제한된 회원의 반응 또는 저장 이동이 포함되어 처리할 수 없습니다.":code==="ADMIN_OPERATION_CONFLICT"?"미리보기 뒤 대상이나 연결 자료가 바뀌어 변경을 적용하지 않았습니다. 다시 준비해 주세요.":code==="ADMIN_OPERATION_RESULT_UNKNOWN"?"결과를 확인하지 못했습니다. 같은 작업 주소에서 확정 영수증을 다시 확인해 주세요.":code==="PLACE_ADMIN_SNAPSHOT_TOO_LARGE"?"연결 자료가 한 번에 처리할 수 있는 범위를 넘습니다. 운영 담당자의 별도 검토가 필요합니다.":code==="PLACE_ADMIN_NOT_ELIGIBLE"?"현재 공개·병합 조건을 충족하지 않습니다. 대상 상태와 근거를 다시 확인해 주세요.":"변경 입력·현재 권한·미리보기 만료 여부를 확인한 뒤 다시 준비해 주세요.";
  return data({ok:false,error:message},{status:code==="ADMIN_OPERATION_RESULT_UNKNOWN"?503:code==="ADMIN_REQUIRED"?403:code==="ADMIN_OPERATION_CONFLICT"?409:400,headers:PRIVATE});
}
function operationPath(operationId: string, correctionPage?: number) {
  return correctionPage === undefined ? `/admin/place-operations?operation=${encodeURIComponent(operationId)}`
    : correctionOperationsHref(correctionPage, operationId);
}

function reviewActionError(code: string, extra?: { batchId?: string; skipped?: ReviewSkippedItem[] }) {
  const mapped = reviewErrorMessage(code);
  return data({ ok: false, error: mapped.message, code: mapped.code, ...extra }, { status: 400 });
}

function reviewCaughtError(error: unknown, extra?: { batchId?: string }) {
  const code = error instanceof NaverLocalSearchError ? error.code : error instanceof Error ? error.message : "UNKNOWN";
  return reviewActionError(code, extra);
}

function operationsActionError(code: string) {
  return data({ ok: false, error: operationsErrorMessage(code), code }, { status: code === "CORRECTION_STALE" ? 409 : 400 });
}

function operationsCaughtError(error: unknown) {
  if(error instanceof Error && error.message==="PLACE_ADMIN_PREVIEW_REQUIRED") return placeOperationFailure(error);
  return operationsActionError(error instanceof Error ? error.message : "UNKNOWN");
}

function suggestionDecisionFailure(code: string, suggestionId: string, suggestionIntent: "approve" | "transition") {
  const conflict = ["SUGGESTION_NOT_REVIEWABLE", "SUGGESTION_STALE", "SUGGESTION_UNCHANGED"].includes(code);
  return data({ ok: false, error: suggestionApprovalErrorMessage(code), code, suggestionId, suggestionIntent },
    { status: conflict ? 409 : code === "ADMIN_REQUIRED" ? 403 : 400, headers: PRIVATE });
}

function selectedWorkItems(form: FormData) {
  const versions: Record<string, number> = Object.create(null);
  const workItemIds = form.getAll("workItem").flatMap((value) => {
    const [id, version] = String(value).split("|");
    const parsedVersion = Number(version);
    if (!id || !Number.isInteger(parsedVersion) || parsedVersion < 0) return [];
    versions[id] = parsedVersion;
    return [id];
  });
  return { workItemIds, versions };
}

export async function loader({ request }: Route.LoaderArgs) {
  const {user,sessionId}=await requireAdminSession(request);
  const db = createDb(env.DB);
  const url = new URL(request.url);
  const tab = parsePlaceOperationsTab(url);
  if (["operation","place","correctionsPage"].some(key=>url.searchParams.getAll(key).length>1)) throw new Response(null,{status:400,headers:PRIVATE});
  const operationId=url.searchParams.get("operation"), placeId=url.searchParams.get("place");
  if ((operationId && !z.uuid().safeParse(operationId).success) || (placeId && (placeId.length>160 || !placeId.length))) throw new Response(null,{status:400,headers:PRIVATE});
  let operation:Awaited<ReturnType<typeof getPlaceAdminOperation>>|null=null,operationUnavailable=false;
  if(operationId) try {operation=await getPlaceAdminOperation(env.DB,{actorUserId:user.id,sessionId,now:new Date().toISOString(),operationId});} catch {operationUnavailable=true;}
  const selectedPlace=placeId?await env.DB.prepare("SELECT id,name,address,status FROM places WHERE id=?").bind(placeId).first<{id:string;name:string;address:string;status:string}>():null;
  const extra={operation,operationUnavailable,selectedPlace};
  if (tab === "liveness") {
    const liveness = await listLivenessOperations(db, url.searchParams.get("liveness"));
    return data({ tab, ...liveness, ...extra },{headers:PRIVATE});
  }
  if (tab === "duplicates") {
    return data({ tab, ...(await listDuplicateOperations(db)), ...extra },{headers:PRIVATE});
  }
  if (tab === "corrections") {
    const corrections = await listCorrectionOperations(db, parseCorrectionOperationsPage(url.searchParams.get("correctionsPage")));
    return data({ tab, corrections, ...extra },{headers:PRIVATE});
  }
  const query = parsePlaceReviewQuery(url);
  const now = new Date().toISOString();
  const placeGeocodingEnabled = env.NAVER_PLACE_GEOCODING_ENABLED === "true";
  const [page, counts, naverRegionUsage, categoryRows, suggestions] = await Promise.all([
    listPlaceReviewWorkItems(db, query),
    getPlaceReviewStageCounts(db),
    listNaverRegionDailyUsage(db, now).catch(() => null),
    db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories).where(eq(categories.isActive, true)),
    query.step === 1 ? listReviewablePlaceSuggestions(db, Number(url.searchParams.get("suggestionPage")))
      : Promise.resolve({ rows: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } }),
  ]);
  const terminalCategoryIds = getTerminalCategoryIds(categoryRows);
  const duplicateCandidates = query.step === 4
    ? await listReviewDuplicateCandidates(db, page.rows.map((row) => row.workItemId))
    : [];
  return data({
    tab, ...extra,
    query, page, counts, categories: categoryRows.filter((category) => terminalCategoryIds.has(category.id)), duplicateCandidates,
    suggestions,
    naverRegionUsage,
    naverMapsClientId: placeGeocodingEnabled ? env.NAVER_MAPS_CLIENT_ID ?? "" : "",
    placeGeocodingEnabled,
    confidentAdvanceEnabled: isConfidentAdvanceEnabled(env.REVIEW_CONFIDENT_ADVANCE_ENABLED),
  },{headers:PRIVATE});
}

export async function action({ request }: Route.ActionArgs) {
  const {user:admin,sessionId}=await requireAdminSession(request);
  if(request.method!=="POST") return new Response(null,{status:405,headers:{...PRIVATE,Allow:"POST"}});
  if (!isSameOriginMutation(request)) return data({ ok: false, error: "이 요청은 현재 서비스에서 다시 실행해 주세요." }, { status: 403, headers:PRIVATE });
  let form:FormData; try {form=await readOperationsForm(request);} catch(error) {if(error instanceof Response)return error;return placeOperationFailure(error);}
  const db = createDb(env.DB);
  const now = new Date().toISOString();
  const confidentAdvanceEnabled = isConfidentAdvanceEnabled(env.REVIEW_CONFIDENT_ADVANCE_ENABLED);
  const intent = String(form.get("intent") ?? "");
  const caller={actorUserId:admin.id,sessionId,now};
  const url = new URL(request.url);
  const correctionPage = parsePlaceOperationsTab(url) === "corrections" ? parseCorrectionOperationsPage(url.searchParams.get("correctionsPage")) : undefined;
  const prepare=async(command:PlaceAdminCommand, page = correctionPage)=>{
    const parsed=placeAdminCommandSchema.parse(command);
    const op=await preparePlaceAdminOperation(env.DB,{...caller,command:parsed});
    return redirect(operationPath(op.operationId, page),{headers:PRIVATE});
  };
  if(intent==="confirm-place-operation") {
    let operationId:string;
    try {
      operationId=z.uuid().parse(form.get("operationId"));
      await commitPlaceAdminOperation(env.DB,{...caller,operationId});
      return redirect(operationPath(operationId, correctionPage),{headers:PRIVATE});
    } catch(error) {
      if(error instanceof Error && error.message==="ADMIN_RECENT_AUTH_REQUIRED") {
        const id=form.get("operationId");
        if(typeof id==="string" && z.uuid().safeParse(id).success) return redirect(`/admin/reauth?returnTo=${encodeURIComponent(operationPath(id, correctionPage))}`,{headers:PRIVATE});
      }
      return placeOperationFailure(error);
    }
  }
  if(intent==="recall" || intent==="restore-recall") {
    try {
      return await prepare(intent==="recall"?{change:"RECALL",placeId:String(form.get("placeId")??""),reason:String(form.get("reason")??"")}:{change:"RESTORE_RECALL",recallOperationId:String(form.get("recallOperationId")??""),reason:String(form.get("reason")??"")});
    } catch(error) {return placeOperationFailure(error);}
  }

  if (intent === "approve-suggestion") {
    const suggestionId = String(form.get("suggestionId") ?? "");
    const prefix = `approval-${suggestionId}-`;
    const checked = checkSuggestionApprovalRequest({
      suggestionId,
      expectedRevision: form.get("expectedRevision"),
      address: form.get(`${prefix}address`),
      neighborhood: form.get(`${prefix}neighborhood`),
      originLatitude: form.get(`${prefix}originLatitude`),
      originLongitude: form.get(`${prefix}originLongitude`),
      latitude: form.get(`${prefix}latitude`),
      longitude: form.get(`${prefix}longitude`),
      locationConfirmed: form.get(`${prefix}locationConfirmed`),
      reason: form.get("reason"),
    });
    if (!checked.ok) return suggestionDecisionFailure(checked.code, suggestionId, "approve");
    try {
      const result = await approvePlaceSuggestion(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, suggestionIntent: "approve" as const, suggestionId: checked.value.suggestionId, placeId: result.placeId, slug: result.slug,
        message: result.replayed ? "이미 기록된 초안 승인을 확인했습니다." : "제안을 비공개 초안으로 승인했습니다." };
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      return suggestionDecisionFailure(code, suggestionId, "approve");
    }
  }
  if (intent === "transition-suggestion") {
    const suggestionId = String(form.get("suggestionId") ?? "");
    const checked = checkSuggestionTransitionRequest({
      suggestionId,
      expectedRevision: form.get("expectedRevision"),
      status: form.get("status"),
      reason: form.get("reason"),
    });
    if (!checked.ok) return suggestionDecisionFailure(checked.code, suggestionId, "transition");
    try {
      await transitionPlaceSuggestion(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, suggestionIntent: "transition" as const,
        message: checked.value.status === "REJECTED" ? "제안을 반려했습니다." : "추가 정보를 요청했습니다." };
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      return suggestionDecisionFailure(code, suggestionId, "transition");
    }
  }
  if (intent === "apply-correction") {
    const checked = checkCorrectionApplyRequest({ requestId: form.get("requestId"), reason: form.get("reason"), expectedUpdatedAt: form.get("expectedUpdatedAt") });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      await applyPlaceCorrection(db, { ...checked.value, actorUserId: admin.id, now, preservePublicationState:true });
      return { ok: true, message: "정정 내용을 적용하고 수정 이력을 남겼습니다." };
    } catch (error) {
      return operationsCaughtError(error);
    }
  }
  if (intent === "prepare-correction-recall") {
    const checked = checkCorrectionApplyRequest({ requestId: form.get("requestId"), reason: form.get("reason"), expectedUpdatedAt: form.get("expectedUpdatedAt") });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      const { requestId, expectedUpdatedAt, reason } = checked.value;
      const placeId = await env.DB.prepare("SELECT place_id FROM place_correction_requests WHERE id=?").bind(requestId).first<string>("place_id");
      if (!placeId) return operationsActionError("CORRECTION_NOT_APPLICABLE");
      return await prepare({ change: "RECALL", placeId, reason, correction: { requestId, expectedUpdatedAt } }, correctionPage ?? 1);
    } catch (error) {
      if (error instanceof Error && error.message === "CORRECTION_NOT_APPLICABLE") return operationsCaughtError(error);
      return placeOperationFailure(error);
    }
  }
  if (intent === "transition-correction") {
    const checked = checkCorrectionTransitionRequest({
      requestId: form.get("requestId"),
      status: form.get("status"),
      reason: form.get("reason"),
      expectedUpdatedAt: form.get("expectedUpdatedAt"),
    });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      await transitionPlaceCorrection(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, message: checked.value.status === "REJECTED" ? "정정 요청을 반려했습니다." : "정정 요청을 검토 중으로 바꿨습니다." };
    } catch (error) {
      return operationsCaughtError(error);
    }
  }
  if (intent === "merge") {
    const checked = checkMergeRequest({
      targetPlaceId: form.get("targetPlaceId"),
      sourcePlaceId: form.get("sourcePlaceId"),
      reason: form.get("reason"),
    });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      return await prepare({change:"MERGE",...checked.value});
    } catch(error) {return placeOperationFailure(error);}
  }
  if(intent==="restore") return data({ok:false,error:"과거 revision의 자동 복원은 지원하지 않습니다. 직전 공개 회수 영수증에서 별도 복원 미리보기를 준비해 주세요."},{status:400,headers:PRIVATE});

  if (intent === "resolve-liveness") {
    const checked = checkLivenessResolveRequest({
      caseId: form.get("caseId"),
      resolution: form.get("resolution"),
      reason: form.get("reason"),
    });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      await resolvePlaceLivenessCase(db, { ...checked.value, actorUserId: admin.id, now, preservePublicationState:true });
      return { ok: true, message: "영업 상태 검수를 반영했습니다. 공개 상태는 유지되며 재공개는 장소 미리보기에서 진행합니다." };
    } catch (error) {
      return operationsCaughtError(error);
    }
  }
  if (intent === "clear-recommendation-exclusions") {
    const checked = checkClearExclusionsRequest({ reason: form.get("reason") });
    if (!checked.ok) return operationsActionError(checked.code);
    try {
      const result = await clearRecommendationExclusions(db, { ...checked.value, actorUserId: admin.id, now });
      return { ok: true, message: `자동 추천 제외 ${result.updated}건을 해제했습니다.` };
    } catch (error) {
      return operationsCaughtError(error);
    }
  }
  const batchId = String(form.get("batchId") ?? "");
  const { workItemIds, versions } = selectedWorkItems(form);
  if(intent==="publish-review-items" && (workItemIds.length!==1 || form.getAll("workItem").length!==1)) return data({ok:false,error:"공개 영향은 한 번에 1곳씩 확인합니다. 대상 1곳만 선택해 주세요."},{status:400,headers:PRIVATE});
	  const automaticWorkItemIds = [
		...new Set(
			form
				.getAll("autoWorkItem")
				.map((value) => String(value))
				.filter((value): value is string => value.length > 0),
		),
	];
  const expectedStage = String(form.get("expectedStage") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const confirmPublish = String(form.get("confirmPublish") ?? "");
  const confirmLocalDining = String(form.get("confirmLocalDining") ?? "");
  const categoryByWorkItem = Object.fromEntries(workItemIds.map((workItemId) => [workItemId, String(form.get(`category:${workItemId}`) ?? "")]));
  const addressByWorkItem = Object.fromEntries(workItemIds.map((workItemId) => [workItemId, String(form.get(`address:${workItemId}`) ?? "")]));
  const checked = checkReviewRequest({
    intent, expectedStage, workItemIds, automaticWorkItemIds, reason, confirmPublish, confirmLocalDining, categoryByWorkItem, addressByWorkItem,
  });
  if (!checked.ok) return reviewActionError(checked.code, batchId ? { batchId } : undefined);

  if (intent === "auto-exclude-non-food-review-items") {
    try {
      const result = await autoExcludeNonFoodReviewItems(db, { workItemIds: automaticWorkItemIds, actorUserId: admin.id, now });
      return { ok: true, message: `로컬 방문 식당 정책 제외 ${result.changed.length}곳 · 추가 검토 ${result.skipped.length}곳`, skipped: result.skipped };
    } catch (error) {
      return reviewCaughtError(error);
    }
  }

  if (intent === "verify-review-items-with-naver") {
    try {
      assertNaverLocalSearchEnabled(env);
      const result = await verifyReviewItemsWithNaver(db, { workItemIds, actorUserId: admin.id, now, adapter: createNaverLocalSearchAdapter(env, { database: env.DB }), confidentAdvanceEnabled });
      const deferred = result.deferred ? ` · 다음 실행 ${result.deferred}곳` : "";
      return { ok: true, message: `선택 ${workItemIds.length}곳 중 확인 ${result.scanned} · 통과 ${result.passed} · 확인 필요 ${result.attention} · 실패 ${result.failed}${deferred}`, skipped: result.skipped, processedWorkItemIds: result.processedWorkItemIds, nextStep: 3 as const };
    } catch (error) {
      return reviewCaughtError(error);
    }
  }
  if (intent === "auto-verify-review-item-with-naver") {
    const workItemId = workItemIds[0]!;
    try {
      if (expectedStage === "SOURCE_REVIEW") {
        const advanced = await advancePlaceReviewWorkItems(db, {
          workItemIds: [workItemId], expectedStage: "SOURCE_REVIEW", expectedVersions: versions, actorUserId: admin.id, now, confidentAdvanceEnabled,
        });
        if (!advanced.advanced.length) return reviewActionError(advanced.skipped[0]?.code ?? "UNKNOWN", { batchId, skipped: advanced.skipped });
      }
      assertNaverLocalSearchEnabled(env);
      const result = await verifyReviewItemsWithNaver(db, {
        workItemIds: [workItemId], actorUserId: admin.id, now, adapter: createNaverLocalSearchAdapter(env, { database: env.DB }), confidentAdvanceEnabled,
      });
      return { ok: true, batchId, skipped: result.skipped, processedWorkItemIds: result.processedWorkItemIds, passed: result.passed, attention: result.attention, failed: result.failed, message: `NAVER 확인 ${result.scanned} · 통과 ${result.passed} · 확인 필요 ${result.attention} · 실패 ${result.failed}` };
    } catch (error) {
      return reviewCaughtError(error, { batchId });
    }
  }
  try {
    if (intent === "advance-confident-review-items") {
      const result = await advanceConfidentReviewWorkItems(db, {
        workItemIds, expectedStage: checked.expectedStage, expectedVersions: versions, actorUserId: admin.id, now, confidentAdvanceEnabled,
      });
      return {
        ok: true,
        message: confidentAdvanceEnabled
          ? `근거 있는 항목 이동 ${result.advanced.length}곳 · 건너뜀 ${result.skipped.length}곳 · 공개 0곳`
          : "조건부 이동이 꺼져 있습니다. 이동 0곳 · 공개 0곳",
        skipped: result.skipped,
      };
    }
    if (intent === "sweep-confident-review-stage") {
      const sweepLimit = Math.min(Math.max(1, Number.parseInt(String(form.get("sweepLimit") ?? "100"), 10) || 100), 100);
      const sweepDryRun = String(form.get("sweepDryRun") ?? "") === "on";
      const result = await sweepConfidentReviewStage(db, {
        stage: checked.expectedStage, limit: sweepLimit, dryRun: sweepDryRun, actorUserId: admin.id, now, confidentAdvanceEnabled,
      });
      return {
        ok: true,
        message: sweepDryRun
          ? `시험 평가 ${result.scanned}곳 중 이동 가능 ${result.ready}곳 · 건너뜀 ${result.skipped.length}곳 · 실제 이동 0곳 · 공개 0곳`
          : `단계 일괄 진행 ${result.advanced.length}곳 · 건너뜀 ${result.skipped.length}곳 · 공개 0곳 (최대 ${sweepLimit}곳)`,
        skipped: result.skipped,
      };
    }
    if (intent === "confirm-local-dining") {
      const result = await confirmLocalDiningReview(db, { workItemIds, expectedVersions: versions, actorUserId: admin.id, reason, confirmed: confirmLocalDining === "on", now });
      return { ok: true, message: `로컬·방문 식사 근거 ${result.confirmed.length}곳 저장. 단계 이동과 공개는 별도입니다.` };
    }
    if (intent === "confirm-review-categories") {
      const selections = workItemIds.map((workItemId) => ({ workItemId, categoryId: String(form.get(`category:${workItemId}`) ?? ""), reason: String(form.get("reason") ?? "") }));
      const result = await confirmReviewItemCategories(db, { selections, actorUserId: admin.id, now, confidentAdvanceEnabled });
      return { ok: true, message: `카테고리 확정 ${result.confirmed.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "resolve-review-duplicates") {
      const resolutions = form.getAll("duplicateCandidate").map(String).flatMap((value) => {
        const [workItemId, candidatePlaceId] = value.split("|");
        const decision = String(form.get(`duplicateDecision:${value}`) ?? "");
        const duplicateReason = String(form.get(`duplicateReason:${value}`) ?? "");
        return workItemId && candidatePlaceId && ["LINK_EXISTING", "MERGE", "DISTINCT"].includes(decision)
          ? [{ workItemId, candidatePlaceId, decision: decision as "LINK_EXISTING" | "MERGE" | "DISTINCT", reason: duplicateReason }]
          : [];
      });
      const result = await resolveReviewDuplicates(db, { resolutions, actorUserId: admin.id, now });
      return { ok: true, message: `중복 판정 ${result.accepted.length}건 저장 · 건너뜀 ${result.skipped.length}건`, skipped: result.skipped };
    }
    if (intent === "publish-review-items") {
      return await prepare({change:"PUBLISH",workItemId:workItemIds[0]!,expectedVersion:versions[workItemIds[0]!],reason});
    }
    if (intent === "advance-review-items") {
      const result = await advancePlaceReviewWorkItems(db, { workItemIds, expectedStage: checked.expectedStage, expectedVersions: versions, actorUserId: admin.id, now, confidentAdvanceEnabled });
      if (!result.advanced.length) return reviewActionError(result.skipped[0]?.code ?? "UNKNOWN", { skipped: result.skipped });
      return { ok: true, message: `다음 단계 이동 ${result.advanced.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "approve-manual-review-evidence") {
      const result = await advancePlaceReviewWorkItems(db, {
        workItemIds, expectedStage: checked.expectedStage, expectedVersions: versions, actorUserId: admin.id, now, manualEvidenceReason: reason, confidentAdvanceEnabled,
      });
      if (!result.advanced.length) return reviewActionError(result.skipped[0]?.code ?? "UNKNOWN", { skipped: result.skipped });
      return { ok: true, message: `수동 근거로 이동 ${result.advanced.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "update-review-item-addresses") {
      const result = await updateReviewItemAddresses(db, { workItemIds, addressByWorkItem, actorUserId: admin.id, now });
      if (!result.changed.length) return reviewActionError(result.skipped[0]?.code ?? "UNKNOWN", { skipped: result.skipped });
      return { ok: true, message: `주소 저장 ${result.changed.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "geocode-missing-coords") {
      const apiKey = env.KAKAO_REST_API_KEY?.trim() ?? "";
      if (!apiKey) return reviewActionError("KAKAO_REST_API_KEY_REQUIRED");
      const result = await geocodeMissingReviewCoords(db, { limit: 50, actorUserId: admin.id, now, apiKey });
      return { ok: true, message: `좌표 복구 ${result.geocoded.length}곳 · 스캔 ${result.scanned}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "apply-category-fallback") {
      const result = await applyCategoryFallback(db, { limit: 200, actorUserId: admin.id, now });
      return { ok: true, message: `카테고리 폴백 ${result.changed.length}곳 · 스캔 ${result.scanned}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    if (intent === "hold-review-items" || intent === "exclude-review-items") {
      const result = intent === "hold-review-items"
        ? await holdPlaceReviewItems(db, { workItemIds, actorUserId: admin.id, code: "ADMIN_REVIEW_HOLD", note: reason, now })
        : await excludePlaceReviewItems(db, { workItemIds, actorUserId: admin.id, code: "ADMIN_REVIEW_EXCLUDE", note: reason, now });
      return { ok: true, message: `${intent === "hold-review-items" ? "보류" : "제외"} ${result.changed.length}곳 · 건너뜀 ${result.skipped.length}곳`, skipped: result.skipped };
    }
    return reviewActionError("INVALID_INTENT");
  } catch (error) {
    return intent === "publish-review-items" ? placeOperationFailure(error) : reviewCaughtError(error);
  }
}

export function meta() { return [{ title: "장소 검수 — Re:Taste Admin" }]; }

const operationTabs: Array<{ id: PlaceOperationsTab; label: string }> = [
  { id: "review", label: "장소 검수" },
  { id: "liveness", label: "영업 재검증" },
  { id: "corrections", label: "정보 정정" },
  { id: "duplicates", label: "중복·이력" },
];

export default function AdminPlaceOperations({ loaderData, actionData }: Route.ComponentProps) {
  const message = actionData && "message" in actionData ? actionData.message : undefined;
  const error = actionData && "error" in actionData ? actionData.error : undefined;
  const suggestionErrorId = error && actionData && "suggestionId" in actionData && typeof actionData.suggestionId === "string"
    ? actionData.suggestionId : undefined;
  const suggestionIntent = actionData && "suggestionIntent" in actionData ? actionData.suggestionIntent : undefined;
  const suggestionApprovalNotice = loaderData.tab === "review" && loaderData.query.step === 1 && suggestionIntent === "approve"
    ? message : undefined;
  const skipped = actionData && "skipped" in actionData ? actionData.skipped : [];
  const nextStep = actionData && "nextStep" in actionData && actionData.nextStep === 3 ? 3 : undefined;
  const processedWorkItemIds = actionData && "processedWorkItemIds" in actionData && Array.isArray(actionData.processedWorkItemIds)
    ? actionData.processedWorkItemIds
    : [];
  const correctionPage = loaderData.tab === "corrections" ? loaderData.corrections.pagination.page : undefined;
  return <main id="main" className="place-ops shell place-review-shell">
    <header className="place-ops-head">
      <div><p className="eyebrow">ADMIN / PLACE REVIEW</p><h1>장소 검수</h1><p>원천부터 NAVER 근거, 카테고리, 중복 검토를 순서대로 확인한 뒤 선택 공개합니다. 영업 재검증·정정·병합은 옆 탭에서 처리합니다.</p></div>
      <nav><Link to="/admin/data-sync">공공데이터 수집</Link><Link to="/admin/ratings">평가 운영</Link></nav>
    </header>
    {message && !suggestionApprovalNotice && <p className="admin-notice" role="status">{message}</p>}
    <PlaceOperationPreview view={loaderData.operation??undefined} correctionPage={correctionPage} />
    {loaderData.operationUnavailable && <p className="operation-error" role="alert">미리보기 또는 영수증을 확인할 수 없습니다. 대상과 현재 권한을 확인해 주세요.</p>}
    <details className="place-ops-section"><summary>기존 공개 회수 복원 검토</summary><p>원래 공개 회수 작업 번호를 입력해 새 미리보기를 준비합니다. 현재 관리자 재인증과 회수 뒤 변경 여부를 다시 확인하며, 병합 전체를 되돌리지 않습니다.</p><Form method="post" className="ops-form"><input type="hidden" name="intent" value="restore-recall"/><label>원 공개 회수 작업 번호<input name="recallOperationId" required maxLength={36}/></label><label>공개 회수 복원 사유<input name="reason" required maxLength={300}/></label><button>기존 회수 복원 미리보기</button></Form></details>

    {loaderData.selectedPlace && <section className="place-ops-section" aria-label="선택한 장소 공개 관리"><h2>{loaderData.selectedPlace.name}</h2><p>{loaderData.selectedPlace.address}</p><p>현재 {loaderData.selectedPlace.status} · <code>{loaderData.selectedPlace.id}</code></p>{loaderData.selectedPlace.status==="PUBLISHED"?<Form method="post" className="ops-form"><input type="hidden" name="intent" value="recall"/><input type="hidden" name="placeId" value={loaderData.selectedPlace.id}/><label>공개 회수 사유<input name="reason" required maxLength={300}/></label><button>공개 회수 미리보기</button></Form>:<p>공개 중인 장소만 회수할 수 있습니다. 공개는 최종 검수 1곳을 선택해 준비합니다.</p>}</section>}

    {error && loaderData.tab !== "review" && <p className="operation-error" role="alert">{error}</p>}
    <nav className="place-ops-tabs" aria-label="장소 운영 작업" role="tablist">
      {operationTabs.map((tab) => (
        <Link key={tab.id} role="tab" aria-selected={loaderData.tab === tab.id} aria-controls={`place-ops-panel-${tab.id}`} to={placeOperationsTabHref(tab.id)}>
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
    <div id={`place-ops-panel-${loaderData.tab}`} className="place-ops-tab-panel" role="tabpanel">
      {loaderData.tab === "review" && <>
        {loaderData.query.step === 1 && <section className="place-ops-section" aria-labelledby="suggestion-review-heading">
          <h2 id="suggestion-review-heading">회원 장소 제안</h2>
          <p>제출·보완 요청·검토 중인 제안을 지도에서 확인한 뒤 초안으로 승인하면 아래 1단계 검수 큐에 들어갑니다.</p>
          {suggestionApprovalNotice && <p className="admin-notice" role="status">{suggestionApprovalNotice}</p>}
          {suggestionErrorId !== undefined && !loaderData.suggestions.rows.some((row) => row.id === suggestionErrorId) &&
            <p className="operation-error" role="alert">{error}</p>}
          <PlaceSuggestionPagination query={loaderData.query} pagination={loaderData.suggestions.pagination} />
          {loaderData.suggestions.rows.map((item) => (
            <PlaceSuggestionReviewCard
              key={`${item.id}:${item.decisionRevision}`}
              item={item}
              approvalError={item.id === suggestionErrorId && suggestionIntent === "approve" ? error : undefined}
              transitionError={item.id === suggestionErrorId && suggestionIntent === "transition" ? error : undefined}
              clientId={loaderData.naverMapsClientId}
              geocodingAvailable={loaderData.placeGeocodingEnabled && Boolean(loaderData.naverMapsClientId)}
            />
          ))}
          {!loaderData.suggestions.rows.length && <p>검토할 제안이 없습니다.</p>}
        </section>}
        <PlaceReviewPipeline query={loaderData.query} page={loaderData.page} counts={loaderData.counts} categories={loaderData.categories} duplicateCandidates={loaderData.duplicateCandidates} naverRegionUsage={loaderData.naverRegionUsage} message={suggestionApprovalNotice ? undefined : message} error={loaderData.query.step === 1 && suggestionErrorId !== undefined ? undefined : error} skipped={skipped} suggestionPage={loaderData.suggestions.pagination.page} nextStep={nextStep} processedWorkItemIds={processedWorkItemIds} confidentAdvanceEnabled={loaderData.confidentAdvanceEnabled} />
      </>}
      {loaderData.tab === "liveness" && <PlaceLivenessPanel livenessFilter={loaderData.livenessFilter} livenessRows={loaderData.livenessRows} />}
      {loaderData.tab === "corrections" && <PlaceCorrectionPanel {...loaderData.corrections} />}
      {loaderData.tab === "duplicates" && <PlaceMergePanel places={loaderData.places} safeSameNameMergeGroups={loaderData.safeSameNameMergeGroups} revisions={loaderData.revisions} />}
    </div>
  </main>;
}

export function ErrorBoundary({error}:Route.ErrorBoundaryProps) {
  const status=isRouteErrorResponse(error)?error.status:503;
  return <main id="main" className="admin-page"><h1 className="text-[25.2px] md:text-[33.6px]">{status===403?"관리자만 조회할 수 있습니다.":"장소 관리를 열 수 없습니다."}</h1><p>현재 권한과 요청을 확인한 뒤 다시 조회해 주세요.</p><Link to="/admin/place-operations">장소 관리 다시 열기</Link></main>;
}
