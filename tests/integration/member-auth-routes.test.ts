import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({google:vi.fn(),naver:vi.fn()}));
vi.mock("cloudflare:workers",async(original)=>{
  const actual=await original<typeof import("cloudflare:workers")>();
  return {...actual,env:new Proxy(actual.env,{get(target,key,receiver){
    if(["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","NAVER_LOGIN_CLIENT_ID","NAVER_LOGIN_CLIENT_SECRET"].includes(String(key)))return "synthetic";
    return Reflect.get(target,key,receiver);
  }})};
});
vi.mock("../../app/features/auth/google-login.server",async(original)=>({...await original<object>(),completeGoogleLogin:mocks.google}));
vi.mock("../../app/features/auth/naver-login.server",async(original)=>({...await original<object>(),completeNaverFlow:mocks.naver}));
import { hashPassword } from "../../app/features/auth/password.server";
import { action as passwordLogin } from "../../app/routes/login";
import { loader as googleLogin } from "../../app/routes/auth-google-callback";
import { loader as naverLogin } from "../../app/routes/auth-naver-callback";

let id:string,email:string;
beforeAll(async()=>{
  id=crypto.randomUUID();email=`restricted-${id}@example.test`;const at=new Date(),password=await hashPassword("synthetic-password");
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,password_hash,password_salt,email_verified_at,created_at,updated_at) VALUES (?,?,'Restricted','USER',?,?,?,?,?)").bind(id,email,password.hash,password.salt,at.toISOString(),at.toISOString(),at.toISOString()).run();
  await env.DB.prepare("INSERT INTO member_access_restrictions(user_id,version,reason,starts_at,expires_at,updated_at) VALUES (?,1,'private reason',?,?,?)").bind(id,new Date(at.getTime()-1000).toISOString(),new Date(at.getTime()+86400000).toISOString(),at.toISOString()).run();
});
it("returns a safe password 403 and never creates a restricted session",async()=>{
  const form=new URLSearchParams({email,password:"synthetic-password"});
  const response=await passwordLogin({request:new Request("https://retaste.test/login",{method:"POST",headers:{Origin:"https://retaste.test"},body:form})} as never) as {data:{error:string};init:{status:number;headers:Record<string,string>}};
  expect(response.init.status).toBe(403);expect(response.data.error).toContain("접근이 제한");expect(response.init.headers["Cache-Control"]).toContain("no-store");
});
for(const provider of ["google","naver"] as const) it(`returns a safe ${provider} callback 403 after a concurrent restriction`,async()=>{
  const result={userId:id,email,displayName:"Restricted",role:"USER",isNewUser:false,returnTo:"/me",flow:"LOGIN"};
  mocks[provider].mockResolvedValue(result);
  const cookie=provider==="google"?"retaste_oauth_request=test":"retaste_naver_oauth=test";
  const response=await (provider==="google"?googleLogin:naverLogin)({request:new Request(`https://retaste.test/auth/${provider}/callback?state=test&code=test`,{headers:{Cookie:cookie}})} as never) as Response;
  expect(response.status).toBe(403);expect(await response.text()).toContain("접근이 제한");expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect((await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?").bind(id).all()).results).toHaveLength(0);
});
