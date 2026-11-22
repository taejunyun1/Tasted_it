import { safeReturnTo } from "./login";

export function oauthFailureHref(input: {
  provider: "GOOGLE" | "NAVER";
  code: string;
  destination?: "/login" | "/me";
  returnTo?: string;
}) {
  const destination = input.destination ?? "/login";
  const search = new URLSearchParams({ oauthError: input.code });
  if (input.provider === "NAVER") search.set("oauthProvider", "naver");
  const returnTo = safeReturnTo(input.returnTo);
  if (destination === "/login" && returnTo !== "/") search.set("returnTo", returnTo);
  return `${destination}?${search}`;
}
