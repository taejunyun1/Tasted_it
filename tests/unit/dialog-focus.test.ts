import { describe, expect, it } from "vitest";

import { tabWrapTarget } from "../../app/features/a11y/dialog-focus";

const items = ["close", "route", "detail"] as const;

describe("tabWrapTarget", () => {
  it("wraps from the last item to the first", () => {
    expect(tabWrapTarget([...items], "detail", false)).toBe("close");
  });

  it("wraps from the first item to the last on Shift+Tab", () => {
    expect(tabWrapTarget([...items], "close", true)).toBe("detail");
  });

  it("does not steal Tab in the middle of the list", () => {
    expect(tabWrapTarget([...items], "route", false)).toBeUndefined();
    expect(tabWrapTarget([...items], "route", true)).toBeUndefined();
  });

  it("sends Shift+Tab to the last item when focus is not in the list", () => {
    expect(tabWrapTarget([...items], null, true)).toBe("detail");
  });

  it("returns nothing when the dialog has no focusable items", () => {
    expect(tabWrapTarget([], "close", false)).toBeUndefined();
  });
});
