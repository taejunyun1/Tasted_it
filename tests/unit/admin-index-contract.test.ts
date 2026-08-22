import { readFileSync } from "node:fs";
import { redirect } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/features/auth/session.server", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1", role: "ADMIN" })),
}));

const routes = readFileSync("app/routes.ts", "utf8");
const adminIndex = readFileSync("app/routes/admin-index.tsx", "utf8");

describe("admin index route", () => {
  it("registers /admin instead of leaving the path as a 404", () => {
    expect(routes).toContain('route("admin", "routes/admin-index.tsx")');
  });

  it("redirects the index into existing place-operations, not a new dashboard", async () => {
    expect(adminIndex).not.toContain("ops-dashboard");
    const { loader } = await import("../../app/routes/admin-index");
    await expect(loader({ request: new Request("https://retaste.invalid/admin") } as never))
      .rejects.toThrow(redirect("/admin/place-operations"));
  });
});

