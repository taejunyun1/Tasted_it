import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect,it } from "vitest";

it("preserves public jobs, operation receipts, rowids and guards across 0051",async()=>{
 const db=(env as unknown as {MIGRATION_DB:D1Database}).MIGRATION_DB;
 await applyD1Migrations(db,env.TEST_MIGRATIONS.filter(m=>m.name<"0051"));
 const now=new Date().toISOString(),expires="2099-01-01T00:00:00.000Z";
 await db.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES('sync-migration-admin','sync@example.test','Test','ADMIN',?,?,?)").bind(now,now,now).run();
 await db.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES('sync-migration-session','sync-migration-admin',?,?)").bind(expires,now).run();
 await db.prepare("INSERT INTO admin_operations(id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at) VALUES('sync-preserved','RATING_RECOMPUTE','sync-migration-admin','sync-migration-session','{}','test','{\"title\":\"test\",\"count\":1}',0,?,?)").bind(now,expires).run();
 await db.prepare("INSERT INTO admin_operation_commits VALUES('sync-preserved','sync-migration-admin','sync-migration-session','RATING_RECOMPUTE',?)").bind(now).run();
 await db.prepare("INSERT INTO admin_operation_checks VALUES('sync-preserved','test',1)").run();
 await db.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json='{}',committed_at=? WHERE id='sync-preserved'").bind(now).run();
 await db.prepare("INSERT INTO public_data_sync_runs(id,source_type,region_code,address_field,status,next_page,fetched_count,started_at,created_at,updated_at) VALUES('preserved-run','BAKERY','GWANGJU_JEONNAM','ROAD_NM_ADDR','RUNNING',4,300,?,?,?)").bind(now,now,now).run();
 const tables=['admin_operations','admin_operation_commits','admin_operation_checks'];
 const read=()=>Promise.all(tables.map(async t=>(await db.prepare(`SELECT rowid,* FROM ${t} ORDER BY rowid`).all()).results));
 const before=await read(),job=await db.prepare("SELECT rowid,* FROM public_data_sync_runs").first<Record<string,unknown>>();
 await applyD1Migrations(db,env.TEST_MIGRATIONS.filter(m=>m.name.startsWith("0051")));
 expect(await read()).toEqual(before);
 expect(await db.prepare("SELECT rowid,* FROM public_data_sync_runs").first()).toMatchObject({...job,attempts:0,retry_count:0,request_count:0,lease_id:null});
 expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toHaveLength(0);
 await expect(db.prepare("UPDATE admin_operations SET result_json='{}' WHERE id='sync-preserved'").run()).rejects.toThrow("IMMUTABLE");
 await expect(db.prepare("INSERT INTO public_data_sync_guards VALUES('bad',0)").run()).rejects.toThrow();
});
