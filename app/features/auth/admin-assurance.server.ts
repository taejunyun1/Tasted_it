import { sha256Hex } from "./google-oauth.server";
import { verifyPassword } from "./password.server";

export type AdminAssuranceMethod = "PASSWORD" | "EMAIL" | "GOOGLE" | "NAVER";
export type AdminSession = { actorUserId: string; sessionId: string };
export const ADMIN_ASSURANCE_TTL_MS = 10 * 60 * 1000;

export async function getAdminAssurance(database: D1Database, input: AdminSession & { now: Date }) {
  return database.prepare(`SELECT a.method, a.verified_at AS verifiedAt, a.expires_at AS expiresAt
    FROM admin_session_assurances a JOIN sessions s ON s.id = a.session_id
    JOIN users u ON u.id = a.actor_user_id
    WHERE a.session_id = ? AND a.actor_user_id = ? AND s.user_id = u.id
      AND u.role = 'ADMIN' AND s.expires_at > ? AND a.verified_at <= ? AND a.expires_at > ?`)
    .bind(input.sessionId, input.actorUserId, input.now.toISOString(), input.now.toISOString(), input.now.toISOString())
    .first<{ method: AdminAssuranceMethod; verifiedAt: string; expiresAt: string }>();
}

export async function requireAdminAssurance(database: D1Database, input: AdminSession & { now: Date }) {
  const assurance = await getAdminAssurance(database, input);
  if (!assurance) throw new Error("ADMIN_REAUTH_REQUIRED");
  return assurance;
}

export async function grantAdminAssurance(database: D1Database, input: AdminSession & { method: AdminAssuranceMethod; now: Date }) {
  const now = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + ADMIN_ASSURANCE_TTL_MS).toISOString();
  const result = await database.prepare(`INSERT INTO admin_session_assurances
    (session_id, actor_user_id, method, verified_at, expires_at)
    SELECT s.id, u.id, ?, ?, ? FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND u.id = ? AND u.role = 'ADMIN' AND s.expires_at > ?
    ON CONFLICT(session_id) DO UPDATE SET actor_user_id = excluded.actor_user_id,
      method = excluded.method, verified_at = excluded.verified_at, expires_at = excluded.expires_at`)
    .bind(input.method, now, expiresAt, input.sessionId, input.actorUserId, now).run();
  if (result.meta.changes !== 1) throw new Error("ADMIN_SESSION_INVALID");
  return { expiresAt };
}

export async function reauthenticateAdminPassword(database: D1Database, input: AdminSession & { password: string; now: Date }) {
  const row = await database.prepare(`SELECT u.password_hash AS hash, u.password_salt AS salt
    FROM users u JOIN sessions s ON s.user_id = u.id
    WHERE u.id = ? AND u.role = 'ADMIN' AND s.id = ? AND s.expires_at > ?`)
    .bind(input.actorUserId, input.sessionId, input.now.toISOString()).first<{ hash: string | null; salt: string | null }>();
  if (!row?.hash || !row.salt || !await verifyPassword(input.password, row.hash, row.salt)) {
    throw new Error("ADMIN_CREDENTIAL_INVALID");
  }
  return grantAdminAssurance(database, { ...input, method: "PASSWORD" });
}

export async function createAdminEmailChallenge(database: D1Database, input: AdminSession & { now: Date }) {
  const user = await database.prepare(`SELECT u.email FROM users u JOIN sessions s ON s.user_id = u.id
    WHERE u.id = ? AND u.role = 'ADMIN' AND u.email_verified_at IS NOT NULL
    AND s.id = ? AND s.expires_at > ?`).bind(input.actorUserId, input.sessionId, input.now.toISOString()).first<{ email: string }>();
  if (!user) throw new Error("ADMIN_SESSION_INVALID");
  const id = crypto.randomUUID();
  const number = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const code = String(number % 100_000_000).padStart(8, "0");
  const now = input.now.toISOString();
  const issued = await database.batch([
    database.prepare("DELETE FROM admin_reauth_challenges WHERE session_id = ? AND method = 'EMAIL' AND created_at <= ?")
      .bind(input.sessionId, new Date(input.now.getTime() - 60_000).toISOString()),
    database.prepare(`INSERT INTO admin_reauth_challenges (id, session_id, actor_user_id, method, token_hash, created_at, expires_at)
      SELECT ?, ?, ?, 'EMAIL', ?, ?, ? WHERE NOT EXISTS
        (SELECT 1 FROM admin_reauth_challenges WHERE session_id = ? AND method = 'EMAIL')`)
      .bind(id, input.sessionId, input.actorUserId, await sha256Hex(`${id}:${code}`), now, new Date(input.now.getTime() + ADMIN_ASSURANCE_TTL_MS).toISOString(), input.sessionId),
  ]);
  if (issued[1]!.meta.changes !== 1) throw new Error("ADMIN_EMAIL_COOLDOWN");
  return { id, code, email: user.email };
}

export async function consumeAdminEmailChallenge(database: D1Database, input: AdminSession & { id: string; code: string; now: Date }) {
  if (!/^\d{8}$/.test(input.code)) throw new Error("ADMIN_CREDENTIAL_INVALID");
  const consumed = await database.prepare(`UPDATE admin_reauth_challenges SET consumed_at = ?
    WHERE id = ? AND session_id = ? AND actor_user_id = ? AND method = 'EMAIL'
    AND token_hash = ? AND expires_at > ? AND consumed_at IS NULL`)
    .bind(input.now.toISOString(), input.id, input.sessionId, input.actorUserId, await sha256Hex(`${input.id}:${input.code}`), input.now.toISOString()).run();
  if (consumed.meta.changes !== 1) throw new Error("ADMIN_CREDENTIAL_INVALID");
  return grantAdminAssurance(database, { ...input, method: "EMAIL" });
}
