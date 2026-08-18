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
    const isAllowedPath = (pathname: string) =>
      pathname === "/places" || pathname.startsWith("/places/")
      || pathname === "/admin" || pathname.startsWith("/admin/")
      || pathname === "/me" || pathname.startsWith("/me/")
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
    return value;
  } catch {
    return fallback;
  }
}
