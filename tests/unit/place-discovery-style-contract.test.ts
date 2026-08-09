import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rail = readFileSync("app/components/places/PlaceDiscoveryRail.tsx", "utf8");
const card = readFileSync("app/components/places/PlaceCard.tsx", "utf8");
const css = readFileSync("app/app.css", "utf8");

describe("place discovery visual contract", () => {
  it("gives personal, trusted, and Golden Pick sections distinct layouts", () => {
    expect(rail).toContain('kind: "personal" | "trusted" | "golden"');
    expect(rail).toContain('data-kind={kind}');
    expect(css).toContain('.discovery-section[data-kind="personal"]');
    expect(css).toContain('.discovery-section[data-kind="trusted"]');
    expect(css).toContain('.discovery-section[data-kind="golden"]');
  });

  it("shows no more than two evidence-backed reasons", () => {
    expect(card).toContain("recommendationReasons?.slice(0, 2)");
    expect(card).toContain("place-reason-list");
  });

  it("shares the Course and My Taste palette and respects reduced motion", () => {
    expect(css).toContain("--discovery-ink:#14251c");
    expect(css).toContain("--discovery-lime:#e7ff55");
    expect(css).toContain("@media(prefers-reduced-motion:reduce){.discovery-page");
  });
});
