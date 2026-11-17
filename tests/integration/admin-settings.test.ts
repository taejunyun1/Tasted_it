import { env } from "cloudflare:workers";
import { expect,it } from "vitest";
import { action,loader } from "../../app/routes/admin-settings";
async function member(role:"USER"|"ADMIN"){
 const id=crypto.randomUUID(),sessionId=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id,`${id}@example.test`,"합성 사용자",role,now,now).run();
 await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)").bind(sessionId,id,now,"2099-01-01T00:00:00.000Z").run();
 return sessionId;
}
function request(sessionId?:string,method="GET"){return new Request("https://example.test/admin/settings",{method,headers:sessionId?{...(method==="POST"?{Origin:"https://example.test"}:{}),Cookie:`retaste_session=${sessionId}`}:{}});}
it("rejects anonymous and regular accounts with private responses",async()=>{
 await expect(loader({request:request()} as never)).rejects.toMatchObject({status:302});
 const sessionId=await member("USER");
 try{await loader({request:request(sessionId)} as never);throw new Error("expected forbidden");}
 catch(error){expect(error).toBeInstanceOf(Response);expect((error as Response).status).toBe(403);expect((error as Response).headers.get("cache-control")).toContain("no-store");}
});
it("returns only safe observations and refuses unsupported writes without changing stored state",async()=>{
 const sessionId=await member("ADMIN");
 const before=await env.DB.prepare("SELECT (SELECT COUNT(*) FROM admin_audit_logs) audits,(SELECT COUNT(*) FROM sessions) sessions").first();
 const result=await loader({request:request(sessionId)} as never);
 expect(result.data.settings).toHaveLength(13);expect(result.data.deploymentVersion).toBe("미확인");
 expect(JSON.stringify(result.data)).not.toContain(sessionId);
 const denied=await action({request:request(sessionId,"POST")} as never);
 expect(denied instanceof Response?denied.status:denied.init?.status).toBe(400);
 const forged=await action({request:new Request("https://example.test/admin/settings",{method:"POST",headers:{Cookie:`retaste_session=${sessionId}`,Origin:"https://example.test","Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({intent:"preview-stop",key:"CST_MAINTENANCE",reason:"다른 설정 변조"})})} as never);
 expect(forged instanceof Response?forged.status:forged.init?.status).toBe(400);
 const crossOrigin=await action({request:new Request("https://example.test/admin/settings",{method:"POST",headers:{Cookie:`retaste_session=${sessionId}`,Origin:"https://outside.example"}})} as never);
 expect(crossOrigin instanceof Response?crossOrigin.status:crossOrigin.init?.status).toBe(403);
 expect(await env.DB.prepare("SELECT (SELECT COUNT(*) FROM admin_audit_logs) audits,(SELECT COUNT(*) FROM sessions) sessions").first()).toEqual(before);
});
