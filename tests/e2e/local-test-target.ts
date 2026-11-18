/** Only the loopback test Worker may receive synthetic sessions or mutations. */
export function isControlledLocalBaseUrl(baseUrl = process.env.BASE_URL) {
  if (!baseUrl) return true;
  try {
    const url = new URL(baseUrl);
    return ["http:", "https:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && !url.username && !url.password;
  } catch {
    return false;
  }
}
