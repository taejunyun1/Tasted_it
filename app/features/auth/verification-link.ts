import { authEntryHref, safeReturnTo } from "./login";
import { accountActionUrl } from "./token-link";

export function verificationEmailUrl(baseUrl: string, token: string, requestedReturnTo?: string | null) {
  const returnTo = safeReturnTo(requestedReturnTo);
  const query = returnTo === "/" ? "" : `?${new URLSearchParams({ returnTo })}`;
  return accountActionUrl(baseUrl, `/verify-email${query}`, token);
}

export function verificationLoginHref(requestedReturnTo?: string | null) {
  return authEntryHref("/login", safeReturnTo(requestedReturnTo));
}
