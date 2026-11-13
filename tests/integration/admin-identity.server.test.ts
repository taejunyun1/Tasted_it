import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { grantAdminAssurance } from "../../app/features/auth/admin-assurance.server";
import { commitAdminIdentityChange, listAdminIdentities, prepareAdminIdentityChange } from "../../app/features/auth/admin-identity.server";
import { applyReviewerDormancy, changeReviewerStatus } from "../../app/features/reviewers/reviewer.server";
import { createDb } from "../../app/db/client.server";

const now = new Date("2026-11-14T03:00:00Z");
async function account(role: "ADMIN" | "USER" = "USER") {
  const id = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES (?,?,'Synthetic user',?,?,?,?)")
    .bind(id, `${id}@example.test`, role, now.toISOString(), now.toISOString(), now.toISOString()).run();
  await env.DB.prepare("INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)").bind(sessionId, id, now.toISOString(), "2026-11-15T03:00:00.000Z").run();
  return { id, sessionId };
}
async function actor() {
  const user = await account("ADMIN");
  const input = { actorUserId: user.id, sessionId: user.sessionId, now };
  await grantAdminAssurance(env.DB, { ...input, method: "PASSWORD" });
  return input;
}
async function role(id: string) { return (await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(id).first<{role:string}>())?.role; }
describe("admin identity command adapter", () => {
  it("previews and grants/revokes once with session invalidation and immutable audit", async () => {
    const admin = await actor();
    const target = await account();
    const grant = await prepareAdminIdentityChange(env.DB, { ...admin, targetUserId: target.id, action: "GRANT_ADMIN" });
    expect(await role(target.id)).toBe("USER");
    const input = { ...admin, operationId: grant.operationId, kind: "ADMIN_ROLE_CHANGE" as const };
    expect((await commitAdminIdentityChange(env.DB, input)).replayed).toBe(false);
    expect(await role(target.id)).toBe("ADMIN");
    expect(await env.DB.prepare("SELECT id FROM sessions WHERE user_id = ?").bind(target.id).first()).toBeNull();
    expect((await commitAdminIdentityChange(env.DB, input)).replayed).toBe(true);
    const audits = await env.DB.prepare("SELECT id FROM admin_audit_logs WHERE target_id = ?").bind(grant.operationId).all();
    expect(audits.results).toHaveLength(1);
    await expect(env.DB.prepare("DELETE FROM admin_audit_logs WHERE target_id = ?").bind(grant.operationId).run()).rejects.toThrow("IMMUTABLE");
    const revoke = await prepareAdminIdentityChange(env.DB, { ...admin, targetUserId: target.id, action: "REVOKE_ADMIN" });
    await commitAdminIdentityChange(env.DB, { ...admin, operationId: revoke.operationId, kind: "ADMIN_ROLE_CHANGE" });
    expect(await role(target.id)).toBe("USER");
  });
  it("blocks self role changes and stale role or new-session previews without partial effects", async () => {
    const admin = await actor();
    await expect(prepareAdminIdentityChange(env.DB, { ...admin, targetUserId: admin.actorUserId, action: "REVOKE_ADMIN" })).rejects.toThrow("ADMIN_SELF_ROLE_CHANGE_FORBIDDEN");
    const target = await account();
    const grant = await prepareAdminIdentityChange(env.DB, { ...admin, targetUserId: target.id, action: "GRANT_ADMIN" });
    await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES (?,?,?,?)").bind(crypto.randomUUID(), target.id, now.toISOString(), "2026-11-15T03:00:00.000Z").run();
    await expect(commitAdminIdentityChange(env.DB, { ...admin, operationId: grant.operationId, kind: "ADMIN_ROLE_CHANGE" })).rejects.toThrow();
    expect(await role(target.id)).toBe("USER");
    expect((await env.DB.prepare("SELECT id FROM sessions WHERE user_id = ?").bind(target.id).all()).results).toHaveLength(2);
  });
  it("keeps current session and revokes only a selected opaque session reference", async () => {
    const admin = await actor();
    const second = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES (?,?,?,?)").bind(second, admin.actorUserId, now.toISOString(), "2026-11-15T03:00:00.000Z").run();
    const list = await listAdminIdentities(env.DB, { ...admin, targetUserId: admin.actorUserId });
    expect(JSON.stringify(list)).not.toContain(admin.sessionId);
    expect(JSON.stringify(list)).not.toContain(second);
    const selected = list.sessions.find((session) => !session.isCurrent)!;
    const preview = await prepareAdminIdentityChange(env.DB, { ...admin, targetUserId: admin.actorUserId, action: "REVOKE_SESSIONS", selectedSessionRef: selected.ref });
    await commitAdminIdentityChange(env.DB, { ...admin, operationId: preview.operationId, kind: "ADMIN_SESSIONS_REVOKE" });
    expect(await env.DB.prepare("SELECT id FROM sessions WHERE id = ?").bind(second).first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM sessions WHERE id = ?").bind(admin.sessionId).first()).not.toBeNull();
  });
  it("requires fresh assurance at commit even if a preview exists", async () => {
    const admin = await actor();
    const target = await account();
    const preview = await prepareAdminIdentityChange(env.DB, { ...admin, targetUserId: target.id, action: "GRANT_ADMIN" });
    await env.DB.prepare("DELETE FROM admin_session_assurances WHERE session_id = ?").bind(admin.sessionId).run();
    await expect(commitAdminIdentityChange(env.DB, { ...admin, operationId: preview.operationId, kind: "ADMIN_ROLE_CHANGE" })).rejects.toThrow("ADMIN_RECENT_AUTH_REQUIRED");
    expect(await role(target.id)).toBe("USER");
  });
  it("preserves an administrator role through reviewer status changes and dormancy", async () => {
    const admin = await actor();
    await env.DB.prepare(`INSERT INTO reviewer_profiles
      (user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,created_at,updated_at)
      VALUES (?,?,'ACTIVE','Synthetic','Synthetic','GWANGJU','[]','2026-08-01T00:00:00.000Z',?,?,?)`)
      .bind(admin.actorUserId, `synthetic-${admin.actorUserId}`, now.toISOString(), now.toISOString(), now.toISOString()).run();
    const db = createDb(env.DB);
    await applyReviewerDormancy(db, { actorUserId: admin.actorUserId, now: now.toISOString() });
    expect(await role(admin.actorUserId)).toBe("ADMIN");
    for (const status of ["SUSPENDED", "ACTIVE"] as const) {
      await changeReviewerStatus(db, { userId: admin.actorUserId, actorUserId: admin.actorUserId, status, reason: "Synthetic test", now: now.toISOString() });
      expect(await role(admin.actorUserId)).toBe("ADMIN");
    }
  });
});
