import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { hashPassword } from "../../app/features/auth/password.server";
import { isControlledLocalBaseUrl } from "./local-test-target";

export function correctionFlowFixture(baseURL: string, project: string) {
  if (!isControlledLocalBaseUrl(baseURL) || !/^[a-z0-9-]+$/.test(project)) throw new Error("S07_LOCAL_FIXTURE_ONLY");
  const id = `qa-s07-${project}`, email = `${id}@example.test`;
  const originalName = `S07 합성 식당 ${project}`, updatedName = `S07 확인된 상호 ${project}`;
  const ipSuffix = randomUUID().slice(0, 8);
  const clientIp = `2001:db8:${ipSuffix.slice(0, 4)}:${ipSuffix.slice(4)}::1`;
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  function sql<T = Record<string, unknown>>(query: string): T[] {
    const result = JSON.parse(execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--json", "--command", query], { encoding: "utf8" })) as Array<{ results: T[] }>;
    return result.flatMap(item => item.results);
  }
  function cleanup() {
    const bucket = createHash("sha256").update(`mail-rate-limit:email:PLACE_CORRECTION:${email}`).digest("hex");
    const ipBucket = createHash("sha256").update(`mail-rate-limit:ip:PLACE_CORRECTION:${clientIp}`).digest("hex");
    sql(`DELETE FROM admin_audit_logs WHERE target_id=${quote(id)} OR target_id IN (SELECT id FROM place_correction_requests WHERE requester_email=${quote(email)});
      DELETE FROM place_revisions WHERE place_id=${quote(id)};
      DELETE FROM place_correction_requests WHERE requester_email=${quote(email)};
      DELETE FROM place_categories WHERE place_id=${quote(id)};
      DELETE FROM places WHERE id=${quote(id)};
      DELETE FROM rate_limit_windows WHERE bucket_hash IN (${quote(bucket)},${quote(ipBucket)});`);
  }
  function create() {
    cleanup();
    sql(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
      VALUES(${quote(id)},${quote(id)},${quote(originalName)},'PUBLISHED','광주광역시 동구 합성로 7','합성동',35.15,126.92,${quote(originalName)},'2026-11-18T00:00:00Z','2026-11-18T00:00:00Z');
      INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(${quote(id)},'cat-ramen',1);`);
  }
  async function createRecallOperator() {
    const admin = sql<{ password_hash: string | null; password_salt: string | null }>(
      "SELECT password_hash,password_salt FROM users WHERE id='qa-admin' AND email='qa-admin@retaste.local' AND role='ADMIN'",
    )[0];
    if (!admin) throw new Error("S07_QA_ADMIN_REQUIRED");
    const password = randomUUID();
    const { hash, salt } = await hashPassword(password);
    const sessionId = `${id}-${randomUUID()}`;
    const now = new Date().toISOString(), expires = new Date(Date.now() + 10 * 60_000).toISOString();
    sql(`INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(${quote(sessionId)},'qa-admin',${quote(now)},${quote(expires)});
      UPDATE users SET password_hash=${quote(hash)},password_salt=${quote(salt)} WHERE id='qa-admin';`);
    return {
      sessionId, password,
      cleanup() {
        const storedHash = admin.password_hash === null ? "NULL" : quote(admin.password_hash);
        const storedSalt = admin.password_salt === null ? "NULL" : quote(admin.password_salt);
        sql(`DELETE FROM admin_operations WHERE session_id=${quote(sessionId)} AND status='PENDING';
          DELETE FROM sessions WHERE id=${quote(sessionId)};
          UPDATE users SET password_hash=${storedHash},password_salt=${storedSalt}
          WHERE id='qa-admin' AND password_hash=${quote(hash)} AND password_salt=${quote(salt)};`);
      },
    };
  }
  function recallEvidence(operationId: string, correctionId: string) {
    return sql<{
      commits: number; placeAudits: number; correctionAudits: number; revisions: number; state: string;
    }>(`SELECT (SELECT COUNT(*) FROM admin_operation_commits WHERE operation_id=${quote(operationId)}) AS commits,
      (SELECT COUNT(*) FROM admin_audit_logs WHERE target_type='PLACE' AND target_id=${quote(id)} AND action='PLACE_ADMIN_RECALL') AS placeAudits,
      (SELECT COUNT(*) FROM admin_audit_logs
        WHERE target_type='CORRECTION_REQUEST' AND target_id=${quote(correctionId)} AND action='APPLY_CLOSURE_CORRECTION'
          AND json_extract(after_state,'$.status')='APPLIED'
          AND json_extract(after_state,'$.operationId')=${quote(operationId)}
          AND json_extract(after_state,'$.placeId')=${quote(id)}) AS correctionAudits,
      (SELECT COUNT(*) FROM place_revisions WHERE place_id=${quote(id)} AND action='STATUS_CHANGE'
        AND source_type='CORRECTION_REQUEST' AND source_id=${quote(correctionId)}
        AND json_extract(before_json,'$.status')='PUBLISHED' AND json_extract(after_json,'$.status')='HIDDEN'
        AND json_extract(after_json,'$.operationId')=${quote(operationId)}) AS revisions,
      (SELECT status FROM admin_operations WHERE id=${quote(operationId)}) AS state`)[0]!;
  }
  return {
    id, email, clientIp, originalName, updatedName, create, cleanup, createRecallOperator, recallEvidence,
    place: () => sql<{ name: string; status: string }>(`SELECT name,status FROM places WHERE id=${quote(id)}`)[0]!,
    request: () => sql<{ id: string; status: string; verified_at: string | null; admin_response: string | null; updated_at: string }>(`SELECT id,status,verified_at,admin_response,updated_at FROM place_correction_requests WHERE requester_email=${quote(email)}`)[0],
    revisionCount: () => sql<{ total: number }>(`SELECT COUNT(*) AS total FROM place_revisions WHERE place_id=${quote(id)} AND action='CORRECTION'`)[0]!.total,
  };
}
