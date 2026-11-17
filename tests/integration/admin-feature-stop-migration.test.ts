import {env} from "cloudflare:workers";
import {applyD1Migrations} from "cloudflare:test";
import {expect,it} from "vitest";
it("preserves prior receipts and installs only the permitted stopped flag",async()=>{
 const db=(env as unknown as {MIGRATION_DB:D1Database}).MIGRATION_DB;
 await applyD1Migrations(db,env.TEST_MIGRATIONS.filter(m=>m.name<"0054"));
 const now=new Date().toISOString(),expires="2099-01-01T00:00:00.000Z";
 await db.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES('b12-admin','b12@example.test','Test','ADMIN',?,?)").bind(now,now).run();
 await db.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES('b12-session','b12-admin',?,?)").bind(now,expires).run();
 await db.prepare(`INSERT INTO admin_operations(id,kind,actor_user_id,session_id,payload_json,payload_hash,summary_json,requires_recent_auth,created_at,expires_at)
 VALUES('b12-preserved','RATING_RECOMPUTE','b12-admin','b12-session','{}','test','{"title":"test","count":1}',0,?,?)`).bind(now,expires).run();
 await db.prepare("INSERT INTO admin_operation_commits VALUES('b12-preserved','b12-admin','b12-session','RATING_RECOMPUTE',?)").bind(now).run();
 await db.prepare("INSERT INTO admin_operation_checks VALUES('b12-preserved','test',1)").run();
 await db.prepare("UPDATE admin_operations SET status='COMMITTED',payload_json=NULL,result_json='{}',committed_at=? WHERE id='b12-preserved'").bind(now).run();
 const tables=['admin_operations','admin_operation_commits','admin_operation_checks'];
 const snapshot=()=>Promise.all(tables.map(async table=>(await db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()).results));
 const before=await snapshot();
 await applyD1Migrations(db,env.TEST_MIGRATIONS.filter(m=>m.name.startsWith("0054")));
 expect(await snapshot()).toEqual(before);
 expect(await db.prepare("SELECT key,stopped,version FROM admin_feature_stops").first()).toEqual({key:"REVIEW_AUTO_PIPELINE_ENABLED",stopped:0,version:0});
 expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toHaveLength(0);
 await expect(db.prepare("UPDATE admin_operations SET result_json='{}' WHERE id='b12-preserved'").run()).rejects.toThrow("IMMUTABLE");
 await expect(db.prepare("INSERT INTO admin_feature_stops(key,stopped,version,updated_at) VALUES('CST_MAINTENANCE',1,0,?)").bind(now).run()).rejects.toThrow();
});
