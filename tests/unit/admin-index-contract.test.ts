import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1", role: "ADMIN" })),
  getAdminHomeSummary: vi.fn(async () => ({
    catalog: { published: 1, hidden: 0, draft: 0 },
    reviewQueue: { active: 0, onHold: 0 },
    openAlerts: { count: 0, limit: 100, capped: false },
  })),
}));
vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));
vi.mock("../../app/db/client.server", () => ({ createDb: () => ({}) }));
vi.mock("../../app/features/auth/session.server", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("../../app/features/operations/admin-home.server", () => ({
  getAdminHomeSummary: mocks.getAdminHomeSummary,
}));

const routes = readFileSync("app/routes.ts", "utf8");

describe("admin index route", () => {
  it("registers /admin instead of leaving the path as a 404", () => {
    expect(routes).toContain('route("admin", "routes/admin-index.tsx")');
  });

  it("returns the operational summary after the admin guard instead of redirecting", async () => {
    const { loader } = await import("../../app/routes/admin-index");
    const result = await loader({ request: new Request("https://retaste.invalid/admin") } as never);
    expect(result.data).toMatchObject({ state: "AVAILABLE", area: "all", summary: { catalog: { published: 1 } } });
    expect(new Headers(result.init?.headers).get("Cache-Control")).toBe("private, no-store");
    expect(mocks.requireAdmin.mock.invocationCallOrder[0]).toBeLessThan(mocks.getAdminHomeSummary.mock.invocationCallOrder[0]);
  });
});

