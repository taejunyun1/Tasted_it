import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { grantAdminAssurance } from "../../app/features/auth/admin-assurance.server";
import { action } from "../../app/routes/admin-ratings";

it("requires real recent-auth evidence between integrity preview and atomic confirmation", async () => {
  const actor = crypto.randomUUID(), sessionId = crypto.randomUUID(), caseId = crypto.randomUUID();
  const now = new Date(), at = now.toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,'Synthetic admin','ADMIN',?,?,?)")
    .bind(actor, `${actor}@example.test`, at, at, at).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)")
    .bind(sessionId, actor, at, new Date(now.getTime() + 3600_000).toISOString()).run();
  await env.DB.prepare("INSERT INTO integrity_cases(id,signal_type,subject_type,subject_id,dedupe_key,status,evidence_json,created_at,updated_at) VALUES(?,'SYNTHETIC','USER',?,?,'OPEN','{}',?,?)")
    .bind(caseId, actor, caseId, at, at).run();
  const post = (fields: Record<string, string>) => action({
    request: new Request("https://example.test/admin/ratings", { method: "POST", headers: { Origin: "https://example.test", Cookie: `retaste_session=${sessionId}` }, body: new URLSearchParams(fields) }),
    params: {}, context: {},
  } as Parameters<typeof action>[0]);
  const preview = await post({ intent: "case", caseId, status: "CONFIRMED", reason: "합성 검증" });
  expect(preview).toMatchObject({ ok: true, integrityPreview: { caseId, status: "PENDING", nextStatus: "CONFIRMED" } });
  expect(await env.DB.prepare("SELECT status FROM integrity_cases WHERE id=?").bind(caseId).first("status")).toBe("OPEN");
  const operationId = (preview as { integrityPreview: { operationId: string } }).integrityPreview.operationId;
  const fields = { intent: "confirm-integrity", operationId, operationKind: "INTEGRITY_CASE_TRANSITION" };
  let denied: unknown;
  try { await post(fields); } catch (error) { denied = error; }
  expect(denied).toBeInstanceOf(Response);
  expect((denied as Response).headers.get("Location")).toContain("/admin/reauth?");
  expect(await env.DB.prepare("SELECT status FROM integrity_cases WHERE id=?").bind(caseId).first("status")).toBe("OPEN");
  // Local isolated fixture models successful password verification; no live credential is created.
  await grantAdminAssurance(env.DB, { actorUserId: actor, sessionId, method: "PASSWORD", now: new Date() });
  await env.DB.exec("CREATE TRIGGER fail_route_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='ADMIN_OPERATION_COMMITTED' BEGIN SELECT RAISE(ABORT,'synthetic unavailable'); END;");
  try {
    expect(await post(fields)).toMatchObject({ ok: false, integrityRetry: { operationId, kind: "INTEGRITY_CASE_TRANSITION" } });
    expect(await env.DB.prepare("SELECT status FROM integrity_cases WHERE id=?").bind(caseId).first("status")).toBe("OPEN");
  } finally { await env.DB.exec("DROP TRIGGER fail_route_audit;"); }
  expect(await post(fields)).toMatchObject({ ok: true });
  expect(await env.DB.prepare("SELECT status FROM integrity_cases WHERE id=?").bind(caseId).first("status")).toBe("CONFIRMED");
  expect(await post(fields)).toMatchObject({ ok: true, message: "이미 반영된 요청의 결과를 확인했습니다." });
  expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE target_id=? AND action='ADMIN_OPERATION_COMMITTED'").bind(operationId).first("n")).toBe(1);
});
