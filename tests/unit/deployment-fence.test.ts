import { describe, expect, it, vi } from "vitest";
import { isDeploymentFenced, withDeploymentFence } from "../../app/features/operations/deployment-fence";

describe("deployment fence", () => {
  const ctx = {} as ExecutionContext;
  it.each(["true", "", "TRUE", "typo", null, false])("closes unexpected configured value %s", (value) => {
    expect(isDeploymentFenced(value)).toBe(true);
  });
  it.each([undefined, "false"])("allows compatible value %s", (value) => {
    expect(isDeploymentFenced(value)).toBe(false);
  });
  it("blocks all application methods before delegates, including token/admin paths", async () => {
    const fetch = vi.fn(async () => new Response("application"));
    const scheduled = vi.fn();
    const worker = withDeploymentFence({ fetch, scheduled });
    for (const [path, method] of [["/", "GET"], ["/admin", "POST"], ["/internal/rsi-self-check", "GET"], ["/reviewer-photos/private", "HEAD"], ["/places/x", "DELETE"]]) {
      const response = await worker.fetch!(new Request(`https://example.com${path}`, { method }), { CST_MAINTENANCE: "true" }, ctx);
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Retry-After")).toBe("60");
      if (method === "HEAD") expect(await response.text()).toBe("");
    }
    expect(fetch).not.toHaveBeenCalled();
    for (const cron of ["47 */6 * * *", "17 18 * * *"]) {
      await worker.scheduled!({ cron } as ScheduledController, { CST_MAINTENANCE: "true" }, ctx);
    }
    expect(scheduled).not.toHaveBeenCalled();
  });
  it("preserves the normal fetch and scheduled handlers", async () => {
    const response = new Response("application");
    const fetch = vi.fn(async () => response);
    const scheduled = vi.fn();
    const worker = withDeploymentFence({ fetch, scheduled });
    const request = new Request("https://example.com/");
    const env = { CST_MAINTENANCE: "false" };
    expect(await worker.fetch!(request, env, ctx)).toBe(response);
    expect(fetch).toHaveBeenCalledWith(request, env, ctx);
    const controller = { cron: "47 */6 * * *" } as ScheduledController;
    await worker.scheduled!(controller, env, ctx);
    expect(scheduled).toHaveBeenCalledWith(controller, env, ctx);
  });
});
