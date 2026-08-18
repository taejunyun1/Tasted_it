import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/routes/signup.tsx", "utf8");

describe("signup age gate", () => {
  it("rejects the form when age is not confirmed", () => {
    expect(source).toContain('if (String(form.ageConfirmed ?? "") !== "yes")');
    expect(source).toContain("만 14세 이상만 가입할 수 있습니다.");
    expect(source).toContain('name="ageConfirmed"');
  });
});
