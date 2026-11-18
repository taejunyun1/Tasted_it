import { createElement, forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlaceCorrection from "../../app/routes/place-correction";
import MySuggestions from "../../app/routes/my-suggestions";
import { retainedCorrectionValues } from "../../app/features/places/submission-feedback";

const state = vi.hoisted(() => ({ navigation: { state: "idle", formMethod: undefined as string | undefined, formAction: undefined as string | undefined }, email: "" }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("react-router", async (importOriginal) => ({ ...await importOriginal<typeof import("react-router")>(),
  Form: forwardRef<HTMLFormElement, Record<string, unknown>>((props, ref) => createElement("form", { ...props, ref })),
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => createElement("a", { ...props, href: to }, children),
  useNavigation: () => state.navigation,
  useFormAction: () => "/corrections/new",
  useRouteLoaderData: () => ({ user: state.email ? { email: state.email } : null }),
}));

beforeEach(() => { state.navigation = { state: "idle", formMethod: undefined, formAction: undefined }; state.email = ""; });
const loader = { places: [{ id: "place-1", name: "합성 장소", address: "합성 주소" }], selectedPlaceId: "place-1" };

describe("correction feedback and suggestion progress", () => {
  it("retains only bounded known fields rather than uploaded files or unrelated private values", () => {
    const form = new FormData(); form.set("email", "x".repeat(500)); form.set("evidenceNote", "y".repeat(5000));
    form.set("token", "unrelated-token"); form.set("password", "unrelated-password"); form.set("name", new File(["photo"], "private-name.jpg"));
    const values = retainedCorrectionValues(form);
    expect(values.email).toHaveLength(320); expect(values.evidenceNote).toHaveLength(4096); expect(values.name).toBe("");
    expect(values).not.toHaveProperty("token"); expect(values).not.toHaveProperty("password");
  });
  it("retains submitted fields and target after an error while announcing the failure", () => {
    const html = renderToStaticMarkup(createElement(PlaceCorrection, { loaderData: loader, actionData: { ok: false, error: "잠시 후 다시 시도해 주세요.", values: { placeId: "place-1", requestType: "MOVED", relation: "방문자", email: "retry@example.test", name: "정정 상호", address: "새 합성 주소", phone: "062-000-0000", evidenceNote: "<script>합성 근거</script>" } } } as never));
    expect(html).toContain('role="alert"');
    expect(html).toContain('value="retry@example.test"');
    expect(html).toContain('value="정정 상호"');
    expect(html).toMatch(/value="MOVED"[^>]*selected/);
    expect(html).toContain("&lt;script&gt;합성 근거&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("prefills account email without claiming that login replaces email verification", () => {
    state.email = "account@example.test";
    const html = renderToStaticMarkup(createElement(PlaceCorrection, { loaderData: loader } as never));
    expect(html).toContain('value="account@example.test"');
    expect(html).toContain("로그인한 경우에도 링크 확인이 필요합니다.");
    expect(html).not.toContain("readOnly");
  });

  it("shows pending feedback and disables a repeated correction submission", () => {
    state.navigation = { state: "submitting", formMethod: "POST", formAction: "/corrections/new" };
    const html = renderToStaticMarkup(createElement(PlaceCorrection, { loaderData: loader } as never));
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>확인 메일 요청 중…<\/button>/);
  });

  it("separates suggestion review status, reason and Korea-time dates without equating approval with publication", () => {
    const items = ["SUBMITTED", "NEEDS_INFO", "REVIEWING", "APPROVED", "REJECTED", "DUPLICATE"].map((status, index) => ({ id: `suggestion-${index}`, name: `합성 제안 ${index}`, address: "합성 주소", status, reviewReason: "확인된 검토 사유", createdAt: "2026-11-18T01:00:00.000Z", reviewedAt: "2026-11-18T02:00:00.000Z" }));
    const html = renderToStaticMarkup(createElement(MySuggestions, { loaderData: { items } } as never));
    for (const label of ["접수 완료", "보완 필요", "검토 중", "승인됨", "반려됨", "중복 확인"]) expect(html).toContain(label);
    expect(html).toContain("공개 여부는 별도로 검토합니다.");
    expect(html).toContain("접수일"); expect(html).toContain("검토일");
    expect(html).toContain("10:00"); expect(html).toContain("11:00"); expect(html).toContain("KST");
    expect(html).toContain('dateTime="2026-11-18T01:00:00.000Z"');
  });

  it("keeps an understandable empty state and handles an unknown status or invalid date", () => {
    const empty = renderToStaticMarkup(createElement(MySuggestions, { loaderData: { items: [] } } as never));
    expect(empty).toContain("접수한 장소 제안이 없습니다.");
    const html = renderToStaticMarkup(createElement(MySuggestions, { loaderData: { items: [{ id: "legacy", name: "합성 장소", address: "", status: "UNKNOWN", createdAt: "broken", reviewedAt: null, reviewReason: null }] } } as never));
    expect(html).toContain("상태 확인 필요"); expect(html).toContain("일시 확인 필요");
    expect(html).not.toContain("Invalid Date");
  });
});
