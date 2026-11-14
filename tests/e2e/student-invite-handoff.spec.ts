import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {hashPassword} from '../../app/features/auth/password.server';
const password='local-cd-login-reproduction';
function sql(command:string){return execFileSync('pnpm',['exec','wrangler','d1','execute','DB','--local','--config','wrangler.e2e.jsonc','--persist-to','.wrangler/e2e-state','--command',command],{stdio:'pipe'});}
test.skip(Boolean(process.env.BASE_URL),'Local synthetic database only');
test.beforeEach(async()=>{
 execFileSync('pnpm',['exec','wrangler','d1','execute','DB','--local','--config','wrangler.e2e.jsonc','--persist-to','.wrangler/e2e-state','--file','scripts/seed-student-qa.sql'],{stdio:'pipe'});
 const verifiedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+10*60_000).toISOString();
 // Local synthetic QA session only; no production assurance is created.
 sql(`INSERT INTO admin_session_assurances(session_id,actor_user_id,method,verified_at,expires_at) SELECT id,user_id,'PASSWORD','${verifiedAt}','${expiresAt}' FROM sessions WHERE id='qa-admin-session' ON CONFLICT(session_id) DO UPDATE SET verified_at=excluded.verified_at,expires_at=excluded.expires_at`);
 const h=await hashPassword(password);
 sql(`UPDATE users SET password_hash='${h.hash}',password_salt='${h.salt}' WHERE id IN ('qa-student-c','qa-student-d');`);
 const tasks:string[]=[];
 for(const seat of ['C','D'])for(let n=1;n<=2;n++)tasks.push(`INSERT INTO student_tasks(id,kind,target_id,title,assigned_seat,checker_seat,created_at,updated_at) VALUES('local-${seat}-${n}','QA','${n===1?'/':'/places'}','시험 ${seat} QA ${n}','${seat}','${seat==='C'?'D':'C'}','2026-10-20T00:00:00.000Z','2026-10-20T00:00:00.000Z');`);
 sql(tasks.join('\n'));
});
for(const seat of ['C','D'])for(const mode of ['same-tab','blocked-storage','new-tab'])test(`${seat} login to acceptance: ${mode}`,async({page:admin,context,browser,baseURL},info)=>{
 test.setTimeout(60000);
 expect(new URL(baseURL!).hostname).toBe('127.0.0.1');
 await context.addCookies([{name:'retaste_session',value:'qa-admin-session',url:baseURL!}]);
 await admin.goto('/admin/students');
 await admin.getByRole('button',{name:`학생 ${seat} 초대 발급 미리보기`,exact:true}).click();
 await admin.getByRole('button',{name:'변경 확정',exact:true}).click();
 const invite=await admin.getByLabel('학생에게 전달할 초대 링크').inputValue();
 const c=await browser.newContext({baseURL,viewport:info.project.name==='webkit'?{width:390,height:844}:{width:1280,height:800}});
 let phase='invitation';const timeline:any[]=[];
 try{
  if(mode==='blocked-storage')await c.addInitScript(()=>{Object.defineProperty(window,'sessionStorage',{get(){throw Error('blocked for reproduction')}})});
  c.on('response',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/student')||url.pathname.startsWith('/login'))timeline.push({phase,path:url.pathname.replace(/\/student\/tasks\/.*/, '/student/tasks/:id'),method:r.request().method(),status:r.status()});});
  let page=await c.newPage();await page.goto(invite);
  await expect(page.getByRole('heading',{name:'먼저 개인 계정으로 로그인해 주세요',exact:true})).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  phase='login';await page.getByText('로그인하고 초대 수락 계속하기',{exact:true}).click();
  await expect(page).toHaveURL(`${baseURL}/login?returnTo=%2Fstudent%2Fjoin`);
  if(mode==='new-tab'){const loginUrl=page.url();page=await c.newPage();await page.goto(loginUrl);}
  await page.getByLabel('이메일',{exact:true}).fill(`qa-student-${seat.toLowerCase()}@retaste.local`);
  await page.getByLabel('비밀번호',{exact:true}).fill(password);
  await page.getByRole('button',{name:'로그인',exact:true}).click();
  await expect(page).toHaveURL(`${baseURL}/student/join`);
  expect((await c.cookies()).some(x=>x.name==='retaste_session')).toBe(true);
  phase='after-login';
  await expect(page.getByRole('heading',{name:`시험 학생 ${seat} 계정으로 참여`,exact:true})).toBeVisible();
  await expect(page.getByLabel('받은 개인별 초대 링크',{exact:true})).toHaveCount(0);
  if(mode!=='same-tab') await expect(page.getByText(`학생 ${seat} 초대를 수락합니다.`,{exact:true})).toBeVisible();
  const pendingCookie=(await c.cookies()).find(x=>x.name==='retaste_student_invite');
  expect(pendingCookie?.httpOnly).toBe(true);expect(pendingCookie?.sameSite).toBe('Lax');
  expect(pendingCookie?.value).not.toContain(new URL(invite).hash.slice(1));
  expect(timeline.some(x=>x.method==='POST'&&x.path.startsWith('/student/join')&&x.phase==='accept')).toBe(false);
  await page.screenshot({path:info.outputPath('accept-button.png'),fullPage:true});
  phase='accept';await page.getByRole('button',{name:'초대 수락하고 내 작업 열기',exact:true}).click();
  await expect(page.getByRole('heading',{name:`학생 ${seat}의 작업`,exact:true})).toBeVisible();
  expect(timeline.some(x=>x.method==='POST'&&x.path.startsWith('/student/join'))).toBe(true);
  expect((await c.cookies()).some(x=>x.name==='retaste_student_invite')).toBe(false);
  phase='open-assigned-task';await page.getByRole('link',{name:new RegExp(`시험 ${seat} QA 1`)}).click();
  await expect(page.getByRole('heading',{name:`시험 ${seat} QA 1`,exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'배정된 화면 시험',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('assigned-task-opened.png'),fullPage:true});
  writeFileSync(info.outputPath('sanitized-timeline.json'),JSON.stringify({seat,mode,browser:info.project.name,localOnly:true,loginSucceeded:true,missingInviteAfterLogin:false,accepted:true,assignedTaskOpened:true,timeline},null,2));
 }finally{await c.close();}
});
