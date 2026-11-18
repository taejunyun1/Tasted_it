import { execFileSync } from "node:child_process";
import { isControlledLocalBaseUrl } from "./local-test-target";

export function voteOutcomesFixture(baseURL: string, project: string) {
  if (!isControlledLocalBaseUrl(baseURL) || !/^[a-z0-9-]+$/.test(project)) throw new Error("U05_LOCAL_FIXTURE_ONLY");
  const id = `qa-u05-${project}`;
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  function sql<T = Record<string, unknown>>(query: string): T[] {
    const result = JSON.parse(execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--json", "--command", query], { encoding: "utf8" })) as Array<{ results: T[] }>;
    return result.flatMap(item => item.results);
  }
  function cleanup() {
    const events = sql<{ id: string }>(`SELECT id FROM vote_events WHERE user_id=${quote(id)} ORDER BY rowid DESC`);
    sql(`DELETE FROM current_votes WHERE user_id=${quote(id)};
      DELETE FROM recommendation_feedback WHERE user_id=${quote(id)};
      DELETE FROM user_taste_badges WHERE user_id=${quote(id)};
      DELETE FROM taste_learning_states WHERE user_id=${quote(id)};
      ${events.map(event => `DELETE FROM vote_events WHERE id=${quote(event.id)};`).join("\n")}
      DELETE FROM rating_recompute_jobs WHERE place_id=${quote(id)};
      DELETE FROM saved_places WHERE user_id=${quote(id)};
      DELETE FROM sessions WHERE user_id=${quote(id)};
      DELETE FROM users WHERE id=${quote(id)};
      DELETE FROM place_categories WHERE place_id=${quote(id)};
      DELETE FROM places WHERE id=${quote(id)};`);
  }
  function create() {
    cleanup();
    sql(`INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES(${quote(id)},${quote(`${id}@example.test`)},'합성 투표 회원','USER','2026-11-18T00:00:00Z','2026-11-18T00:00:00Z');
      INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(${quote(id)},${quote(id)},'2099-01-01T00:00:00Z','2026-11-18T00:00:00Z');
      INSERT INTO places(id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at)
      VALUES(${quote(id)},${quote(id)},'U05 합성 식당','PUBLISHED','광주광역시 동구 합성로 5','합성동',35.15,126.92,'U05 합성 식당','2026-11-18T00:00:00Z','2026-11-18T00:00:00Z');
      INSERT INTO place_categories(place_id,category_id,is_primary) VALUES(${quote(id)},'cat-ramen',1);`);
  }
  return { id, create, cleanup,
    state: () => sql<{ value: number }>(`SELECT value FROM current_votes WHERE user_id=${quote(id)} AND place_id=${quote(id)}`)[0]?.value ?? null,
    events: () => sql<{ event_type: string; value: number }>(`SELECT event_type,value FROM vote_events WHERE user_id=${quote(id)} AND place_id=${quote(id)} ORDER BY rowid`),
  };
}
