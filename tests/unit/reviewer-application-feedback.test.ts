import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigation: { state: "idle", formData: undefined as FormData | undefined },
  submit: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));
vi.mock("../../app/db/client.server", () => ({ createDb: () => ({}) }));
vi.mock("../../app/features/auth/session.server", () => ({ requireUser: async () => ({ id: "synthetic-member" }) }));
vi.mock("../../app/features/reviewers/reviewer.server", () => ({ submitReviewerApplication: mocks.submit, getReviewerDashboard: vi.fn() }));
vi.mock("react-router", async (original) => ({ ...(await original<typeof import("react-router")>()), Form: "form", Link: "a", useNavigation: () => mocks.navigation }));

const values = { statement: "의견".repeat(60), occupation: "기록자", tasteDirection: "담백한 맛", regionCode: "GWANGJU", specialtySlugs: ["gukbap"] };
const loaderData = { user: { id: "synthetic-member" }, dashboard: { latestApplication: null, profile: null, approvedSuggestionCount: 2 }, parentCategories: [{ id: "category-gukbap", slug: "gukbap", name: "국밥", emoji: "" }] };
afterEach(() => { mocks.submit.mockReset(); mocks.navigation.state = "idle"; mocks.navigation.formData = undefined; });

it("retains selected specialties and links returned field errors to their controls", async () => {
  const { default: Page } = await import("../../app/routes/reviewer-apply");
  const html = renderToStaticMarkup(createElement(Page, { loaderData, actionData: { ok: false, applicationId: null, error: "입력 항목을 확인하세요.", values, fieldErrors: { occupation: "직업 소개를 확인하세요." } } } as never));
  expect(html).toContain('role="alert"');
  expect(html).toContain('id="reviewer-occupation-error"');
  const occupation = html.match(/<input[^>]*name="occupation"[^>]*>/)?.[0];
  expect(occupation).toContain('aria-invalid="true"');
  expect(occupation).toContain('aria-describedby="reviewer-occupation-hint reviewer-occupation-error"');
  expect(html).toMatch(/<input[^>]*name="specialtySlugs"[^>]*checked=""/);
  expect(html).toContain("리뷰어 심사");
});

it("locks the application submit control while its request is pending", async () => {
  mocks.navigation.state = "submitting"; mocks.navigation.formData = new FormData();
  const { default: Page } = await import("../../app/routes/reviewer-apply");
  const html = renderToStaticMarkup(createElement(Page, { loaderData } as never));
  expect(html).toContain('aria-busy="true"');
  expect(html).toMatch(/<button[^>]*disabled=""/);
  expect(html).toContain("신청을 제출하고 있어요");
});

it("returns field validation before calling the application service", async () => {
  const { action } = await import("../../app/routes/reviewer-apply");
  const form = new FormData(); form.set("occupation", "기록자"); form.set("regionCode", "GWANGJU");
  const result = await action({ request: new Request("https://retaste.example/reviewer/apply", { method: "POST", headers: { Origin: "https://retaste.example" }, body: form }) } as never);
  expect(result).toMatchObject({ data: { ok: false, fieldErrors: { statement: expect.any(String), tasteDirection: expect.any(String), specialtySlugs: expect.any(String) } }, init: { status: 400 } });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("never exposes an unexpected service error to the applicant", async () => {
  mocks.submit.mockRejectedValue(new Error("SQLITE_PRIVATE_TABLE synthetic-secret-detail"));
  const { action } = await import("../../app/routes/reviewer-apply");
  const form = new FormData(); for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  const result = await action({ request: new Request("https://retaste.example/reviewer/apply", { method: "POST", headers: { Origin: "https://retaste.example" }, body: form }) } as never);
  expect(result).toMatchObject({ init: { status: 500 } });
  expect(JSON.stringify(result)).not.toContain("synthetic-secret-detail");
  expect(JSON.stringify(result)).toContain("잠시 후 다시 시도");
});
