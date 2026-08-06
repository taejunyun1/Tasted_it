export function shouldOpenPlaceDetailSheet(input: {
  mobile: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return input.mobile && input.button === 0 && !input.metaKey && !input.ctrlKey && !input.shiftKey && !input.altKey;
}
