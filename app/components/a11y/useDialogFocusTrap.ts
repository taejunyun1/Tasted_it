import { useEffect, useRef, type RefObject } from "react";

import { tabWrapTarget, visibleFocusableElements } from "../../features/a11y/dialog-focus";

export function useDialogFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  input: { active: boolean; onClose: () => void },
) {
  const onCloseRef = useRef(input.onClose);
  onCloseRef.current = input.onClose;

  useEffect(() => {
    if (!input.active) return;
    const node = containerRef.current;
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = visibleFocusableElements(node)[0] ?? node;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !node.contains(document.activeElement)) return;
      const wrap = tabWrapTarget(visibleFocusableElements(node), document.activeElement, event.shiftKey);
      if (!wrap) return;
      event.preventDefault();
      wrap.focus();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [containerRef, input.active]);
}
