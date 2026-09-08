// Laptop smoke only. The RSI loop runs on the Worker, not this script.
const baseUrl = process.env.BASE_URL ?? "https://retaste-beta.retaste-beta.workers.dev";

const checks = [
  { path: "/", status: 200 },
  { path: "/places", status: 200 },
  { path: "/login", status: 200 },
  { path: "/admin", status: 302, locationIncludes: "/login" },
  { path: "/robots.txt", status: 200 },
  { path: "/privacy", status: 200 },
];

const headers = {
  Accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (compatible; ReTasteCloudflareSelfCheck/1.0; +https://github.com/taejunyun1/Tasted_it)",
};

let failed = 0;

for (const check of checks) {
  const url = new URL(check.path, baseUrl);
  const response = await fetch(url, { method: "GET", redirect: "manual", headers });
  const location = response.headers.get("location") ?? "";
  const ok =
    response.status === check.status &&
    (!check.locationIncludes || location.includes(check.locationIncludes));

  console.log(
    `${ok ? "ok" : "FAIL"} ${check.path} -> ${response.status}${location ? ` loc=${location}` : ""}`,
  );

  if (!ok) {
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`[retaste] cloudflare live self-check failed: ${failed} route(s)`);
  process.exit(1);
}

console.log(`[retaste] cloudflare live self-check passed against ${baseUrl}`);
