import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Privacy from "../../app/routes/privacy";
import Terms from "../../app/routes/terms";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("legal withdraw copy", () => {
  it("keeps self-service withdrawal and discloses retained review records", () => {
    const privacy = renderToStaticMarkup(createElement(Privacy));
    const terms = renderToStaticMarkup(createElement(Terms));
    const inventory = readFileSync("docs/legal/privacy-data-inventory.md", "utf8");
    expect(privacy).toContain('href="/me"');
    expect(privacy).toContain("기록을 계정과 연결하는 정보");
    expect(privacy).toContain("자유롭게 작성한 방문·사진·권리 설명과 이전 내용");
    expect(privacy).not.toContain("접수 채널은 정식 출시 전에");
    expect(terms).toContain('href="/me"');
    expect(terms).toContain("기록을 계정에 연결하는 정보");
    expect(terms).toContain("방문·권리 설명과 검수·변경 이력은 남을 수 있습니다");
    expect(inventory).toContain("자유 문안까지 완전 익명화하거나 전부 즉시 삭제하는 동작은 아님");
    expect(inventory).not.toContain("탈퇴 정책 확정 전 출시 금지");
  });

  it("blocks under-14 signup in policy copy without collecting birth dates", () => {
    const privacy = readFileSync("app/routes/privacy.tsx", "utf8");
    const terms = readFileSync("app/routes/terms.tsx", "utf8");
    const inventory = readFileSync("docs/legal/privacy-data-inventory.md", "utf8");
    const signup = readFileSync("app/routes/signup.tsx", "utf8");
    expect(privacy).toContain("만 14세 미만은 가입·이용할 수 없습니다");
    expect(terms).toContain("만 14세 미만은 이용할 수 없습니다");
    expect(inventory).toContain("생년월일은 저장하지 않는다");
    expect(inventory).not.toContain("만 14세 미만 이용 제한 방식 확정");
    expect(signup).toContain('name="ageConfirmed"');
    expect(signup).toContain('value="yes"');
  });
});
