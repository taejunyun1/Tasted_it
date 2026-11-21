import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { readAdminLifecycle } from "../../app/features/operations/admin-lifecycle.server";
import { runScheduledOnboardingDataLifecycle } from "../../app/features/onboarding/data-lifecycle.server";
import { action, loader } from "../../app/routes/admin-lifecycle";

const now = "2026-11-18T00:00:00.000Z";
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM guest_taste_sessions"), env.DB.prepare("DELETE FROM product_events"),
    env.DB.prepare("DELETE FROM rate_limit_windows"), env.DB.prepare("DELETE FROM admin_audit_logs WHERE action='ONBOARDING_DATA_LIFECYCLE'"),
  ]);
});
async function guest(id: string, expiresAt: string, flags = "") {
  await env.DB.prepare(`INSERT INTO guest_taste_sessions(id,expires_at,created_at,updated_at${flags ? ",completed_at" : ""}) VALUES(?,?,?,?${flags ? ",?" : ""})`)
    .bind(...[id, expiresAt, now, now, ...(flags ? [now] : [])]).run();
}
async function admin(role = "ADMIN") {
  const id = crypto.randomUUID(), sid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id, `${id}@example.test`, "private-name", role, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sid, id, "2099-01-01T00:00:00.000Z", now).run();
  return sid;
}
it("reports bounded sample counts with technical TTLs and no guest or event identifiers", async () => {
  await guest("private-expired", now);
  await guest("private-active", "2027-01-01T00:00:00.000Z");
  await guest("private-complete", "2027-01-01T00:00:00.000Z", "complete");
  await env.DB.prepare("INSERT INTO product_events(id,event_name,metadata_json,occurred_at) VALUES('private-event','GUEST_CONVERTED','{\"private\":\"payload\"}','2026-10-19T00:00:00.000Z')").run();
  const before = await env.DB.prepare("SELECT count(*) n FROM guest_taste_sessions").first("n");
  const result = await readAdminLifecycle(env.DB, now);
  expect(result.guest).toMatchObject({ sampled: 3, truncated: false, due: 1, active: 1, completed: 1 });
  expect(result.events).toMatchObject({ sampled: 1, due: 1, conversions: 1 });
  expect(result.technical).toMatchObject({ guestDays: 30, saveLimit: 50, eventDays: 30, rateWindowHours: 24 });
  expect(result.cleanup.status).toBe("UNOBSERVED");
  expect(JSON.stringify(result)).not.toMatch(/private-|payload|cookie|guest_session_id|metadata_json/);
  expect(await env.DB.prepare("SELECT count(*) n FROM guest_taste_sessions").first("n")).toBe(before);
});
it("caps the sampled rows without calling them the complete total", async () => {
  await env.DB.prepare(`WITH RECURSIVE seq(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM seq WHERE x<1005)
    INSERT INTO guest_taste_sessions(id,expires_at,created_at,updated_at) SELECT 'bounded-'||x,?,?,? FROM seq`)
    .bind(now, now, now).run();
  expect((await readAdminLifecycle(env.DB, now)).guest).toMatchObject({ sampled: 1000, truncated: true, due: 1000 });
});
it("records future cleanup completion and preserves successful cleanup when telemetry fails", async () => {
  await guest("expired", now);
  expect(await runScheduledOnboardingDataLifecycle(env, { now })).toMatchObject({ guestSessions: 1 });
  expect((await readAdminLifecycle(env.DB, now)).cleanup).toMatchObject({ status: "COMPLETED", guestSessions: 1, productEvents: 0, rateWindows: null });
  await guest("second-expired", now);
  await env.DB.exec("CREATE TRIGGER reject_lifecycle_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='ONBOARDING_DATA_LIFECYCLE' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(runScheduledOnboardingDataLifecycle(env, { now })).resolves.toMatchObject({ guestSessions: 1 });
    expect(log).toHaveBeenCalledWith("ONBOARDING_LIFECYCLE_TELEMETRY_FAILED", { outcome: "COMPLETED" });
  } finally { log.mockRestore(); await env.DB.exec("DROP TRIGGER reject_lifecycle_audit;"); }
});
it("records partial or unknown failure without making sequential cleanup atomic", async () => {
  await guest("blocked-expired", now);
  await env.DB.prepare("INSERT INTO product_events(id,event_name,occurred_at) VALUES('expired-event','GUEST_CONVERTED','2026-01-01T00:00:00.000Z')").run();
  await env.DB.exec("CREATE TRIGGER reject_guest_cleanup BEFORE DELETE ON guest_taste_sessions BEGIN SELECT RAISE(ABORT,'cleanup failed'); END;");
  try {
    await expect(runScheduledOnboardingDataLifecycle(env, { now })).rejects.toThrow();
    expect(await env.DB.prepare("SELECT count(*) n FROM product_events").first("n")).toBe(0);
    expect((await readAdminLifecycle(env.DB, now)).cleanup).toMatchObject({ status: "PARTIAL_OR_UNKNOWN", guestSessions: null, productEvents: null });
  } finally { await env.DB.exec("DROP TRIGGER reject_guest_cleanup;"); }
});
it("rejects non-admin readers and all manual cleanup POSTs", async () => {
  const member = await admin("USER"), allowed = await admin(), expired = await admin(), restricted = await admin();
  await env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(expired).run();
  const userId = await env.DB.prepare("SELECT user_id FROM sessions WHERE id=?").bind(restricted).first<string>("user_id");
  const at = new Date().toISOString(), later = new Date(Date.now() + 3_600_000).toISOString();
  await env.DB.prepare("INSERT INTO member_access_restrictions(user_id,version,reason,starts_at,expires_at,updated_at) VALUES(?,1,'fixture',?,?,?)")
    .bind(userId, at, later, at).run();
  for (const [sid, status] of [[undefined, 302], [member, 403], [expired, 302], [restricted, 302]] as const) {
    const response = await loader({ request: new Request("https://lifecycle.test/admin/lifecycle", { headers: sid ? { Cookie: `retaste_session=${sid}` } : {} }) } as never).catch((error) => error);
    expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
  const response = await action({ request: new Request("https://lifecycle.test/admin/lifecycle", { method: "POST", headers: { Cookie: `retaste_session=${allowed}` } }) } as never);
  expect(response.status).toBe(405);
});
