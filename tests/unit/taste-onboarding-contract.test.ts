import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

const mocks = vi.hoisted(() => ({
  env: { DB: {}, ONBOARDING_ENABLED: "true" },
  getOptionalUser: vi.fn(async () => null),
  getOrCreateGuestSession: vi.fn(async () => ({ session: { id: "guest-1" }, setCookie: null })),
  getGuestOnboarding: vi.fn(async () => ({
    sessionId: "guest-1",
    step: "LOCATION",
    locationMode: "DEFAULT",
    foodBadgeIds: [],
    styleBadgeIds: [],
    expiresAt: "2026-09-09T00:00:00.000Z",
    completedAt: null,
    skippedAt: null,
  })),
  saveGuestOnboarding: vi.fn(async () => undefined),
  db: { update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })) },
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("../../app/db/client.server", () => ({ createDb: () => mocks.db }));
vi.mock("../../app/features/auth/session.server", () => ({ getOptionalUser: mocks.getOptionalUser }));
vi.mock("../../app/features/onboarding/guest-session.server", () => ({
  getOrCreateGuestSession: mocks.getOrCreateGuestSession,
  getGuestOnboarding: mocks.getGuestOnboarding,
  saveGuestOnboarding: mocks.saveGuestOnboarding,
}));

afterEach(() => {
  mocks.env.ONBOARDING_ENABLED = "true";
  mocks.saveGuestOnboarding.mockReset();
  mocks.saveGuestOnboarding.mockResolvedValue(undefined);
});

describe("taste onboarding contract", () => {
  it("registers the route and exposes pressed badge buttons", () => {
    expect(fs.readFileSync("app/routes.ts", "utf8")).toContain('route("onboarding/taste", "routes/taste-onboarding.tsx")');
    const component = fs.readFileSync("app/components/onboarding/TasteOnboarding.tsx", "utf8");
    expect(component).toContain("aria-pressed");
    expect(component).toContain("나중에 할게요");
    expect(component).toContain("44px");
  });

  it("submits and restores exactly one onboarding step at a time", async () => {
    const component = await import("../../app/components/onboarding/TasteOnboarding");
    expect(component.nextOnboardingStep).toBeTypeOf("function");

    const submitted = new FormData();
    submitted.set("step", component.nextOnboardingStep("LOCATION"));
    expect(submitted.get("step")).toBe("FOOD");

    const reenteredStep = submitted.get("step") as "FOOD";
    expect(component.nextOnboardingStep(reenteredStep)).toBe("STYLE");
    expect(fs.readFileSync("app/components/onboarding/TasteOnboarding.tsx", "utf8"))
      .not.toContain("onClick={() => setStep(nextStep)}");
  });

  it("announces step progress with progressbar semantics", () => {
    const component = fs.readFileSync("app/components/onboarding/TasteOnboarding.tsx", "utf8");
    expect(component).toContain('role="progressbar"');
    expect(component).toContain("aria-valuenow");
    expect(component).toContain("headingRef.current?.focus()");
  });

  it.each(["//evil.example/path", "/\\evil.example/path", "/%5Cevil.example/path", "https://evil.example/path"])(
    "loader rejects malicious returnTo %s",
    async (returnTo) => {
      mocks.env.ONBOARDING_ENABLED = "false";
      const { loader } = await import("../../app/routes/taste-onboarding");
      const response = await loader({ request: new Request(`https://retaste.example/onboarding/taste?returnTo=${encodeURIComponent(returnTo)}`) } as never);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).headers.get("Location")).toBe("/places");
    },
  );

  it("action rejects a malicious returnTo before redirecting", async () => {
    const { action } = await import("../../app/routes/taste-onboarding");
    const form = new FormData();
    form.set("intent", "COMPLETE");
    form.set("step", "PREVIEW");
    form.set("returnTo", "/%5Cevil.example/path");
    const response = await action({ request: new Request("https://retaste.example/onboarding/taste", { method: "POST", body: form }) } as never);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/places");
  });

  it("returns 400 for outdated badge IDs without masking unexpected failures", async () => {
    const { action } = await import("../../app/routes/taste-onboarding");
    const request = () => {
      const form = new FormData();
      form.set("intent", "SAVE_STEP");
      form.set("step", "FOOD");
      form.append("foodBadgeId", "food-outdated");
      return new Request("https://retaste.example/onboarding/taste", { method: "POST", body: form });
    };

    mocks.saveGuestOnboarding.mockRejectedValueOnce(new Error("GUEST_ONBOARDING_BADGES_INVALID"));
    const invalid = await action({ request: request() } as never);
    expect(invalid).toMatchObject({ init: { status: 400 } });

    mocks.saveGuestOnboarding.mockRejectedValueOnce(new Error("D1_UNAVAILABLE"));
    await expect(action({ request: request() } as never)).rejects.toThrow("D1_UNAVAILABLE");
  });
});
