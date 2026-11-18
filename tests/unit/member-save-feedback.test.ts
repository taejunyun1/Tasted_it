import { createElement, forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as me from "../../app/routes/me";

const state = vi.hoisted(() => ({ fetcher: { state: "idle", data: undefined as unknown, formData: undefined as FormData | undefined } }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("../../app/components/me/TasteSignals", () => ({ TasteSignals: () => null }));
vi.mock("../../app/components/me/AccountConnections", () => ({ AccountConnections: () => null }));
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const Form = forwardRef<HTMLFormElement, Record<string, unknown>>((props, ref) => createElement("form", { ...props, ref }));
  return { ...actual, Form,
    Link: ({ to, children, reloadDocument: _reloadDocument, ...props }: { to: string; children: React.ReactNode; reloadDocument?: boolean }) => createElement("a", { ...props, href: to }, children),
    useFetcher: () => ({ ...state.fetcher, Form }),
  };
});

const places = ["one", "two"].map(id => ({ id, slug: `place-${id}`, name: `합성 장소 ${id}`, categoryEmoji: "", categoryName: "음식", neighborhood: "합성", savedAt: "2026-11-18T00:00:00Z" }));
function render(saved = places) {
  return renderToStaticMarkup(createElement(me.default, { loaderData: { user: { id: "member", displayName: "합성 회원", email: "member@example.test" }, tasteGraph: { placeCount: 0 }, tasteProfile: { vector: [] }, saved, rated: [], emailVerified: true } } as never));
}
beforeEach(() => { state.fetcher = { state: "idle", data: undefined, formData: undefined }; });

describe("member save feedback", () => {
  it("shows the active save operation pending without disabling account withdrawal", () => {
    const formData = new FormData(); formData.set("intent", "unsave"); formData.set("placeId", "one");
    state.fetcher = { state: "submitting", data: undefined, formData };
    const html = render();
    expect(html).toContain("저장 해제 중…");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toMatch(/<button type="submit">탈퇴하기<\/button>/);
  });

  it("requires a fresh read after unknown delivery and keeps existing saved rows", () => {
    state.fetcher.data = { kind: "member-save", ok: false, outcome: "UNKNOWN", placeId: "one", message: "저장 상태를 확인하지 못했습니다." };
    const html = render();
    expect(html).toContain('role="alert"'); expect(html).toContain("현재 목록 다시 확인");
    expect(html).toContain("합성 장소 one"); expect(html).toContain("합성 장소 two");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("keeps the success receipt after the last row disappears", () => {
    state.fetcher.data = { kind: "member-save", ok: true, outcome: "REMOVED", placeId: "one", message: "저장을 해제했습니다." };
    const html = render([]);
    expect(html).toContain("저장을 해제했습니다."); expect(html).toContain('role="status"');
    expect(html).toContain("지도에서 다시 보고 싶은 장소를 저장해 보세요.");
  });

  it("does not replay a write when a transport response is lost", async () => {
    const serverAction = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const request = new Request("https://retaste.test/me", { method: "POST", body: new URLSearchParams({ intent: "unsave", placeId: "one" }) });
    const result = await me.clientAction({ request, serverAction } as never);
    expect(serverAction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: "member-save", ok: false, outcome: "UNKNOWN", placeId: "one" });
    expect(JSON.stringify(result)).not.toContain("Failed to fetch");
  });

  it("preserves withdrawal and authorization failures instead of converting them into save results", async () => {
    const error = new Response("Forbidden", { status: 403 });
    for (const intent of ["withdraw", "unsave"]) {
      const serverAction = vi.fn().mockRejectedValue(error);
      const request = new Request("https://retaste.test/me", { method: "POST", body: new URLSearchParams({ intent, placeId: "one" }) });
      await expect(me.clientAction({ request, serverAction } as never)).rejects.toBe(error);
      expect(serverAction).toHaveBeenCalledTimes(1);
    }
  });
});
