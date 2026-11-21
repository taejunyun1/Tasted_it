import { createElement, forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import * as me from "../../app/routes/me";

const state = vi.hoisted(() => ({ navigation: { state: "idle", formData: undefined as FormData | undefined } }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("../../app/components/me/TasteSignals", () => ({ TasteSignals: () => null }));
vi.mock("../../app/components/me/AccountConnections", () => ({ AccountConnections: () => null }));
vi.mock("../../app/components/me/MemberSavedPlaces", () => ({ MemberSavedPlaces: () => null }));
vi.mock("react-router", async importOriginal => ({
  ...await importOriginal<typeof import("react-router")>(),
  Form: forwardRef<HTMLFormElement, Record<string, unknown>>((props, ref) => createElement("form", { ...props, ref })),
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => createElement("a", { ...props, href: to }, children),
  useNavigation: () => state.navigation,
}));

function render(actionData?: unknown) {
  return renderToStaticMarkup(createElement(me.default, { loaderData: { user: { id: "member", displayName: "합성 회원", email: "member@example.test" }, tasteGraph: { placeCount: 0 }, tasteProfile: { vector: [] }, saved: [], rated: [], emailVerified: true }, actionData } as never));
}
const request = () => new Request("https://retaste.test/me", { method: "POST", body: new URLSearchParams({ intent: "withdraw", confirm: "회원탈퇴" }) });
beforeEach(() => { state.navigation = { state: "idle", formData: undefined }; });

it("locks withdrawal while its own request is pending", () => {
  const formData = new FormData(); formData.set("intent", "withdraw");
  state.navigation = { state: "submitting", formData };
  const html = render();
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("탈퇴 처리 중…");
  expect(html).toMatch(/<fieldset[^>]*disabled=""/);
});

it("does not claim rollback or replay a lost withdrawal response", async () => {
  const serverAction = vi.fn().mockRejectedValue(new TypeError("private transport detail"));
  const result = await me.clientAction({ request: request(), serverAction } as never);
  expect(serverAction).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ kind: "member-withdraw", outcome: "UNKNOWN" });
  expect(JSON.stringify(result)).not.toContain("private transport detail");
  const html = render(result);
  expect(html).toContain("현재 로그인 상태 확인");
  expect(html).toMatch(/<fieldset[^>]*disabled=""/);
});

it("preserves successful redirects and definite authorization failures", async () => {
  for (const status of [302, 403]) {
    const response = new Response(null, { status, headers: status === 302 ? { Location: "/" } : {} });
    await expect(me.clientAction({ request: request(), serverAction: async () => { throw response; } } as never)).rejects.toBe(response);
  }
});

it("does not lock withdrawal for another operation or a correctable confirmation error", () => {
  const formData = new FormData(); formData.set("intent", "unsave");
  state.navigation = { state: "submitting", formData };
  const html = render({ withdrawError: "확인 문구를 정확히 입력해 주세요." });
  expect(html).not.toContain("탈퇴 처리 중…");
  expect(html).not.toMatch(/<fieldset[^>]*disabled=""/);
  expect(html).toContain("확인 문구를 정확히 입력해 주세요.");
});

it("waits for an explicit authentication check after an unknown withdrawal only", () => {
  const args = { formMethod: "POST", actionResult: { kind: "member-withdraw", outcome: "UNKNOWN" }, defaultShouldRevalidate: true };
  expect(me.shouldRevalidate(args as never)).toBe(false);
  expect(me.shouldRevalidate({ ...args, formMethod: "GET" } as never)).toBe(true);
  expect(me.shouldRevalidate({ ...args, actionResult: { withdrawError: "확인 문구를 확인하세요" } } as never)).toBe(true);
});
