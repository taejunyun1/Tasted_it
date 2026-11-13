import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { consumeAdminEmailChallenge, createAdminEmailChallenge, getAdminAssurance, grantAdminAssurance, reauthenticateAdminPassword } from "../../app/features/auth/admin-assurance.server";
import { hashPassword } from "../../app/features/auth/password.server";
import { consumeAdminReauthRateLimit } from "../../app/features/auth/admin-reauth-rate-limit.server";
import { upsertBetaUser } from "../../app/features/auth/login.server";
import { createDb } from "../../app/db/client.server";
import { consumeLoginRateLimit } from "../../app/features/security/rate-limit.server";

const now = new Date("2026-11-14T01:00:00.000Z");
beforeAll(async () => {
  // This focused fixture also works before the independently owned B02 migration is integrated.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_session_assurances (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL REFERENCES users(id), method TEXT NOT NULL,
    verified_at TEXT NOT NULL, expires_at TEXT NOT NULL)`).run();
});
async function fixture(role = "ADMIN") {
  const id = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const otherSessionId = crypto.randomUUID();
  const password = await hashPassword("admin-test-password");
  await env.DB.prepare(`INSERT INTO users (id,email,display_name,role,password_hash,password_salt,email_verified_at,created_at,updated_at)
    VALUES (?,?,'Synthetic admin',?,?,?,?,?,?)`).bind(id, `${id}@example.test`, role, password.hash, password.salt, now.toISOString(), now.toISOString(), now.toISOString()).run();
  for (const sid of [sessionId, otherSessionId]) await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES (?,?,?,?)").bind(sid, id, now.toISOString(), "2026-11-15T01:00:00.000Z").run();
  return { actorUserId: id, sessionId, otherSessionId, now };
}
describe("session-bound admin assurance", () => {
  it("requires the actual password, expires after ten minutes and is not transferable", async () => {
    const admin = await fixture();
    await expect(reauthenticateAdminPassword(env.DB, { ...admin, password: "wrong" })).rejects.toThrow("ADMIN_CREDENTIAL_INVALID");
    expect(await getAdminAssurance(env.DB, admin)).toBeNull();
    await reauthenticateAdminPassword(env.DB, { ...admin, password: "admin-test-password" });
    expect((await getAdminAssurance(env.DB, admin))?.method).toBe("PASSWORD");
    expect(await getAdminAssurance(env.DB, { ...admin, sessionId: admin.otherSessionId })).toBeNull();
    expect(await getAdminAssurance(env.DB, { ...admin, now: new Date(now.getTime() + 600_000) })).toBeNull();
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(admin.sessionId).run();
    expect(await getAdminAssurance(env.DB, admin)).toBeNull();
  });
  it("rejects non-admins and an assurance after role revocation", async () => {
    const user = await fixture("USER");
    await expect(grantAdminAssurance(env.DB, { ...user, method: "PASSWORD" })).rejects.toThrow("ADMIN_SESSION_INVALID");
    const admin = await fixture();
    await grantAdminAssurance(env.DB, { ...admin, method: "PASSWORD" });
    await env.DB.prepare("UPDATE users SET role = 'USER' WHERE id = ?").bind(admin.actorUserId).run();
    expect(await getAdminAssurance(env.DB, admin)).toBeNull();
  });
  it("uses an actual hashed email code once, only in the original session, with cooldown", async () => {
    const admin = await fixture();
    const challenge = await createAdminEmailChallenge(env.DB, admin);
    const row = await env.DB.prepare("SELECT token_hash FROM admin_reauth_challenges WHERE id = ?").bind(challenge.id).first<{token_hash:string}>();
    expect(row?.token_hash).not.toContain(challenge.code);
    await expect(createAdminEmailChallenge(env.DB, admin)).rejects.toThrow("ADMIN_EMAIL_COOLDOWN");
    await expect(consumeAdminEmailChallenge(env.DB, { ...admin, id: challenge.id, code: challenge.code, sessionId: admin.otherSessionId })).rejects.toThrow("ADMIN_CREDENTIAL_INVALID");
    await expect(consumeAdminEmailChallenge(env.DB, { ...admin, id: challenge.id, code: "00000000" === challenge.code ? "11111111" : "00000000" })).rejects.toThrow("ADMIN_CREDENTIAL_INVALID");
    await consumeAdminEmailChallenge(env.DB, { ...admin, id: challenge.id, code: challenge.code });
    expect((await getAdminAssurance(env.DB, admin))?.method).toBe("EMAIL");
    await expect(consumeAdminEmailChallenge(env.DB, { ...admin, id: challenge.id, code: challenge.code })).rejects.toThrow("ADMIN_CREDENTIAL_INVALID");
  });
  it("limits verification attempts across sessions of the same account", async () => {
    const admin = await fixture();
    for (let index = 0; index < 10; index++) expect(await consumeAdminReauthRateLimit(env.DB, { ...admin, kind: "VERIFY", ip: null })).toBe(true);
    expect(await consumeAdminReauthRateLimit(env.DB, { ...admin, sessionId: admin.otherSessionId, kind: "VERIFY", ip: null })).toBe(false);
  });
  it("keeps the mail budget when ordinary login cleanup advances its window", async () => {
    const admin = await fixture();
    for (let index = 0; index < 3; index++) expect(await consumeAdminReauthRateLimit(env.DB, { ...admin, kind: "SEND", ip: null })).toBe(true);
    const later = new Date(now.getTime() + 20 * 60_000);
    await consumeLoginRateLimit(createDb(env.DB), { email: "synthetic-cleanup@example.test", now: later });
    expect(await consumeAdminReauthRateLimit(env.DB, { ...admin, now: later, kind: "SEND", ip: null })).toBe(false);
  });
  it("preserves explicitly managed roles during ordinary beta logins", async () => {
    const admin = await fixture();
    const user = await fixture("USER");
    expect((await upsertBetaUser(createDb(env.DB), { email: `${admin.actorUserId}@example.test`, displayName: "Admin", userId: "unused", now: now.toISOString() })).role).toBe("ADMIN");
    expect((await upsertBetaUser(createDb(env.DB), { email: `${user.actorUserId}@example.test`, adminEmail: `${user.actorUserId}@example.test`, displayName: "User", userId: "unused", now: now.toISOString() })).role).toBe("USER");
  });
  it("protects the last admin even when two writers demote concurrently", async () => {
    // Isolate the count without deleting an administrator or disabling the database trigger.
    const all = (await env.DB.prepare("SELECT id FROM users WHERE role = 'ADMIN'").all<{id:string}>()).results;
    for (let index = 1; index < all.length; index++) await env.DB.prepare("UPDATE users SET role = 'USER' WHERE id = ?").bind(all[index]!.id).run();
    const first = all[0]?.id ?? (await fixture()).actorUserId;
    const second = (await fixture()).actorUserId;
    await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES ('synthetic-system','system@example.test','System','ADMIN',?,?)").bind(now.toISOString(), now.toISOString()).run();
    const results = await Promise.allSettled([first, second].map((id) => env.DB.prepare("UPDATE users SET role = 'USER' WHERE id = ?").bind(id).run()));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND email_verified_at IS NOT NULL").first<{count:number}>())?.count).toBe(1);
    await expect(env.DB.prepare("UPDATE users SET email_verified_at = NULL WHERE role = 'ADMIN' AND email_verified_at IS NOT NULL").run()).rejects.toThrow("LAST_ADMIN_REQUIRED");
    await expect(env.DB.prepare("DELETE FROM users WHERE role = 'ADMIN' AND email_verified_at IS NOT NULL").run()).rejects.toThrow("LAST_ADMIN_REQUIRED");
  });
});
