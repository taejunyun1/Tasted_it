import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  destroyUserSession: vi.fn(async () => {
    throw new Error("session should not be destroyed");
  }),
}));

vi.mock("../../app/features/auth/session.server", () => ({
  destroyUserSession: sessionMocks.destroyUserSession,
}));

const memberMutationRoutes = [
  "app/routes/place-detail.tsx",
  "app/routes/me.tsx",
  "app/routes/logout.tsx",
  "app/routes/place-suggest.tsx",
  "app/routes/place-correction.tsx",
  "app/routes/taste-onboarding.tsx",
  "app/routes/reviewer-apply.tsx",
  "app/routes/reviewer-ratings.tsx",
] as const;

describe("member POST same-origin", () => {
  it.each(memberMutationRoutes)("%s rejects cross-origin mutations before writing", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("isSameOriginMutation");
    expect(source).toContain("status: 403");
    expect(source).toContain("FORBIDDEN");
  });

  it("reviewer rating publish reuses the shared same-origin helper", () => {
    const source = readFileSync("app/features/ratings/reviewer-visit-publish.server.ts", "utf8");
    expect(source).toContain("isSameOriginMutation");
    expect(source).not.toContain("function hasSameOrigin");
  });

  it("logout throws 403 for a foreign origin before destroying the session", async () => {
    const { action } = await import("../../app/routes/logout");
    await expect(action({
      request: new Request("https://retaste.test/logout", {
        method: "POST",
        headers: { Origin: "https://elsewhere.invalid" },
      }),
    } as never)).rejects.toMatchObject({ status: 403, statusText: "FORBIDDEN" });
    expect(sessionMocks.destroyUserSession).not.toHaveBeenCalled();
  });

  it("logout throws 403 when Origin is missing", async () => {
    const { action } = await import("../../app/routes/logout");
    await expect(action({
      request: new Request("https://retaste.test/logout", { method: "POST" }),
    } as never)).rejects.toMatchObject({ status: 403, statusText: "FORBIDDEN" });
    expect(sessionMocks.destroyUserSession).not.toHaveBeenCalled();
  });
});
