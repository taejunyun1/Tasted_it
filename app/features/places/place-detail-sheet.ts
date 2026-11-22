export const PLACE_DETAIL_MOBILE_QUERY = "(max-width: 760px)";

export function shouldOpenPlaceDetailSheet(input: {
  defaultPrevented?: boolean;
  mobile: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return !input.defaultPrevented && input.mobile && input.button === 0 && !input.metaKey && !input.ctrlKey && !input.shiftKey && !input.altKey;
}
