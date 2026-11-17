import { env } from "cloudflare:workers";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/admin-settings";
import { readSessionId, requireAdmin } from "../features/auth/session.server";
import { readAdminSettings } from "../features/operations/admin-settings.server";
import { AUTO_REVIEW_SETTING,commitFeatureFlagChange,prepareFeatureFlagChange,readAutoReviewControl,readFeatureFlagOperation } from "../features/operations/admin-feature-stop.server";
import { isSameOriginMutation } from "../features/http/same-origin";

const PRIVATE = {"Cache-Control":"private, no-store",Vary:"Cookie","X-Robots-Tag":"noindex, nofollow"};
export const headers=()=>PRIVATE;
export const meta=()=>[{title:"설정 상태 — Re:Taste Admin"}];
async function authorize(request:Request){
  try{return await requireAdmin(request);}
  catch(error){if(error instanceof Response){const headers=new Headers(error.headers);Object.entries(PRIVATE).forEach(([key,value])=>headers.set(key,value));throw new Response(error.body,{status:error.status,headers});}throw new Response(null,{status:503,headers:PRIVATE});}
}
export async function loader({request}:Route.LoaderArgs){
 const admin=await authorize(request),now=new Date().toISOString(),operationId=new URL(request.url).searchParams.get("operation"),sessionId=readSessionId(request);
 const control=await readAutoReviewControl(env.DB,env.REVIEW_AUTO_PIPELINE_ENABLED);
 let preview:Awaited<ReturnType<typeof readFeatureFlagOperation>>|null=null,error:string|null=null;
 if(operationId&&sessionId){try{preview=await readFeatureFlagOperation(env.DB,{actorUserId:admin.id,sessionId,now,operationId});}catch{error="확인 요청을 다시 읽을 수 없습니다. 현재 상태에서 새로 검토해 주세요.";}}
 const observed=readAdminSettings(env,now);
 return data({...observed,settings:observed.settings.map(item=>item.key===AUTO_REVIEW_SETTING?{...item,effect:control.available?(control.effective?"ENABLED":"DISABLED"):"UNAVAILABLE"}:item),control,preview,error},{headers:PRIVATE});
}
function failureMessage(error:unknown){
 const code=error instanceof Error?error.message:"";
 const messages:Record<string,string>={FEATURE_STOP_UNAVAILABLE:"중단 상태를 읽을 수 없습니다. 자동 검수는 실행하지 않습니다.",FEATURE_BASELINE_DISABLED:"현재 환경에서 꺼진 기능을 이 화면에서 활성화할 수 없습니다.",FEATURE_BASELINE_CHANGED:"환경 기준값이 변경되었습니다. 현재 상태에서 다시 검토해 주세요.",FEATURE_STOP_UNCHANGED:"이미 요청한 상태입니다.",ADMIN_OPERATION_CONFLICT:"검토 후 중단 상태가 변경되었습니다. 다시 검토해 주세요.",ADMIN_OPERATION_EXPIRED:"미리보기 시간이 지났습니다. 다시 검토해 주세요.",ADMIN_OPERATION_RESULT_UNKNOWN:"반영 결과를 확인하지 못했습니다. 같은 요청 결과를 다시 확인해 주세요."};
 return messages[code]??"처리 사유와 현재 권한을 확인해 주세요.";
}
export async function action({request}:Route.ActionArgs){
 const admin=await authorize(request);
 if(!isSameOriginMutation(request))return new Response("Forbidden",{status:403,headers:PRIVATE});
 const sessionId=readSessionId(request);if(!sessionId)throw new Response(null,{status:401,headers:PRIVATE});
 if(request.headers.get("content-type")?.split(";")[0]?.trim()!=="application/x-www-form-urlencoded")return data({preview:null,result:null,error:"지원하지 않는 요청 형식입니다.",retry:null},{status:400,headers:PRIVATE});
 const form=await request.formData(),intent=String(form.get("intent")??""),operationId=String(form.get("operationId")??"");
 const allowed=intent==="commit"?["intent","operationId"]:["intent","reason"];
 if([...form.keys()].some(key=>!allowed.includes(key)||form.getAll(key).length!==1))return data({preview:null,result:null,error:"지원하지 않는 설정 입력입니다.",retry:null},{status:400,headers:PRIVATE});
 const operator={actorUserId:admin.id,sessionId,now:new Date().toISOString()};
 try{
  if(intent==="commit")return data({preview:null,result:await commitFeatureFlagChange(env.DB,{...operator,operationId},env.REVIEW_AUTO_PIPELINE_ENABLED),error:null,retry:null},{headers:PRIVATE});
  if(intent!=="preview-stop"&&intent!=="preview-restore")return data({preview:null,result:null,error:"지원하지 않는 설정 작업입니다.",retry:null},{status:400,headers:PRIVATE});
  const prepared=await prepareFeatureFlagChange(env.DB,{...operator,stopped:intent==="preview-stop",reason:String(form.get("reason")??"")},env.REVIEW_AUTO_PIPELINE_ENABLED);
  return data({preview:await readFeatureFlagOperation(env.DB,{...operator,operationId:prepared.operationId}),result:null,error:null,retry:null},{headers:PRIVATE});
 }catch(error){
  if(error instanceof Error&&error.message==="ADMIN_RECENT_AUTH_REQUIRED")throw redirect(`/admin/reauth?returnTo=${encodeURIComponent(`/admin/settings?operation=${operationId}`)}`);
  return data({preview:null,result:null,error:failureMessage(error),retry:intent==="commit"?operationId:null},{status:400,headers:PRIVATE});
 }
}
const valueLabels:Record<string,string>={TRUE:"true",FALSE:"false",MISSING:"미설정",INVALID:"알 수 없는 값",OBSERVE:"OBSERVE",RECOMMEND:"RECOMMEND",HIDE:"HIDE"};
const statusLabels:Record<string,string>={MATCH:"기본값 일치",DIFFERENT:"기본값과 다름",MISSING:"주입값 없음",INVALID:"값 확인 필요",UNUSED:"소비 경로 없음"};
function effectLabel(item:{kind:string;effect:string}){
  if(item.effect==="UNUSED")return "사용되지 않음";
  if(item.effect==="UNAVAILABLE")return "조회 실패 — 실행 차단";
  if(item.kind==="fence")return item.effect==="ENABLED"?"점검 차단 적용":"점검 차단 없음";
  if(item.kind==="mode")return item.effect;
  return item.effect==="ENABLED"?"플래그 허용":"플래그 꺼짐";
}
export default function AdminSettings({loaderData,actionData}:Route.ComponentProps){
 const preview=actionData?.preview??loaderData.preview,busy=useNavigation().state!=="idle";
 const control=actionData?.result?.current??loaderData.control;
 return <main id="main" className="admin-rating-shell"><header><p className="eyebrow">ADMIN / SETTINGS</p><h1>설정 상태</h1>
  <p>현재 요청에서 받은 설정을 저장소 기본값과 비교합니다. 동기화 후 자동 검수의 다음 실행만 제한 중단하거나 중단을 해제할 수 있습니다.</p><Link to="/admin">관리자 홈</Link></header>
  <section className="admin-rating-section"><h2>관측 기준</h2><dl>
   <div><dt>관측 시각</dt><dd>{loaderData.observedAt}</dd></div><div><dt>기대값 출처</dt><dd>{loaderData.expectedSource}</dd></div>
   <div><dt>현재값 출처</dt><dd>{loaderData.observedSource}</dd></div><div><dt>설정 주입 경로·배포 버전</dt><dd>{loaderData.injectionSource} · {loaderData.deploymentVersion}</dd></div>
  </dl><p>켜진 플래그도 필요한 자격정보·예산·입력·실행 조건을 모두 증명하지는 않습니다. 실제 작업 결과는 해당 작업 화면에서 확인합니다.</p></section>
  <section className="admin-rating-section"><h2>동기화 후 자동 검수 제어</h2>
   <p>공공 수집과 별도 NAVER 검증은 계속됩니다. 이미 시작했거나 실행 확인을 마친 자동 검수는 취소하지 않습니다. 중단 해제는 현재 환경 기준값으로 돌아가며 꺼진 환경값을 켜지 않습니다.</p>
   <dl><div><dt>환경 기준값</dt><dd>{control.baseline?"허용":"꺼짐"}</dd></div><div><dt>저장된 중단</dt><dd>{control.available?(control.stopped?"중단":"중단 없음"):"조회 실패"}</dd></div><div><dt>다음 진입 검사</dt><dd>{control.effective?"허용":"실행 차단"}</dd></div><div><dt>상태 버전</dt><dd>{control.version??"미확인"}</dd></div></dl>
   {(actionData?.error||loaderData.error)&&<p role="alert">{actionData?.error||loaderData.error}</p>}
   {actionData?.retry&&<Link to={`/admin/settings?operation=${encodeURIComponent(actionData.retry)}`}>같은 요청 결과 다시 확인</Link>}
   {actionData?.result&&<p role="status">요청 {actionData.result.replayed?"재확인":"반영"} · 현재 자동 검수 {control.effective?"허용":"차단"}</p>}
   <Form method="post"><label>처리 사유<input name="reason" maxLength={300} required/></label>
    <button name="intent" value="preview-stop" disabled={busy||!control.canStop}>중단 미리보기</button>
    <button name="intent" value="preview-restore" disabled={busy||!control.canRestore}>중단 해제 미리보기</button></Form>
   {preview&&<section aria-label="자동 검수 변경 확인"><h3>자동 검수 변경 확인</h3><p>{preview.stopped?"다음 자동 검수 시작 중단":"중단 해제 — 환경 기준값 사용"} · 검토 버전 {preview.version}</p><p>사유: {preview.reason}</p>
    {preview.status==="PENDING"?<Form method="post"><input type="hidden" name="intent" value="commit"/><input type="hidden" name="operationId" value={preview.operationId}/><button disabled={busy}>확인 후 반영</button></Form>:<p>이미 처리된 요청입니다. 현재 상태를 확인해 주세요.</p>}
    <Link to="/admin/settings">확인 닫기</Link></section>}
  </section>
  <section className="admin-rating-section"><h2>허용된 설정 목록</h2>{loaderData.settings.map(item=><article className="integrity-case" key={item.key}>
   <div style={{minWidth:0,width:"100%"}}><h3>{item.label}</h3><code style={{overflowWrap:"anywhere"}}>{item.key}</code><p>{item.consumer}</p>
    <dl><div><dt>저장소 기본값</dt><dd>{item.expected??"미지정"}</dd></div><div><dt>현재 받은 값</dt><dd>{valueLabels[item.received]??"미확인"}</dd></div><div><dt>서버 해석</dt><dd>{effectLabel(item)}</dd></div><div><dt>대조 상태</dt><dd>{statusLabels[item.status]}</dd></div></dl>
   </div></article>)}</section>

 </main>;
}
export function ErrorBoundary(){return <main id="main" className="admin-rating-shell"><h1>설정 상태를 읽을 수 없습니다.</h1><p>관리자 계정과 연결 상태를 확인해 주세요.</p><Link to="/admin">관리자 홈</Link></main>;}
