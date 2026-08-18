import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("legal withdraw copy", () => {
  it("points members to /me and keeps anonymous votes", () => {
    const privacy = readFileSync("app/routes/privacy.tsx", "utf8");
    const terms = readFileSync("app/routes/terms.tsx", "utf8");
    const inventory = readFileSync("docs/legal/privacy-data-inventory.md", "utf8");
    expect(privacy).toContain('href="/me"');
    expect(privacy).toContain("익명 사용자");
    expect(privacy).not.toContain("접수 채널은 정식 출시 전에");
    expect(terms).toContain('href="/me"');
    expect(terms).toContain("익명으로 남습니다");
    expect(inventory).toContain("익명 사용자에 연결해 집계 유지");
    expect(inventory).not.toContain("탈퇴 정책 확정 전 출시 금지");
  });
});
