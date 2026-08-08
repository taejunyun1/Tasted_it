export function safeReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith("/")) return "/";
  try {
    const base = new URL("https://retaste.invalid");
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return "/";
    if (destination.pathname.startsWith("/auth/google")) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}
