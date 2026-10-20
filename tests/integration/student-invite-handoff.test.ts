import {env} from 'cloudflare:workers';
import {beforeEach,describe,it,expect} from 'vitest';
import {createDb} from '../../app/db/client.server';
import {createStudentInvite} from '../../app/features/students/invitations.server';
import {action,loader} from '../../app/routes/student-join';
const db=createDb(env.DB);
async function member(role:'USER'|'ADMIN'='USER'){
 const id=crypto.randomUUID(),session=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB.prepare('INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,`${id}@example.test`,'인계 시험',role,now,now,now).run();
 await env.DB.prepare('INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(session,id,'2099-01-01T00:00:00.000Z',now).run();
 return {id,session};
}
function request(fields:Record<string,string>,cookie='',origin='https://retaste.test') {return new Request('https://retaste.test/student/join',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie},body:new URLSearchParams(fields)});}
beforeEach(async()=>{
 await env.DB.prepare('DELETE FROM student_invitations').run();
 await env.DB.prepare('UPDATE student_seats SET user_id=NULL,is_active=1,expires_at=?').bind('2099-01-01T00:00:00.000Z').run();
});
describe('pre-login invitation handoff',()=>{
 it('prepares without claiming, recovers across login, and only claims on explicit authenticated accept',async()=>{
  const admin=await member('ADMIN'),user=await member();
  const invite=await createStudentInvite(db,{seatCode:'C',actorUserId:admin.id,now:new Date().toISOString()});
  const prepared=await action({request:request({intent:'login',token:invite.token})} as never) as Response;
  expect(prepared.headers.get('Location')).toBe('/login?returnTo=%2Fstudent%2Fjoin');
  const header=prepared.headers.get('Set-Cookie')!;expect(header).not.toContain(invite.token);
  expect((await env.DB.prepare("SELECT user_id FROM student_seats WHERE code='C'").first())!.user_id).toBeNull();
  const cookies=`${header.split(';')[0]}; retaste_session=${user.session}`;
  const loaded=await loader({request:new Request('https://retaste.test/student/join',{headers:{Cookie:cookies}})} as never);
  expect(loaded).toMatchObject({data:{pendingInvite:{seatCode:'C'}}});expect(JSON.stringify(loaded)).not.toContain(invite.token);
  const accepted=await action({request:request({intent:'accept'},cookies)} as never) as Response;
  expect(accepted.headers.get('Location')).toBe('/student');expect(accepted.headers.get('Set-Cookie')).toContain('Max-Age=0');
  expect((await env.DB.prepare("SELECT user_id FROM student_seats WHERE code='C'").first())!.user_id).toBe(user.id);
  const other=await member();
  expect(await action({request:request({intent:'accept'},`${header.split(';')[0]}; retaste_session=${other.session}`)} as never)).toMatchObject({init:{status:400}});
  expect((await env.DB.prepare("SELECT user_id FROM student_seats WHERE code='C'").first())!.user_id).toBe(user.id);
 });
 it('rejects cross-origin preparation and invalid invitations without issuing a cookie',async()=>{
  const admin=await member('ADMIN');const invite=await createStudentInvite(db,{seatCode:'D',actorUserId:admin.id,now:new Date().toISOString()});
  expect(await action({request:request({intent:'login',token:invite.token},'','https://evil.test')} as never)).toMatchObject({init:{status:403}});
  expect(await action({request:request({intent:'login',token:'Z'.repeat(43)})} as never)).toMatchObject({init:{status:400}});
  expect((await env.DB.prepare("SELECT user_id FROM student_seats WHERE code='D'").first())!.user_id).toBeNull();
 });
 it('keeps the normal-account requirement when a privileged account carries a valid pending invite',async()=>{
  const admin=await member('ADMIN');const invite=await createStudentInvite(db,{seatCode:'C',actorUserId:admin.id,now:new Date().toISOString()});
  const prepared=await action({request:request({intent:'login',token:invite.token})} as never) as Response;
  const cookies=`${prepared.headers.get('Set-Cookie')!.split(';')[0]}; retaste_session=${admin.session}`;
  expect(await action({request:request({intent:'accept'},cookies)} as never)).toMatchObject({init:{status:403}});
  expect((await env.DB.prepare("SELECT user_id FROM student_seats WHERE code='C'").first())!.user_id).toBeNull();
 });
});
