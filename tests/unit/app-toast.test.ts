import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppToast } from "../../app/components/app-toast";

describe("AppToast", () => {
  it("uses an alert for a publish failure and a dismissible status for success", () => {
    const error = renderToStaticMarkup(createElement(AppToast, {
      toast: { kind: "error", message: "사진 업로드에 실패했어요. 다시 시도해 주세요." },
      onClose: () => {},
    }));
    const success = renderToStaticMarkup(createElement(AppToast, {
      toast: { kind: "success", message: "사진과 리뷰를 발행했어요." },
      onClose: () => {},
    }));

    expect(error).toContain('role="alert"');
    expect(error).toContain("사진 업로드에 실패했어요.");
    expect(success).toContain('role="status"');
    expect(success).toContain('aria-label="알림 닫기"');
  });
});
