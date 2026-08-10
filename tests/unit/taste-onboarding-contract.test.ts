import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("taste onboarding contract", () => {
  it("registers the route and exposes pressed badge buttons", () => {
    expect(fs.readFileSync("app/routes.ts", "utf8")).toContain('route("onboarding/taste", "routes/taste-onboarding.tsx")');
    const component = fs.readFileSync("app/components/onboarding/TasteOnboarding.tsx", "utf8");
    expect(component).toContain("aria-pressed");
    expect(component).toContain("나중에 할게요");
    expect(component).toContain("44px");
  });
});
