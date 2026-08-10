import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

function headingFontSizes(path: string, heading: "h1" | "h2") {
  const css = read(path);
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

  return rules.flatMap(([, selector, declarations]) => {
    const selectorPattern = new RegExp(`(^|,)\\s*[^,]*${heading}\\b`);
    if (!selectorPattern.test(selector)) return [];
    const fontSize = declarations.match(/font-size\s*:\s*([^;}]+)/)?.[1]?.trim();
    return fontSize ? [[selector.trim(), fontSize] as const] : [];
  });
}

function expectRules(path: string, heading: "h1" | "h2", expectedRules: readonly (readonly [string, string])[]) {
  const actualRules = headingFontSizes(path, heading);
  for (const expected of expectedRules) expect(actualRules).toContainEqual(expected);
}

describe("heading typography scale", () => {
  it("uses 75% of the original H1 scale", () => {
    expectRules("app/app.css", "h1", [
      ["h1", "1.5em"],
      [".hero h1", "clamp(39px,6vw,84px)"],
      [".explore-head h1", "31.5px"],
      [".detail-copy h1", "clamp(28.5px,3.75vw,51px)"],
      [".error-page h1", "clamp(30px,5.25vw,67.5px)"],
      [".legal h1", "clamp(30px,5.25vw,54px)"],
      [".reviewer-rating-shell h1", "36px"],
      [".admin-rating-shell h1", "36px"],
      [".map-detail-copy h1", "22.5px"],
      [".admin-head h1", "31.5px"],
      [".review-top h1", "clamp(25.5px,3vw,39px)"],
      [".operation-form h1,.operation-list h1,.place-ops h1", "clamp(28.5px,3.75vw,43.5px)"],
      [".map-atlas-head h1", "clamp(21.75px,1.8vw,28.5px)"],
      [".course-hero h1", "clamp(36px,4.5vw,64.5px)"],
      [".member-profile h1", "clamp(36px,4.5vw,61.5px)"],
      [".member-profile__taste h1", "clamp(39px,5.25vw,69px)"],
      [".discovery-hero h1", "clamp(40.5px,5.25vw,69px)"],
      [".course-hero h1", "39px"],
      [".hero h1", "39px"],
      [".explore-head h1", "24px"],
      [".reviewer-rating-shell h1", "27px"],
      [".map-detail-copy h1", "18.75px"],
      [".map-atlas-head h1", "21.75px"],
      [".discovery-hero h1", "36.75px"],
      [".course-hero h1", "32.25px"],
      [".member-profile h1", "33px"],
      [".member-profile__taste h1", "34.5px"],
    ]);

    expectRules("app/styles/design-system.css", "h1", [
      [".taste-onboarding__header h1", "clamp(1.35rem,5.25vw,2.25rem)"],
    ]);
  });

  it("uses 85% of the original H2 scale", () => {
    expectRules("app/app.css", "h2", [
      ["h2", "1.275em"],
      [".section-heading h2", "clamp(21.25px,2.55vw,34px)"],
      [".legal h2", "17.85px"],
      [".rating-breakdown h2,.flavor-print h2,.taste-graph h2", "14.45px"],
      [".reviewer-rating-list h2", "18.7px"],
      [".admin-rating-section h2", "18.7px"],
      [".candidate-row h2", "20.4px"],
      [".candidate-card h2", "15.3px"],
      [".inspector-head h2", "23.8px"],
      [".ops-dashboard-grid h2", "17px"],
      [".place-ops-section h2", "19.55px"],
      [".discovery-heading h2", "clamp(23.8px,2.55vw,35.7px)"],
      [".map-place-sheet__identity h2", "19.55px"],
      [".place-detail-sheet__body h2", "28.9px"],
      [".course-filter-title h2", "27.2px"],
      [".course-empty h2", "clamp(28.9px,3.4vw,47.6px)"],
      [".course-result-head h2", "25.5px"],
      [".member-section-heading h2,.member-activity__heading h2,.member-account-card h2", "clamp(23.8px,2.55vw,34px)"],
      [".member-activity-card h2", "17.85px"],
      [".discovery-controls__heading h2", "clamp(28.9px,3.4vw,44.2px)"],
      [".discovery-recommendations__title h2", "clamp(35.7px,5.1vw,64.6px)"],
      [".map-place-sheet__identity h2", "17px"],
      [".place-detail-sheet__body h2", "27.2px"],
      [".course-result-head h2", "19.55px"],
      [".member-section-heading h2,.member-activity__heading h2,.member-account-card h2", "23.8px"],
      [".discovery-controls__heading h2", "29.75px"],
      [".discovery-recommendations__title h2", "39.1px"],
    ]);
  });

  it("scales directly assigned H1 and H2 sizes", () => {
    const h1Classes = new Map<string, string[]>([
      ["app/routes/verify-email.tsx", ["text-[27px]"]],
      ["app/routes/admin-reviewers.tsx", ["text-[27px]", "md:text-[36px]"]],
      ["app/routes/admin-import.tsx", ["text-[22.5px]"]],
      ["app/routes/admin-candidates.tsx", ["text-[22.5px]", "md:text-[36px]"]],
      ["app/routes/login.tsx", ["text-[27px]"]],
      ["app/routes/reviewer-apply.tsx", ["text-[27px]", "md:text-[45px]"]],
      ["app/routes/reviewer-profile.tsx", ["text-[27px]", "md:text-[45px]"]],
      ["app/routes/admin-places.tsx", ["text-[22.5px]"]],
    ]);

    for (const [path, classes] of h1Classes) {
      const source = read(path);
      for (const className of classes) expect(source).toContain(className);
    }

    expect(read("app/routes/admin-reviewers.tsx").match(/text-\[15\.3px\]/g)).toHaveLength(2);
    expect(read("app/routes/admin-import.tsx")).toContain("text-[17px]");
    expect(read("app/routes/admin-candidates.tsx").match(/text-\[13\.6px\]/g)).toHaveLength(2);
    expect(read("app/routes/reviewer-apply.tsx").match(/text-\[17px\]/g)).toHaveLength(2);

    const email = read("app/features/auth/email.server.ts");
    expect(email.match(/<h1 style="font-size:18px">/g)).toHaveLength(2);
  });
});
