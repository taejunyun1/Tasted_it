import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { readAdminRatingConfig } from "../../app/features/ratings/admin-rating-config.server";
import { loader, action } from "../../app/routes/admin-rating-config";
import { RATING_V2_VERSION } from "../../app/features/ratings/rating-v2";

async function session(role: "USER" | "ADMIN") {
  const id = crypto.randomUUID(), sid = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id, `${id}@example.test`, "합성 설정 검토", role, now, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sid, id, "2099-01-01T00:00:00.000Z", now).run();
  return sid;
}
const request = (sid?: string, query = "", method = "GET") => new Request(`https://retaste.test/admin/rating-config${query}`, { method, headers: sid ? { Cookie: `retaste_session=${sid}` } : {} });

describe("ADMIN rating config read-only comparison", () => {
  it("requires ADMIN for both read and unsupported writes", async () => {
    await expect(loader({ request: request() } as never)).rejects.toMatchObject({ status: 302 });
    const user = await session("USER");
    await expect(loader({ request: request(user) } as never)).rejects.toMatchObject({ status: 403 });
    await expect(action({ request: request(user, "", "POST") } as never)).rejects.toMatchObject({ status: 403 });
    const response = await action({ request: request(await session("ADMIN"), "", "POST") } as never);
    expect(response.status).toBe(405);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("separates current DB metadata from runtime policy while keeping a future version unselected", async () => {
    const now = "2026-11-18T00:00:00.000Z", future = `future-${crypto.randomUUID()}`;
    const current = await env.DB.prepare("SELECT id,minimum_visible_samples,alpha_prior,beta_prior,reviewer_max_share FROM rating_configs WHERE algorithm_version=?")
      .bind(RATING_V2_VERSION).first<{ id: string; minimum_visible_samples: number; alpha_prior: number; beta_prior: number; reviewer_max_share: number }>();
    if (!current) throw new Error("Current configuration fixture missing");
    await env.DB.prepare("UPDATE rating_configs SET minimum_visible_samples=12,alpha_prior=3,beta_prior=4,reviewer_max_share=0.5 WHERE id=?").bind(current.id).run();
    await env.DB.prepare("INSERT INTO rating_configs(id,algorithm_version,minimum_visible_samples,alpha_prior,beta_prior,reviewer_max_share,settings_json,active_from,created_at,updated_at) VALUES(?,?,12,3,4,0.5,?,'2090-01-01T00:00:00.000Z',?,?)")
      .bind(future, future, '{"secret":"must-not-return"}', now, now).run();
    try {
      const result = await readAdminRatingConfig(createDb(env.DB), now);
      expect(result.selectedConfigId).toBe(current.id);
      expect(result.fields.find(field => field.key === "minimumVisibleSamples")).toMatchObject({ runtimeValue: 8, selectedValue: 12, databaseConsumer: "REVIEWER_CONSENSUS" });
      expect(result.fields.find(field => field.key === "alphaPrior")).toMatchObject({ runtimeValue: 2, selectedValue: 3, databaseConsumer: "METADATA_ONLY" });
      expect(result.warnings).toContain("SELECTED_POLICY_DIFFERS");
      expect(result.warnings).not.toContain("SELECTED_FUTURE_CONFIG");
      expect(result.configs.find(config => config.id === future)).toMatchObject({ state: "FUTURE", selectedByRuntime: false, versionSupported: false });
      expect(JSON.stringify(result)).not.toContain("must-not-return");
    } finally {
      await env.DB.prepare("DELETE FROM rating_configs WHERE id=?").bind(future).run();
      await env.DB.prepare("UPDATE rating_configs SET minimum_visible_samples=?,alpha_prior=?,beta_prior=?,reviewer_max_share=? WHERE id=?")
        .bind(current.minimum_visible_samples, current.alpha_prior, current.beta_prior, current.reviewer_max_share, current.id).run();
    }
  });

  it("previews synthetic inputs without changing config, votes, snapshots or jobs", async () => {
    const before = await env.DB.prepare("SELECT (SELECT count(*) FROM rating_configs) configs,(SELECT count(*) FROM vote_events) votes,(SELECT count(*) FROM rating_snapshots) snapshots,(SELECT count(*) FROM rating_recompute_jobs) jobs").first();
    const result = await loader({ request: request(await session("ADMIN"), "?minimumVisibleSamples=7&alphaPrior=2&betaPrior=2&reviewerMaxShare=0.3&userPositive=7&userNegative=0&reviewerPositive=0&reviewerNegative=0") } as never);
    expect(result.data.preview).toMatchObject({ visibilityChanged: true, candidateScope: "SIMULATION" });
    expect(result.init?.headers).toMatchObject({ "Cache-Control": "private, no-store" });
    const after = await env.DB.prepare("SELECT (SELECT count(*) FROM rating_configs) configs,(SELECT count(*) FROM vote_events) votes,(SELECT count(*) FROM rating_snapshots) snapshots,(SELECT count(*) FROM rating_recompute_jobs) jobs").first();
    expect(after).toEqual(before);
  });

  it("rejects unknown, duplicate and oversized comparison input", async () => {
    const sid = await session("ADMIN");
    for (const query of ["?activate=true", "?userPositive=7&userPositive=8", `?x=${"a".repeat(3000)}`]) {
      await expect(loader({ request: request(sid, query) } as never)).rejects.toMatchObject({ status: 400 });
    }
  });
});
