import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PlaceCorrectionPanel } from "../../app/components/admin/PlaceCorrectionPanel";

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: { children?: ReactNode }) => createElement("form", props, children),
  Link: ({ children, to }: { children?: ReactNode; to: string }) => createElement("a", { href: to }, children),
  useNavigation: () => ({ state: "idle" }),
}));

const request = { id: "request", placeId: "place", placeName: "합성 식당", status: "SUBMITTED", requestType: "INFORMATION",
  requesterRelation: "방문자", changes: [], evidenceNote: null, adminResponse: null, updatedAt: "2026-11-20T01:00:00.000Z", canApply: false, canRecall: false };
const pagination = { page: 2, pageSize: 25, total: 53, totalPages: 3 };

it("shows an internal review control and Korean status without claiming to contact the requester", () => {
  const html = renderToStaticMarkup(createElement(PlaceCorrectionPanel, { pagination, rows: [{ ...request, canApply: true,
    changes: [{ label: "상호", value: "새 합성 상호" }], evidenceNote: "현장 근거", adminResponse: "추가 근거 확인 중" }] }));
  expect(html).toContain("접수 완료");
  expect(html).toContain("정보 정정");
  expect(html).toContain('value="REVIEWING"');
  expect(html).toContain("검토 메모 저장");
  expect(html).toContain("추가 근거 확인 중");
  expect(html).toContain("정정 적용");
  expect(html).toContain('name="expectedUpdatedAt"');
  expect(html).toContain("correctionsPage=1");
  expect(html).toContain("correctionsPage=3");
  expect(html).not.toContain("답변을 발송");
});

it.each(["__proto__", "constructor"])("renders a safe label for an unknown legacy type %s", requestType => {
  const html = renderToStaticMarkup(createElement(PlaceCorrectionPanel, { pagination, rows: [{ ...request, requestType }] }));
  expect(html).toContain("유형 확인 필요");
});

it.each([{ requestType: "CLOSED", canRecall: true }, { requestType: "CLOSED", canRecall: false }, { requestType: "RIGHTS", canRecall: false }])(
  "shows only valid actions for $requestType with recall eligibility $canRecall", ({ requestType, canRecall }) => {
    const html = renderToStaticMarkup(createElement(PlaceCorrectionPanel, { pagination, rows: [{ ...request, requestType, canRecall }] }));
    expect(html.includes("회수 미리보기")).toBe(canRecall);
    expect(html).not.toContain("정정 적용");
    expect(html).toContain("검토 메모 저장");
    expect(html).toContain("반려");
  },
);
