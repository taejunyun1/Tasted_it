import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

function h1FontSizes(path: string) {
  const css = read(path);
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

  return rules.flatMap(([, selector, declarations]) => {
    if (!/(^|,)\s*[^,]*h1\b/.test(selector)) return [];
    const fontSize = declarations.match(/font-size\s*:\s*([^;}]+)/)?.[1]?.trim();
    return fontSize ? [[selector.trim(), fontSize] as const] : [];
  });
}

describe("H1 typography scale", () => {
  it("uses exactly 70% of every existing CSS H1 size", () => {
    const appSizes = h1FontSizes("app/app.css");
    const expectedAppSizes = [
      ["h1", "1.4em"],
      [".hero h1", "clamp(36.4px,5.6vw,78.4px)"],
      [".explore-head h1", "29.4px"],
      [".detail-copy h1", "clamp(26.6px,3.5vw,47.6px)"],
      [".error-page h1", "clamp(28px,4.9vw,63px)"],
      [".hero h1", "36.4px"],
      [".explore-head h1", "22.4px"],
      [".legal h1", "clamp(28px,4.9vw,50.4px)"],
      [".reviewer-rating-shell h1", "33.6px"],
      [".reviewer-rating-shell h1", "25.2px"],
      [".admin-rating-shell h1", "33.6px"],
      [".map-detail-copy h1", "21px"],
      [".map-detail-copy h1", "17.5px"],
      [".admin-head h1", "29.4px"],
      [".review-top h1", "clamp(23.8px,2.8vw,36.4px)"],
      [".operation-form h1,.operation-list h1,.place-ops h1", "clamp(26.6px,3.5vw,40.6px)"],
      [".map-atlas-head h1", "clamp(20.3px,1.68vw,26.6px)"],
      [".map-atlas-head h1", "20.3px"],
      [".course-hero h1", "clamp(33.6px,4.2vw,60.2px)"],
      [".course-hero h1", "36.4px"],
      [".course-hero h1", "30.1px"],
      [".member-profile h1", "clamp(33.6px,4.2vw,57.4px)"],
      [".member-profile h1", "30.8px"],
      [".member-profile__taste h1", "clamp(36.4px,4.9vw,64.4px)"],
      [".member-profile__taste h1", "32.2px"],
      [".discovery-hero h1", "clamp(37.8px,4.9vw,64.4px)"],
      [".discovery-hero h1", "34.3px"],
    ] as const;

    for (const expected of expectedAppSizes) {
      expect(appSizes).toContainEqual(expected);
    }

    expect(h1FontSizes("app/styles/design-system.css")).toContainEqual([
      ".taste-onboarding__header h1",
      "clamp(1.26rem,4.9vw,2.1rem)",
    ]);
  });

  it("scales Tailwind and email H1 declarations by the same ratio", () => {
    const expected = new Map<string, string[]>([
      ["app/routes/verify-email.tsx", ["text-[25.2px]"]],
      ["app/routes/admin-reviewers.tsx", ["text-[25.2px]", "md:text-[33.6px]"]],
      ["app/routes/admin-import.tsx", ["text-[21px]"]],
      ["app/routes/admin-candidates.tsx", ["text-[21px]", "md:text-[33.6px]"]],
      ["app/routes/login.tsx", ["text-[25.2px]"]],
      ["app/routes/reviewer-apply.tsx", ["text-[25.2px]", "md:text-[42px]"]],
      ["app/routes/reviewer-profile.tsx", ["text-[25.2px]", "md:text-[42px]"]],
      ["app/routes/admin-places.tsx", ["text-[21px]"]],
    ]);

    for (const [path, classes] of expected) {
      const source = read(path);
      for (const className of classes) expect(source).toContain(className);
    }

    const email = read("app/features/auth/email.server.ts");
    expect(email.match(/<h1 style="font-size:16\.8px">/g)).toHaveLength(2);
  });
});
