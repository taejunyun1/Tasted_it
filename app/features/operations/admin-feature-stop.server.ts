import { z } from "zod";
import { commitAdminOperation, getVerifiedAdminOperation, prepareAdminOperation } from "./admin-operation.server";

export const AUTO_REVIEW_SETTING = "REVIEW_AUTO_PIPELINE_ENABLED" as const;
type Operator = {actorUserId:string;sessionId:string;now:string};
const storedSchema=z.object({stopped:z.union([z.literal(0),z.literal(1)]),version:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1),updated_at:z.iso.datetime()});
const payloadSchema=z.object({key:z.literal(AUTO_REVIEW_SETTING),stopped:z.boolean(),previousStopped:z.boolean(),version:z.number().int().nonnegative(),baseline:z.boolean(),reason:z.string().trim().min(1).max(300)});
const resultSchema=z.object({key:z.literal(AUTO_REVIEW_SETTING),stopped:z.boolean(),version:z.number().int().nonnegative(),reason:z.string(),effective:z.boolean()});

async function storedStop(database:D1Database){
 try{return storedSchema.parse(await database.prepare("SELECT stopped,version,updated_at FROM admin_feature_stops WHERE key=?").bind(AUTO_REVIEW_SETTING).first());}
 catch{return null;}
}
export async function readAutoReviewControl(database:D1Database,configured:unknown){
 const baseline=configured==="true",row=await storedStop(database);
 return {key:AUTO_REVIEW_SETTING,baseline,available:Boolean(row),stopped:row?row.stopped===1:null,
  version:row?.version??null,updatedAt:row?.updated_at??null,effective:baseline&&Boolean(row&&row.stopped===0),
  canStop:Boolean(row&&row.stopped===0),canRestore:Boolean(row&&row.stopped===1&&baseline)};
}
/** Only the post-sync automatic review entry is gated. Existing work is not cancelled. */
export async function isAutoReviewEnabled(database:D1Database,configured:unknown){
 if(configured!=="true")return false;
 const row=await storedStop(database);return Boolean(row&&row.stopped===0);
}
export async function prepareFeatureFlagChange(database:D1Database,input:Operator&{stopped:boolean;reason:string},configured:unknown){
 const current=await readAutoReviewControl(database,configured);
 if(!current.available||current.version===null||current.stopped===null)throw new Error("FEATURE_STOP_UNAVAILABLE");
 if(!input.stopped&&!current.baseline)throw new Error("FEATURE_BASELINE_DISABLED");
 if(input.stopped===current.stopped)throw new Error("FEATURE_STOP_UNCHANGED");
 const payload=payloadSchema.parse({key:AUTO_REVIEW_SETTING,stopped:input.stopped,previousStopped:current.stopped,version:current.version,baseline:current.baseline,reason:input.reason});
 return prepareAdminOperation(database,{...input,kind:"FEATURE_FLAG_CONTROL",payload,
  summary:{title:input.stopped?"동기화 후 자동 검수 시작 중단":"동기화 후 자동 검수 중단 해제",count:1}});
}
export async function readFeatureFlagOperation(database:D1Database,input:Operator&{operationId:string}){
 const operation=await getVerifiedAdminOperation(database,{...input,kind:"FEATURE_FLAG_CONTROL"});
 return {operationId:operation.id,status:operation.status,expiresAt:operation.expiresAt,
  ...(operation.status==="PENDING"?payloadSchema.parse(operation.payload):resultSchema.parse(operation.result))};
}
export async function commitFeatureFlagChange(database:D1Database,input:Operator&{operationId:string},configured:unknown){
 const receipt=await commitAdminOperation(database,{...input,kind:"FEATURE_FLAG_CONTROL"},operation=>{
  const payload=payloadSchema.parse(operation.payload),baseline=configured==="true";
  if(baseline!==payload.baseline)throw new Error("FEATURE_BASELINE_CHANGED");
  if(!payload.stopped&&!baseline)throw new Error("FEATURE_BASELINE_DISABLED");
  return {checks:[database.prepare(`INSERT INTO admin_operation_checks(operation_id,check_name,passed)
    SELECT ?,'feature_stop_version',CASE WHEN EXISTS(SELECT 1 FROM admin_feature_stops WHERE key=? AND version=? AND stopped=?) THEN 1 ELSE 0 END`)
    .bind(operation.id,AUTO_REVIEW_SETTING,payload.version,payload.previousStopped?1:0)],
   statements:[database.prepare("UPDATE admin_feature_stops SET stopped=?,version=version+1,updated_at=?,updated_by=? WHERE key=?")
    .bind(payload.stopped?1:0,input.now,input.actorUserId,AUTO_REVIEW_SETTING)],
   result:{key:AUTO_REVIEW_SETTING,stopped:payload.stopped,version:payload.version+1,reason:payload.reason,effective:baseline&&!payload.stopped}};
 });
 await getVerifiedAdminOperation(database,{...input,kind:"FEATURE_FLAG_CONTROL"});
 return {...receipt,current:await readAutoReviewControl(database,configured)};
}
