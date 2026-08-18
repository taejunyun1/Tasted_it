import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/routes/me.tsx", "utf8");

describe("me page contract", () => {
  it("취향 허브 컴포넌트와 활동 요약을 사용한다", () => {
    expect(source).toContain('className="member-hub"');
    expect(source).toContain("getMemberTasteProfile");
    expect(source).toContain("profile={loaderData.tasteProfile}");
    expect(source).toContain('className="member-profile__avatar"');
    expect(source).toContain("<ActivityCollection");
    expect(source).toContain("<AccountConnections");
    expect(source).toContain("googleConnected={loaderData.googleConnected}");
    expect(source).toContain("loaderData.saved.length");
    expect(source).toContain("loaderData.rated.length");
    expect(source).toContain("withdrawAccount");
    expect(source).toContain('intent" value="withdraw"');
    expect(source).toContain("WITHDRAW_CONFIRM_PHRASE");
  });

  it("저장 해제도 취향 학습 실패 격리 경로를 사용한다", () => {
    expect(source).toContain('import { setSavedAndRefreshTaste } from "../features/saves/save.server"');
    expect(source).toContain("await setSavedAndRefreshTaste(createDb(env.DB), {");
    expect(source).not.toContain("await setSaved(createDb(env.DB), {");
  });
});
