import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { action, loader } from "../../app/routes/admin-place-operations";
import * as corrections from "../../app/features/places/place-correction.server";
import * as liveness from "../../app/features/places/place-revalidation.server";
import { loader as list } from "../../app/routes/admin-places";

async function caller(role:"ADMIN"|"USER"="ADMIN") {
  const userId=crypto.randomUUID(), sessionId=crypto.randomUUID(), now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(userId,`${userId}@example.test`,"합성 운영자",role,now,now,now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)").bind(sessionId,userId,now,"2099-01-01T00:00:00.000Z").run();
  return {userId,sessionId,now};
}
function request(sessionId?:string, body?:string, origin="https://place.test",path="/admin/place-operations") {
  return new Request(`https://place.test${path}`,{method:body===undefined?"GET":"POST",headers:{...(sessionId?{Cookie:`retaste_session=${sessionId}`} : {}),...(body===undefined?{}:{Origin:origin,"Content-Type":"application/x-www-form-urlencoded"})},body});
}
async function place(now:string) {
  const id=crypto.randomUUID(), category=crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO categories(id,slug,name,emoji,sort_order,is_active,created_at,updated_at) VALUES(?,?,?,'',1,1,?,?)").bind(category,category,"합성 분류",now,now),
    env.DB.prepare("INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES(?,?,?,'PUBLISHED',?,'동명동',35.15,126.92,?,?,?)").bind(id,id,"합성 동네식당","광주광역시 동구 동명로 10",id,now,now),
    env.DB.prepare("INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(?,?,1)").bind(id,category),
  ]);
  return id;
}
function status(value:unknown) {return value instanceof Response?value.status:(value as {init?:{status?:number}}).init?.status??200;}

describe("B09 place operation HTTP boundaries",()=>{
  it("requires administrator sessions on both read surfaces",async()=>{
    await expect(loader({request:request()} as never)).rejects.toMatchObject({status:302});
    const member=await caller("USER");
    await expect(loader({request:request(member.sessionId)} as never)).rejects.toMatchObject({status:403});
    await expect(list({request:request(member.sessionId,undefined,"https://place.test","/admin/places")} as never)).rejects.toMatchObject({status:403});
  });
  it("rejects provenance, method, duplicate scalar fields and oversized bodies before preparation",async()=>{
    const admin=await caller(),before=await env.DB.prepare("SELECT count(*) n FROM admin_operations").first("n");
    const put=new Request(request(admin.sessionId,"intent=recall"),{method:"PUT"});
    expect(status(await action({request:put} as never))).toBe(405);
    expect(status(await action({request:request(admin.sessionId,"intent=recall","https://elsewhere.test")} as never))).toBe(403);
    for(const body of ["intent=recall&intent=merge",`intent=recall&reason=${"a".repeat(65537)}`]) expect(status(await action({request:request(admin.sessionId,body)} as never))).toBeGreaterThanOrEqual(400);
    expect(await env.DB.prepare("SELECT count(*) n FROM admin_operations").first("n")).toBe(before);
  });
  it("preserves repeated compatibility workItemId fields for legacy multi-item review steps",async()=>{
    const admin=await caller();
    const body="intent=hold-review-items&expectedStage=SOURCE_REVIEW&reason=synthetic&workItem=a%7C0&workItem=b%7C0&workItemId=a&workItemId=b";
    const result=await action({request:request(admin.sessionId,body)} as never);
    expect(status(result)).toBe(200);
    expect((result as {ok?:boolean;data?:{ok?:boolean}}).ok??(result as {data?:{ok?:boolean}}).data?.ok).toBe(true);
  });
  it("rejects multiple publication targets and historical revision restore",async()=>{
    const admin=await caller();
    const publish=await action({request:request(admin.sessionId,"intent=publish-review-items&expectedStage=FINAL_APPROVAL&confirmPublish=on&workItem=a%7C0&workItem=b%7C0")} as never);
    expect(status(publish)).toBe(400); expect((publish as {data:{error:string}}).data.error).toContain("1곳");
    const restore=await action({request:request(admin.sessionId,"intent=restore&revisionId=old&reason=legacy")} as never);
    expect(status(restore)).toBe(400); expect((restore as {data:{error:string}}).data.error).toContain("자동 복원");
  });
  it("requires the preview path for publication changes from correction and liveness forms",async()=>{
    const admin=await caller();
    const correction=vi.spyOn(corrections,"applyPlaceCorrection").mockRejectedValue(new Error("PLACE_ADMIN_PREVIEW_REQUIRED"));
    const revalidation=vi.spyOn(liveness,"resolvePlaceLivenessCase").mockRejectedValue(new Error("PLACE_ADMIN_PREVIEW_REQUIRED"));
    try {
      for(const fields of [{intent:"apply-correction",requestId:"synthetic-correction",reason:"합성 확인",expectedUpdatedAt:admin.now},{intent:"resolve-liveness",caseId:"synthetic-case",resolution:"OPEN",reason:"합성 확인"}]) {
        const result=await action({request:request(admin.sessionId,new URLSearchParams(fields).toString())} as never);
        expect(status(result)).toBe(400);expect((result as {data:{error:string}}).data.error).toContain("공개·회수 미리보기");
      }
      expect(correction).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({preservePublicationState:true}));
      expect(revalidation).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({preservePublicationState:true}));
    } finally {correction.mockRestore();revalidation.mockRestore();}
  });
  it("rejects ambiguous operation query parameters",async()=>{
    const admin=await caller();
    for(const path of ["/admin/place-operations?operation=not-an-id","/admin/place-operations?place=a&place=b"]) await expect(loader({request:request(admin.sessionId,undefined,"https://place.test",path)} as never)).rejects.toMatchObject({status:400});
  });
  it("previews without changing publication and returns to the same operation after required reauthentication",async()=>{
    const admin=await caller(),id=await place(admin.now);
    const prepared=await action({request:request(admin.sessionId,new URLSearchParams({intent:"recall",placeId:id,reason:"합성 공개 회수 검증"}).toString())} as never);
    expect(status(prepared)).toBe(302);
    const location=(prepared as Response).headers.get("Location")!;
    const operationId=new URL(location,"https://place.test").searchParams.get("operation")!;
    expect(await env.DB.prepare("SELECT status FROM places WHERE id=?").bind(id).first("status")).toBe("PUBLISHED");
    const page=await loader({request:request(admin.sessionId,undefined,"https://place.test",location)} as never);
    expect(page.data.operation).toMatchObject({operationId,status:"PENDING",change:"RECALL"});
    const denied=await action({request:request(admin.sessionId,new URLSearchParams({intent:"confirm-place-operation",operationId}).toString())} as never);
    expect(status(denied)).toBe(302); expect((denied as Response).headers.get("Location")).toContain("/admin/reauth?returnTo=");
    expect(await env.DB.prepare("SELECT status FROM places WHERE id=?").bind(id).first("status")).toBe("PUBLISHED");
    expect(await env.DB.prepare("SELECT status FROM admin_operations WHERE id=?").bind(operationId).first("status")).toBe("PENDING");
  });
});
