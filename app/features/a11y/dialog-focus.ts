export const DIALOG_FOCUSABLE_SELECTOR = "button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])";

export function tabWrapTarget<T>(focusable: T[], active: unknown, shiftKey: boolean): T | undefined {
  if (!focusable.length) return undefined;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const inList = active != null && focusable.includes(active as T);
  if (shiftKey && (active === first || !inList)) return last;
  if (!shiftKey && active === last) return first;
  return undefined;
}

export function visibleFocusableElements(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)]
    .filter((element) => element.offsetParent !== null);
}
