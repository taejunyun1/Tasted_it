import { createDb } from "../../db/client.server";
import { assertMemberAccess } from "../auth/member-access.server";
import { isWithdrawnEmail } from "../auth/withdraw";
import { requireAdminAssurance } from "../auth/admin-assurance.server";
import { parseActivityQuery } from "./admin-activity";
import { readAdminActivity } from "./admin-activity.server";
import { encodeExportCursor, serializeActivityCsv, type ExportQuery } from "./admin-records";

export async function exportAdminActivity(database: D1Database, input: {
  actorUserId: string; sessionId: string; now: string; query: ExportQuery;
}) {
  const { actorUserId, sessionId, now, query } = input;
  const user = await database.prepare(`SELECT u.email FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE u.id=? AND s.id=? AND u.role='ADMIN' AND s.expires_at>?`)
    .bind(actorUserId, sessionId, now).first<{ email: string }>();
  if (!user || isWithdrawnEmail(user.email)) throw new Error("ADMIN_REQUIRED");
  await assertMemberAccess(createDb(database), actorUserId, now);
  await requireAdminAssurance(database, { actorUserId, sessionId, now: new Date(now) });
  const params = new URLSearchParams({ view: query.view, kind: query.kind });
  if (query.activityCursor) params.set("cursor", query.activityCursor);
  const activityQuery = parseActivityQuery(params, now);
  const result = await readAdminActivity(database, activityQuery, now, { from: query.from, to: query.to, pageSize: query.limit });
  const nextCursor = result.nextCursor ? encodeExportCursor(query, result.nextCursor) : null;
  const exportId = crypto.randomUUID();
  // Authorize again in the audit write: an auth/audit failure must never release CSV data.
  const audit = await database.prepare(`INSERT INTO admin_audit_logs
    (id,actor_user_id,action,target_type,target_id,after_state,created_at)
    SELECT ?,?,'ADMIN_AUDIT_EXPORT','ADMIN_EXPORT',?,?,?
    WHERE EXISTS (SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id
      JOIN admin_session_assurances a ON a.session_id=s.id AND a.actor_user_id=u.id
      WHERE u.id=? AND s.id=? AND u.role='ADMIN' AND u.email=? AND s.expires_at>?
        AND a.verified_at<=? AND a.expires_at>?
        AND NOT EXISTS (SELECT 1 FROM member_access_restrictions r WHERE r.user_id=u.id
          AND r.lifted_at IS NULL AND r.starts_at<=? AND r.expires_at>?))`)
    .bind(exportId, actorUserId, exportId, JSON.stringify({ view: query.view, kind: query.kind,
      from: query.from, toExclusive: query.to, limit: query.limit, rowCount: result.rows.length,
      truncated: Boolean(nextCursor), cutoff: result.cutoff }), now,
    actorUserId, sessionId, user.email, now, now, now, now, now).run();
  if (audit.meta.changes !== 1) throw new Error("ADMIN_EXPORT_UNAVAILABLE");
  const toDate = new Date(Date.parse(query.to) - 86_400_000).toISOString().slice(0, 10);
  return { exportId, csv: serializeActivityCsv(result.rows), rowCount: result.rows.length, nextCursor,
    cutoff: result.cutoff, truncated: Boolean(nextCursor),
    filename: `retaste-admin-${query.view}-${query.from.slice(0, 10)}-${toDate}.csv`,
    filters: { from: query.from.slice(0, 10), to: toDate,
      view: query.view, kind: query.kind, limit: String(query.limit) } };
}
