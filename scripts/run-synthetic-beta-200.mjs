#!/usr/bin/env node
/**
 * Isolated HTTP fetch for synthetic-beta-200.
 * Requires SYNTHETIC_BETA_BASE_URL pointing at wrangler.e2e.jsonc --local persist.
 * Does not talk to live Worker, production D1, NAVER, or Resend.
 */
const base = process.env.SYNTHETIC_BETA_BASE_URL;
if (!base) {
  console.error("Set SYNTHETIC_BETA_BASE_URL to the isolated origin (example: http://127.0.0.1:5173)");
  process.exit(1);
}

const ABUSE_IP = "203.0.113.88";
const SLUG_A = "synth-beta-gukbap-a";
const SLUG_B = "synth-beta-ramen-b";
const origin = base.replace(/\/$/, "");

const tally = { total: 0, s5xx: 0, mailStub503: 0, s429: 0, s4xx: 0, s2xx: 0 };

async function hit(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const response = await fetch(`${origin}${path}`, { ...options, headers, redirect: "manual" });
  tally.total += 1;
  if (response.status >= 500) {
    const body = await response.clone().text();
    if (response.status === 503 && body.includes("이메일 발송 설정이 필요합니다")) tally.mailStub503 += 1;
    else tally.s5xx += 1;
  } else if (response.status === 429) tally.s429 += 1;
  else if (response.status >= 400) tally.s4xx += 1;
  else tally.s2xx += 1;
  return response;
}

function form(fields) {
  return new URLSearchParams(fields);
}

const viewerPaths = [
  "/",
  "/places",
  `/places/${SLUG_A}`,
  `/places/${SLUG_B}`,
  "/maps/gukbap-detail",
  "/reviewers/synth-reviewer-gukmul",
  "/resources/home-recommendations?mode=now&requestToken=synthview01&bbox=126.72,35.03,127.02,35.25",
  "/privacy",
  "/terms",
];

const printA1 = await hit(`/places/${SLUG_A}`);
const printText1 = await printA1.text();
const printVisibleBefore = printText1.includes("Flavor Print");
const sampleBefore = /표본 수집 중 · (\d+)\/8/.exec(printText1)?.[1] ?? "score";

for (let n = 1; n <= 50; n += 1) {
  await hit(viewerPaths[n % viewerPaths.length], { headers: { "CF-Connecting-IP": `198.51.102.${n}` } });
}

for (let n = 1; n <= 11; n += 1) {
  await hit("/signup", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ABUSE_IP },
    body: form({
      displayName: "폭주테스터",
      email: `abuse-http-${n}@example.test`,
      password: "synthetic-pass-1",
      ageConfirmed: "yes",
    }),
  });
}

for (let n = 1; n <= 21; n += 1) {
  await hit("/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ABUSE_IP },
    body: form({
      email: `abuse-http-login-${n}@example.test`,
      password: "synthetic-pass-1",
    }),
  });
}

for (let n = 51; n <= 100; n += 1) {
  await hit(viewerPaths[n % viewerPaths.length], { headers: { "CF-Connecting-IP": `198.51.102.${n}` } });
}

const printA2 = await hit(`/places/${SLUG_A}`);
const printText2 = await printA2.text();
const printVisibleAfter = /Flavor Print/.test(printText2) && !printText2.includes("리뷰어 평가 수집 중");
const sampleAfterScore = /\b(\d+)%/.exec(printText2)?.[1] ?? null;

const product5xxRate = tally.s5xx / Math.max(tally.total, 1);
const report = {
  isolated: true,
  live_write: false,
  total: tally.total,
  status_2xx: tally.s2xx,
  status_4xx: tally.s4xx,
  status_429: tally.s429,
  product_5xx: tally.s5xx,
  isolated_mail_stub_503: tally.mailStub503,
  product_5xx_rate: Number(product5xxRate.toFixed(4)),
  flavor_print_visible: printVisibleAfter || printVisibleBefore,
  sample_before_band: sampleBefore === "score" ? "numeric_or_empty" : "insufficient",
  sample_after_has_percent: Boolean(sampleAfterScore),
  viewer_post: 0,
};
console.log(JSON.stringify(report, null, 2));
if (tally.s429 < 1) process.exitCode = 2;
if (product5xxRate > 0.005) process.exitCode = 3;
