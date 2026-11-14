import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("restricted password login returns private full-document HTML", async ({ request, baseURL }, testInfo) => {
  const userId = `e2e-onboarding-${testInfo.project.name}`;
  const local = (statement: string) => execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.e2e.jsonc", "--persist-to", ".wrangler/e2e-state", "--command", statement], { stdio: "pipe" });
  local(`INSERT INTO member_access_restrictions (user_id,version,reason,starts_at,expires_at,updated_by,updated_at)
    VALUES ('${userId}',1,'synthetic HTTP regression',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'),'qa-admin',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
  try {
    const response = await request.post("/login", {
      maxRedirects: 0,
      headers: { Origin: new URL(baseURL!).origin, Accept: "text/html" },
      form: { email: `${userId}@retaste.local`, password: "local-onboarding-password" },
    });
    expect(response.status()).toBe(403);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["vary"].toLowerCase().split(/\s*,\s*/)).toContain("cookie");
    expect(await response.text()).toContain("계정 접근이 제한");
  } finally {
    local(`DELETE FROM member_access_restrictions WHERE user_id='${userId}'`);
  }
});
