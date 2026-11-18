import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PlaceCorrectionPanel } from "../../app/components/admin/PlaceCorrectionPanel";

vi.mock("react-router", () => ({
  Form: ({ children, ...props }: { children?: ReactNode }) => createElement("form", props, children),
  useNavigation: () => ({ state: "idle" }),
}));

it("shows an internal review control and Korean status without claiming to contact the requester", () => {
  const html = renderToStaticMarkup(createElement(PlaceCorrectionPanel, { corrections: [{ id: "request", placeId: "place", placeName: "합성 식당", status: "SUBMITTED", requestType: "INFORMATION", requesterRelation: "방문자", changes: [{ label: "상호", value: "새 합성 상호" }], evidenceNote: "현장 근거", adminResponse: "추가 근거 확인 중" }] }));
  expect(html).toContain("접수 완료");
  expect(html).toContain("정보 정정");
  expect(html).toContain('value="REVIEWING"');
  expect(html).toContain("검토 메모 저장");
  expect(html).toContain("추가 근거 확인 중");
  expect(html).not.toContain("답변을 발송");
});

it.each(["__proto__", "constructor"])("renders a safe label for an unknown legacy type %s", requestType => {
  const html = renderToStaticMarkup(createElement(PlaceCorrectionPanel, { corrections: [{ id: "request", placeId: "place", placeName: "합성 식당", status: "SUBMITTED", requestType, requesterRelation: "방문자", changes: [], evidenceNote: null, adminResponse: null }] }));
  expect(html).toContain("유형 확인 필요");
});
