import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { action, loader } from "../../app/routes/admin-reviewers";

async function session(role: "ADMIN" | "USER") {
  const userId = crypto.randomUUID(), sessionId = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .bind(userId, `${userId}@example.test`, "합성 계정", role, now, now, now).run();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(sessionId, userId, "2099-01-01T00:00:00.000Z", now).run();
  return { userId, sessionId, now };
}
function request(sessionId?: string, body?: string, origin = "https://reviewer.test") {
  return new Request("https://reviewer.test/admin/reviewers", { method: body === undefined ? "GET" : "POST",
    headers: { ...(sessionId ? { Cookie: `retaste_session=${sessionId}` } : {}), ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }) }, body });
}
describe("reviewer admin route", () => {
  it("denies anonymous/member and cross-origin requests without preparing changes", async () => {
    await expect(loader({ request: request() } as never)).rejects.toMatchObject({ status: 302 });
    const member = await session("USER"), admin = await session("ADMIN");
    await expect(loader({ request: request(member.sessionId) } as never)).rejects.toMatchObject({ status: 403 });
    const before = await env.DB.prepare("SELECT count(*) AS n FROM admin_operations").first("n");
    expect((await action({ request: request(admin.sessionId, "intent=prepare&change=AUTO_DORMANCY&reason=", "https://other.test") } as never)).init?.status).toBe(403);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM admin_operations").first("n")).toBe(before);
  });
  it("rejects old direct intents, duplicate fields and oversized forms", async () => {
    const admin = await session("ADMIN");
    const put = await action({ request: new Request(request(admin.sessionId, "intent=prepare&change=AUTO_DORMANCY&reason="), { method: "PUT" }) } as never);
    expect((put as Response).status).toBe(405); expect((put as Response).headers.get("Allow")).toBe("POST");
    for (const body of ["intent=APPROVE&applicationId=legacy", "intent=prepare&change=ACTIVE&change=DORMANT&reason=x", `intent=prepare&reason=${"a".repeat(17000)}`]) {
      const result = await action({ request: request(admin.sessionId, body) } as never);
      expect(result.init?.status).toBe(400);
    }
  });
  it("shows separate evidence counts and routes confirmation through reauthentication", async () => {
    const admin = await session("ADMIN"), applicant = await session("USER"), applicationId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO reviewer_applications(id,user_id,status,statement,occupation,taste_direction,region_code,specialty_slugs,approved_suggestion_count,created_at,updated_at)
      VALUES(?,?,'APPLIED','합성 신청','시험','취향','GWANGJU','[]',10,?,?)`).bind(applicationId, applicant.userId, admin.now, admin.now).run();
    const prepared = await action({ request: request(admin.sessionId, new URLSearchParams({ intent: "prepare", change: "APPROVE", targetIds: applicationId, reason: "" }).toString()) } as never);
    expect(prepared).toBeInstanceOf(Response);
    const location = (prepared as Response).headers.get("Location")!;
    const operationId = new URL(location, "https://reviewer.test").searchParams.get("operation")!;
    const page = await loader({ request: new Request(`https://reviewer.test${location}`, { headers: { Cookie: `retaste_session=${admin.sessionId}` } }) } as never);
    expect(page.data.preview).toMatchObject({ committed: false, items: [expect.objectContaining({ submittedCount: 10, currentCount: 0 })] });
    expect(JSON.stringify(page.data)).not.toContain(applicant.sessionId);
    const confirm = await action({ request: request(admin.sessionId, new URLSearchParams({ intent: "commit", operationId }).toString()) } as never);
    expect((confirm as Response).headers.get("Location")).toContain("/admin/reauth?returnTo=");
    expect(await env.DB.prepare("SELECT status FROM reviewer_applications WHERE id=?").bind(applicationId).first("status")).toBe("APPLIED");
  });
});
