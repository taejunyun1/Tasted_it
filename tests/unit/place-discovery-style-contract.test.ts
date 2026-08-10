import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  recommendationPlacePath,
  recommendationRequestPath,
} from "../../app/components/places/PlaceCard";

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

  it("adds only validated recommendation provenance to recommendation card requests", () => {
    const requestId = "7b3c9a17-8064-4d2e-8cf7-857dfc78b86f";
    const recommendationPath = recommendationPlacePath("gukbap-house", {
      variant: "personal",
      discoveryMode: "EXPLORATION",
    });

    expect(recommendationPath).toBe(
      "/places/gukbap-house?sourceRail=PERSONAL&discoveryMode=EXPLORATION",
    );
    expect(recommendationRequestPath(recommendationPath, requestId)).toBe(
      `/places/gukbap-house?sourceRail=PERSONAL&discoveryMode=EXPLORATION&recommendationRequestId=${requestId}`,
    );
    expect(recommendationPlacePath("gukbap-house", { variant: "default" }))
      .toBe("/places/gukbap-house");
    expect(card).toContain("reloadDocument={isRecommendation}");
    expect(card).toContain("recommendationRequestPath(detailPath, crypto.randomUUID())");
  });

  it("shares the Course and My Taste palette and respects reduced motion", () => {
    expect(css).toContain("--discovery-ink:#14251c");
    expect(css).toContain("--discovery-lime:#e7ff55");
    expect(css).toContain("@media(prefers-reduced-motion:reduce){.discovery-page");
  });
});
