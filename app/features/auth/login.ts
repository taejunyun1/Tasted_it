export const PUBLIC_LOGIN_ERROR = "이메일 또는 비밀번호가 올바르지 않습니다.";

export function publicLoginError(_error: unknown) {
  return PUBLIC_LOGIN_ERROR;
}

export function authEntryHref(pathname: "/login" | "/signup", currentPath: string, search = "") {
  const returnTo = safeReturnTo(`${currentPath}${search}`);
  if (returnTo === "/") return pathname;
  // Framework SSR serializes search params, while the browser keeps raw commas/spaces.
  // Match that serialization after validation so hydration has the same href.
  const destination = new URL(returnTo, "https://retaste.invalid");
  const searchParams = new URLSearchParams(destination.search);
  searchParams.delete("_routes");
  destination.search = searchParams.toString();
  const canonicalReturnTo = `${destination.pathname}${destination.search}${destination.hash}`;
  return `${pathname}?returnTo=${encodeURIComponent(canonicalReturnTo)}`;
}

export function retainedAuthFields(form: Record<string, FormDataEntryValue>) {
  return {
    email: typeof form.email === "string" ? form.email : "",
    displayName: typeof form.displayName === "string" ? form.displayName : "",
  };
}

export function safeReturnTo(value: string | null | undefined): string {
  const fallback = "/";
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;

  try {
    let decoded = value;
    for (let count = 0; count < 3; count += 1) {
      const next = decodeURIComponent(decoded);
      if (next.startsWith("//") || next.includes("\\")) return fallback;
      if (next === decoded) break;
      decoded = next;
    }

    const base = new URL("https://retaste.invalid");
    const destination = new URL(value, base);
    const decodedDestination = new URL(decoded, base);
    if (decoded.includes("..") || value.includes("..")) return fallback;
    // React Router forwards the original single-fetch request URL to loaders
    // and actions. Authentication must return to the page, never its data stream.
    const isDataRequest = destination.pathname.endsWith(".data");
    for (const url of [destination, decodedDestination]) {
      if (url.pathname.endsWith(".data")) {
        url.pathname = url.pathname === "/_root.data" ? "/" : url.pathname.slice(0, -5);
        url.searchParams.delete("_routes");
      }
    }
    const isAllowedPath = (pathname: string) =>
      pathname === "/places" || pathname.startsWith("/places/")
      || pathname === "/admin" || pathname.startsWith("/admin/")
      || pathname === "/me" || pathname.startsWith("/me/")
      || pathname === "/student" || pathname.startsWith("/student/")
      || pathname === "/courses" || pathname.startsWith("/courses/")
      || pathname === "/maps" || pathname.startsWith("/maps/")
      || pathname === "/onboarding" || pathname.startsWith("/onboarding/")
      || pathname === "/suggestions" || pathname.startsWith("/suggestions/")
      || pathname === "/reviewer" || pathname.startsWith("/reviewer/")
      || pathname === "/corrections" || pathname.startsWith("/corrections/");
    const isDeniedPath = (pathname: string) => pathname === "/auth" || pathname.startsWith("/auth/");
    if (destination.origin !== base.origin || decodedDestination.origin !== base.origin) return fallback;
    if (isDeniedPath(destination.pathname) || isDeniedPath(decodedDestination.pathname)) return fallback;
    if (!isAllowedPath(destination.pathname) || !isAllowedPath(decodedDestination.pathname)) return fallback;
    return isDataRequest ? `${destination.pathname}${destination.search}${destination.hash}` : value;
  } catch {
    return fallback;
  }
}
