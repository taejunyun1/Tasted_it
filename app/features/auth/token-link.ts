export function accountActionUrl(baseUrl: string, path: string, token: string): string {
  const origin = baseUrl.replace(/\/$/, "");
  return `${origin}${path}#${token}`;
}
