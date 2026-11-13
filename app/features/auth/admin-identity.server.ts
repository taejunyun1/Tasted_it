import { sha256Hex } from "./google-oauth.server";
import type { AdminSession } from "./admin-assurance.server";
import { commitAdminOperation, getAdminOperation, prepareAdminOperation } from "../operations/admin-operation.server";

type Role = "USER" | "REVIEWER" | "ADMIN";
type IdentityAction = "GRANT_ADMIN" | "REVOKE_ADMIN" | "REVOKE_SESSIONS";
type IdentityPayload = {
  targetUserId: string; action: IdentityAction; expectedRole: Role; expectedUpdatedAt: string;
  nextRole: Role; sessionRefs: string[];
};
type UserRow = { id: string; displayName: string; email: string; role: Role; updatedAt: string; verified: number };
type SessionRow = { id: string; createdAt: string; expiresAt: string };

async function sessionRef(id: string) { return sha256Hex(`admin-session-reference:${id}`); }
async function targetSessions(database: D1Database, userId: string, now: Date) {
  return (await database.prepare("SELECT id, created_at AS createdAt, expires_at AS expiresAt FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at, id")
    .bind(userId, now.toISOString()).all<SessionRow>()).results;
}
async function userRow(database: D1Database, id: string) {
  return database.prepare(`SELECT id, display_name AS displayName, email, role, updated_at AS updatedAt,
    email_verified_at IS NOT NULL AS verified FROM users WHERE id = ? AND email NOT LIKE 'withdrawn.%@invalid.local'`)
    .bind(id).first<UserRow>();
}
export async function listAdminIdentities(database: D1Database, input: AdminSession & { search?: string; targetUserId?: string; now: Date }) {
  const search = (input.search ?? "").trim().slice(0, 100);
  const users = await database.prepare(`SELECT id, display_name AS displayName, email, role, updated_at AS updatedAt,
    email_verified_at IS NOT NULL AS verified FROM users
    WHERE email NOT LIKE 'withdrawn.%@invalid.local' AND email_verified_at IS NOT NULL AND (instr(lower(email), lower(?)) > 0 OR instr(lower(display_name), lower(?)) > 0)
    ORDER BY CASE role WHEN 'ADMIN' THEN 0 WHEN 'REVIEWER' THEN 1 ELSE 2 END, display_name, id LIMIT 50`).bind(search, search).all<UserRow>();
  const target = input.targetUserId ? await userRow(database, input.targetUserId) : null;
  const sessions = target ? await targetSessions(database, target.id, input.now) : [];
  return {
    users: users.results, target,
    sessions: await Promise.all(sessions.map(async (session) => ({
      ref: await sessionRef(session.id), createdAt: session.createdAt, expiresAt: session.expiresAt,
      isCurrent: session.id === input.sessionId,
    }))),
  };
}
export async function prepareAdminIdentityChange(database: D1Database, input: AdminSession & {
  targetUserId: string; action: IdentityAction; selectedSessionRef?: string; now: Date;
}) {
  const user = await userRow(database, input.targetUserId);
  if (!user || !user.verified) throw new Error("ADMIN_IDENTITY_INVALID");
  let nextRole = user.role;
  if (input.action !== "REVOKE_SESSIONS") {
    if (user.id === input.actorUserId) throw new Error("ADMIN_SELF_ROLE_CHANGE_FORBIDDEN");
    if (input.action === "GRANT_ADMIN") {
      if (user.role === "ADMIN") throw new Error("ADMIN_IDENTITY_STALE");
      nextRole = "ADMIN";
    } else {
      if (user.role !== "ADMIN") throw new Error("ADMIN_IDENTITY_STALE");
      const restoration = await database.prepare(`SELECT r.previous_role AS role FROM admin_role_restorations r
        WHERE r.user_id = ? AND (r.previous_role = 'USER' OR EXISTS
          (SELECT 1 FROM reviewer_profiles p WHERE p.user_id = r.user_id AND p.status = 'ACTIVE'))`)
        .bind(user.id).first<{ role: "USER" | "REVIEWER" }>();
      nextRole = restoration?.role ?? "USER";
    }
  }
  const sessions = (await targetSessions(database, user.id, input.now)).filter((session) => session.id !== input.sessionId);
  const available = await Promise.all(sessions.map((session) => sessionRef(session.id)));
  const refs = input.selectedSessionRef ? available.filter((ref) => ref === input.selectedSessionRef) : available;
  if (input.selectedSessionRef && refs.length !== 1) throw new Error("ADMIN_IDENTITY_STALE");
  if (input.action === "REVOKE_SESSIONS" && refs.length === 0) throw new Error("ADMIN_NO_SESSIONS");
  const payload: IdentityPayload = {
    targetUserId: user.id, action: input.action, expectedRole: user.role, expectedUpdatedAt: user.updatedAt,
    nextRole, sessionRefs: refs,
  };
  return prepareAdminOperation(database, {
    actorUserId: input.actorUserId, sessionId: input.sessionId, now: input.now.toISOString(),
    kind: input.action === "REVOKE_SESSIONS" ? "ADMIN_SESSIONS_REVOKE" : "ADMIN_ROLE_CHANGE",
    payload,
    summary: { title: input.action === "GRANT_ADMIN" ? "관리자 권한 부여" : input.action === "REVOKE_ADMIN" ? "관리자 권한 회수" : "로그인 세션 회수", count: 1 },
  });
}
export async function getAdminIdentityPreview(database: D1Database, input: AdminSession & { operationId: string; kind: "ADMIN_ROLE_CHANGE" | "ADMIN_SESSIONS_REVOKE"; now: Date }) {
  const op = await getAdminOperation(database, { ...input, now: input.now.toISOString() });
  const payload = op.payload as IdentityPayload;
  const user = await userRow(database, payload.targetUserId);
  return { operationId: op.id, action: payload.action, displayName: user?.displayName ?? "회원", beforeRole: payload.expectedRole, afterRole: payload.nextRole, sessionCount: payload.sessionRefs.length };
}
export async function commitAdminIdentityChange(database: D1Database, input: AdminSession & { operationId: string; kind: "ADMIN_ROLE_CHANGE" | "ADMIN_SESSIONS_REVOKE"; now: Date }) {
  return commitAdminOperation(database, { ...input, now: input.now.toISOString() }, async (operation) => {
    const payload = operation.payload as IdentityPayload;
    const sessions = await targetSessions(database, payload.targetUserId, input.now);
    const selected: SessionRow[] = [];
    for (const session of sessions) {
      if (session.id !== input.sessionId && payload.sessionRefs.includes(await sessionRef(session.id))) selected.push(session);
    }
    if (selected.length !== payload.sessionRefs.length) throw new Error("ADMIN_IDENTITY_STALE");
    if (payload.action !== "REVOKE_SESSIONS" && payload.targetUserId === input.actorUserId) throw new Error("ADMIN_SELF_ROLE_CHANGE_FORBIDDEN");
    const checks = [database.prepare(`INSERT INTO admin_operation_checks(operation_id, check_name, passed)
      SELECT ?, 'identity-version', CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = ? AND role = ? AND updated_at = ? AND email_verified_at IS NOT NULL) THEN 1 ELSE 0 END`)
      .bind(input.operationId, payload.targetUserId, payload.expectedRole, payload.expectedUpdatedAt)];
    const statements: D1PreparedStatement[] = [];
    if (payload.action !== "REVOKE_SESSIONS") {
      checks.push(database.prepare(`INSERT INTO admin_operation_checks(operation_id, check_name, passed)
        SELECT ?, 'session-count', CASE WHEN (SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires_at > ? AND id <> ?) = ? THEN 1 ELSE 0 END`)
        .bind(input.operationId, payload.targetUserId, input.now.toISOString(), input.sessionId, selected.length));
      if (payload.nextRole === "REVIEWER") checks.push(database.prepare(`INSERT INTO admin_operation_checks(operation_id, check_name, passed)
        SELECT ?, 'reviewer-status', CASE WHEN EXISTS (SELECT 1 FROM reviewer_profiles WHERE user_id = ? AND status = 'ACTIVE') THEN 1 ELSE 0 END`)
        .bind(input.operationId, payload.targetUserId));
    }
    if (payload.action === "GRANT_ADMIN") {
      statements.push(database.prepare(`INSERT INTO admin_role_restorations(user_id, previous_role) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET previous_role = excluded.previous_role`).bind(payload.targetUserId, payload.expectedRole));
    }
    if (payload.action !== "REVOKE_SESSIONS") {
      statements.push(database.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
        .bind(payload.nextRole, input.now.toISOString(), payload.targetUserId));
      if (payload.action === "REVOKE_ADMIN") statements.push(database.prepare("DELETE FROM admin_role_restorations WHERE user_id = ?").bind(payload.targetUserId));
    }
    for (const session of selected) {
      checks.push(database.prepare(`INSERT INTO admin_operation_checks(operation_id, check_name, passed)
        SELECT ?, ?, CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ?) THEN 1 ELSE 0 END`)
        .bind(input.operationId, `session-${await sessionRef(session.id)}`, session.id, payload.targetUserId));
      statements.push(database.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ? AND id <> ?")
        .bind(session.id, payload.targetUserId, input.sessionId));
    }
    if (payload.action !== "REVOKE_SESSIONS") statements.push(database.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").bind(payload.targetUserId, input.sessionId));
    return { checks, statements, result: { action: payload.action, targetUserId: payload.targetUserId, role: payload.nextRole, revokedSessions: selected.length } };
  });
}
