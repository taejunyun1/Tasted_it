import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isControlledLocalBaseUrl } from "./local-test-target";

export function correctionFlowFixture(baseURL: string, project: string) {
  if (!isControlledLocalBaseUrl(baseURL) || !/^[a-z0-9-]+$/.test(project)) throw new Error("S07_LOCAL_FIXTURE_ONLY");
  const id = `qa-s07-${project}`, email = `${id}@example.test`;
  const originalName = `S07 합성 식당 ${project}`, updatedName = `S07 확인된 상호 ${project}`;
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  function sql<T = Record<string, unknown>>(query: string): T[] {
    const result = JSON.parse(execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--json", "--command", query], { encoding: "utf8" })) as Array<{ results: T[] }>;
    return result.flatMap(item => item.results);
  }
  function cleanup() {
    const bucket = createHash("sha256").update(`mail-rate-limit:email:PLACE_CORRECTION:${email}`).digest("hex");
    sql(`DELETE FROM admin_audit_logs WHERE target_id=${quote(id)} OR target_id IN (SELECT id FROM place_correction_requests WHERE requester_email=${quote(email)});
      DELETE FROM place_revisions WHERE place_id=${quote(id)};
      DELETE FROM place_correction_requests WHERE requester_email=${quote(email)};
      DELETE FROM place_categories WHERE place_id=${quote(id)};
      DELETE FROM places WHERE id=${quote(id)};
      DELETE FROM rate_limit_windows WHERE bucket_hash=${quote(bucket)};`);
  }
  function create() {
    cleanup();
    sql(`INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
      VALUES(${quote(id)},${quote(id)},${quote(originalName)},'PUBLISHED','광주광역시 동구 합성로 7','합성동',35.15,126.92,${quote(originalName)},'2026-11-18T00:00:00Z','2026-11-18T00:00:00Z');
      INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(${quote(id)},'cat-ramen',1);`);
  }
  return {
    id, email, originalName, updatedName, create, cleanup,
    place: () => sql<{ name: string; status: string }>(`SELECT name,status FROM places WHERE id=${quote(id)}`)[0]!,
    request: () => sql<{ id: string; status: string; verified_at: string | null; admin_response: string | null }>(`SELECT id,status,verified_at,admin_response FROM place_correction_requests WHERE requester_email=${quote(email)}`)[0],
    revisionCount: () => sql<{ total: number }>(`SELECT COUNT(*) AS total FROM place_revisions WHERE place_id=${quote(id)} AND action='CORRECTION'`)[0]!.total,
  };
}
