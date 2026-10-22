import {describe,it,expect} from 'vitest';
import {pendingInviteCookie,readPendingInviteCookie,clearPendingInviteCookie} from '../../app/features/students/pending-invite-cookie.server';
const secret='synthetic-cookie-secret-not-a-production-secret';
const now=new Date('2026-10-20T00:00:00.000Z');
const token='A'.repeat(43);
const url='https://retaste.test/student/join';
const input={token,seatCode:'C' as const,expiresAt:'2026-10-22T00:00:00.000Z'};
function request(cookie:string,target=url){return new Request(target,{headers:{Cookie:cookie.split(';')[0]!}});}
describe('encrypted pre-login invitation handoff',()=>{
 it('keeps the bearer encrypted and readable across tabs, not across origins',async()=>{
  const cookie=await pendingInviteCookie(input,secret,url,now);
  expect(cookie).not.toContain(token);expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');expect(cookie).toContain('SameSite=Lax');expect(cookie).toContain('Max-Age=3600');
  expect(await readPendingInviteCookie(request(cookie),secret,now)).toMatchObject({token,seatCode:'C'});
  expect(await readPendingInviteCookie(request(cookie,'https://other.test/student/join'),secret,now)).toBeNull();
 });
 it('rejects tampering, wrong keys, expiration and malformed input',async()=>{
  const cookie=await pendingInviteCookie(input,secret,url,now);
  expect(await readPendingInviteCookie(request(cookie),secret+'wrong',now)).toBeNull();
  const raw=cookie.split(';')[0]!;const tampered=raw.slice(0,-8)+'BBBBBBBB';
  expect(await readPendingInviteCookie(request(tampered),secret,now)).toBeNull();
  expect(await readPendingInviteCookie(request(cookie),secret,new Date(now.getTime()+3600000))).toBeNull();
  expect(await readPendingInviteCookie(request('__Host-retaste_student_invite=bad'),secret,now)).toBeNull();
  expect(await readPendingInviteCookie(new Request(url),secret,now)).toBeNull();
 });
 it('never outlives the original invitation and supports local HTTP fixtures',async()=>{
  const cookie=await pendingInviteCookie({...input,expiresAt:'2026-10-20T00:05:00.000Z'},secret,url,now);
  expect(cookie).toContain('Max-Age=300');
  expect(await readPendingInviteCookie(request(cookie),secret,new Date(now.getTime()+300000))).toBeNull();
  const local=await pendingInviteCookie(input,secret,'http://127.0.0.1/student/join',now);
  expect(local).toMatch(/^retaste_student_invite=/);expect(local).not.toContain('; Secure');
  expect(clearPendingInviteCookie(url)).toContain('Max-Age=0');
 });
});
