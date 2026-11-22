export function restoreVisibleFocus(element: Element | null) {
  if (!(element instanceof HTMLElement) || element === document.body || element === document.documentElement
    || !element.isConnected || getComputedStyle(element).visibility !== "visible") return false;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0
    || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}
