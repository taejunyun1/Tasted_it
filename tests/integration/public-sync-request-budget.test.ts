import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { syncPublicDataBatch } from "../../app/features/candidates/sync.server";

beforeEach(async () => { await env.DB.prepare("DELETE FROM public_data_sync_runs").run(); });

function countedBinding(database: D1Database) {
  const original = new WeakMap<object,D1PreparedStatement>();
  const calls = { individual: 0, batch: 0 };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...args: unknown[]) => wrap(target.bind(...args));
      if (["all","first","run","raw"].includes(String(key))) return (...args: unknown[]) => {
        calls.individual += 1;
        return (Reflect.get(target,key) as (...values:unknown[])=>unknown).apply(target,args);
      };
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    }});
    original.set(proxy,statement);return proxy;
  };
  const binding = new Proxy(database,{get(target,key){
    if(key==="prepare") return (query:string)=>wrap(target.prepare(query));
    if(key==="batch") return (statements:D1PreparedStatement[])=>{calls.batch+=1;return target.batch(statements.map(s=>original.get(s)??s));};
    const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
  }});
  return {binding,calls};
}

it.each([false,true])("keeps a full five-page %s linked-closure run within the D1 request budget",async(closed)=>{
  const prefix=crypto.randomUUID(),now=new Date().toISOString();
  if(closed){
    for(let offset=0;offset<500;offset+=50){
      const statements:D1PreparedStatement[]=[];
      for(let n=offset;n<offset+50;n++){
        const id=`${prefix}-${n}`,placeId=`place-${id}`;
        statements.push(env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED','광주','동구',35.1,126.9,?,?,?)").bind(placeId,placeId,"합성 영업점",id,now,now));
        statements.push(env.DB.prepare("INSERT INTO business_licenses(id,source_type,source_management_no,business_name,normalized_status,region_code,raw_payload,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,'GENERAL_RESTAURANT',?,'합성 영업점','OPEN','GWANGJU','{}',?,?,?,?)").bind(id,id,now,now,now,now));
        statements.push(env.DB.prepare("INSERT INTO place_source_links(id,place_id,business_license_id,is_primary,created_at) VALUES(?,?,?,1,?)").bind(`link-${id}`,placeId,id,now));
      }
      await env.DB.batch(statements);
    }
  }
  const {binding,calls}=countedBinding(env.DB);
  const result=await syncPublicDataBatch(createDb(binding),{serviceKey:"test",sourceType:"GENERAL_RESTAURANT",addressField:"ROAD_NM_ADDR",maxPages:5,fetcher:async input=>{
    const page=Number(new URL(String(input)).searchParams.get("pageNo"));
    return Response.json({response:{header:{resultCode:"0"},body:{totalCount:500,items:{item:Array.from({length:100},(_,i)=>({
      MNG_NO:`${prefix}-${(page-1)*100+i}`,BPLC_NM:"합성 식당",ROAD_NM_ADDR:"전남광주통합특별시 동구 테스트로 1",
      SALS_STTS_CD:closed?"03":"01",SALS_STTS_NM:closed?"폐업":"영업/정상",DTL_SALS_STTS_CD:closed?"02":"01",DTL_SALS_STTS_NM:closed?"폐업":"영업",
    }))}}}});
  }});
  expect(result.run).toMatchObject({status:"COMPLETED",fetchedCount:500,insertedCount:closed?0:500,updatedCount:closed?500:0});
  expect((await env.DB.prepare("SELECT count(*) n FROM business_licenses WHERE source_management_no LIKE ?").bind(`${prefix}%`).first<{n:number}>())?.n).toBe(500);
  if(closed) expect((await env.DB.prepare("SELECT count(*) n FROM places WHERE id LIKE ? AND status='HIDDEN'").bind(`place-${prefix}%`).first<{n:number}>())?.n).toBe(500);
  console.log(JSON.stringify({publicSyncBudgetCase:closed?"CLOSED_LINKED_500":"OPEN_500",...calls,total:calls.individual+calls.batch}));
  expect(calls.individual+calls.batch).toBeLessThanOrEqual(900);
},30_000);
