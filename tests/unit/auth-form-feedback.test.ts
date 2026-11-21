import { createElement, forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm, isAuthFormPending } from "../../app/features/auth/auth-form";
import { AuthInput } from "../../app/routes/login";
import Forgot from "../../app/routes/forgot-password";

const state = vi.hoisted(() => ({ action: "/login", navigation: { state: "idle", formMethod: undefined as string | undefined, formAction: undefined as string | undefined } }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual,
    Form: forwardRef<HTMLFormElement, Record<string, unknown>>((props, ref) => createElement("form", { ...props, ref })),
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => createElement("a", { ...props, href: to }, children),
    useFormAction: (action?: string) => action ?? state.action,
    useNavigation: () => state.navigation,
  };
});

beforeEach(() => { state.action = "/login"; state.navigation = { state: "idle", formMethod: undefined, formAction: undefined }; });

describe("authentication form feedback", () => {
  it("keeps an editable retry form and the entered email after password mail is rate limited", () => {
    state.action = "/forgot-password";
    const html = renderToStaticMarkup(createElement(Forgot, { actionData: { ok: false, message: "잠시 후 다시 시도해 주세요.", email: "member@example.test" } } as never));
    expect(html).toContain("재설정 메일 보내기");
    expect(html).toContain('value="member@example.test"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="forgot-password-error"');
  });

  it("locks only the posting form through submission and revalidation", () => {
    for (const phase of ["submitting", "loading"]) {
      state.navigation = { state: phase, formMethod: "POST", formAction: "/login?returnTo=%2Fme" };
      const html = renderToStaticMarkup(createElement(AuthForm, { id: "login", submitLabel: "로그인", pendingLabel: "로그인 중…", children: "입력" }));
      expect(html).toContain('aria-busy="true"');
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>로그인 중…<\/button>/);
    }
    expect(isAuthFormPending({ state: "loading", formMethod: "get", formAction: "/login" }, "/login")).toBe(false);
    expect(isAuthFormPending({ state: "submitting", formMethod: "post", formAction: "/logout" }, "/login")).toBe(false);
    expect(isAuthFormPending({ state: "idle", formMethod: "post", formAction: "/login" }, "/login")).toBe(false);
  });

  it("gives a failed response an accessible summary and connects field-specific errors", () => {
    const html = renderToStaticMarkup(createElement(AuthForm, { id: "login", error: "입력을 확인해 주세요.", submitLabel: "로그인", pendingLabel: "로그인 중…",
      children: createElement(AuthInput, { label: "이메일", name: "email", type: "email", autoComplete: "email", error: "이메일 형식을 확인해 주세요.", defaultValue: "member" }),
    }));
    expect(html).toContain('id="login-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="auth-email-error"');
    expect(html).toContain('id="auth-email-error"');
  });

  it("never serializes a supplied password value while preserving permitted input", () => {
    const password = renderToStaticMarkup(createElement(AuthInput, { label: "비밀번호", name: "password", type: "password", autoComplete: "new-password", minLength: 10, defaultValue: "do-not-serialize" }));
    expect(password).not.toContain("do-not-serialize");
    expect(password).toContain('minLength="10"');
    expect(renderToStaticMarkup(createElement(AuthInput, { label: "이메일", name: "email", type: "email", autoComplete: "email", defaultValue: "member@example.test" }))).toContain('value="member@example.test"');
  });
});
