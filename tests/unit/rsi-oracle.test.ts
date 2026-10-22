import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateFixedCase } from "../../scripts/rsi/evaluator";
import {
  expectedRsiFixtureResponse, gradeRsiPublicPathCheck,
  type RsiFixture, type RsiObservedCall,
} from "../../scripts/rsi/oracle";

const paths = ["/", "/places", "/login", "/admin", "/robots.txt", "/privacy"] as const;
const fixtures: RsiFixture[] = ["NATIVE_RECEIVER", "NORMAL", "HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"];
const mismatch = { verdict: "FAIL", reasonCode: "ORACLE_MISMATCH", redReproduced: false, greenVerified: false };

// Independent expected observations; never execute editable app/candidate source.
function sample(fixture: RsiFixture = "NATIVE_RECEIVER") {
  const calls: RsiObservedCall[] = paths.map((path) => ({
    path, method: "GET", originAllowed: true,
    status: path === "/admin" ? fixture === "AUTH_STATUS_FAILURE" ? 200 : 302
      : path === "/places" && fixture === "HTTP_FAILURE" ? 503 : 200,
    location: path === "/admin" && fixture !== "AUTH_STATUS_FAILURE"
      ? fixture === "AUTH_REDIRECT_FAILURE" ? "/not-login" : "/login" : "",
  }));
  const results = calls.map(({ path, status, location }) => ({
    path, status, location, ok: status === (path === "/admin" ? 302 : 200)
      && (path !== "/admin" || location === "/login"),
  }));
  const failed = results.filter((row) => !row.ok).length;
  return { body: { ok: failed === 0, failed, originHost: "rsi.invalid", results }, calls };
}

describe("shared RSI fixture response contract", () => {
  it.each(fixtures)("preserves all six exact %s responses", (fixture) => {
    for (const call of sample(fixture).calls) {
      expect(expectedRsiFixtureResponse(fixture, call.path as typeof paths[number]))
        .toEqual({ status: call.status, location: call.location });
    }
  });
  it("returns independent fixture response objects", () => {
    const response = expectedRsiFixtureResponse("NORMAL", "/admin");
    response.status = 599;
    expect(expectedRsiFixtureResponse("NORMAL", "/admin")).toEqual({ status: 302, location: "/login" });
  });
});

describe("pure four-field RSI oracle", () => {
  it.each(fixtures)("preserves honest %s classification without receiver instrumentation", (fixture) => {
    const { body, calls } = sample(fixture);
    expect(Object.keys(body).sort()).toEqual(["failed", "ok", "originHost", "results"]);
    expect(gradeRsiPublicPathCheck(fixture, body, calls)).toEqual({
      verdict: fixture === "NATIVE_RECEIVER" ? "PASS" : "NO_CHANGE",
      reasonCode: fixture === "NATIVE_RECEIVER" ? "SIX_PATHS_VERIFIED" : fixture === "NORMAL" ? "NORMAL" : "EXTERNAL_FAILURE",
      redReproduced: false, greenVerified: fixture === "NORMAL" || fixture === "NATIVE_RECEIVER",
    });
  });
  it("matches paths independently of body/trace ordering without mutating inputs", () => {
    const { body, calls } = sample();
    body.results.reverse();
    calls.reverse();
    const before = JSON.stringify({ body, calls });
    expect(gradeRsiPublicPathCheck("NATIVE_RECEIVER", body, calls).verdict).toBe("PASS");
    expect(JSON.stringify({ body, calls })).toBe(before);
  });
  it.each([null, undefined, {}, [], "PASS", { ok: true }, { ...sample().body, receiverErrors: 0 }])
    ("rejects malformed or instrumented result %#", (body) => {
      expect(gradeRsiPublicPathCheck("NATIVE_RECEIVER", body, sample().calls)).toEqual(mismatch);
    });
  it.each([
    { ok: false }, { ok: "true" }, { failed: 1 }, { failed: -1 }, { failed: 7 }, { failed: 0.5 },
    { originHost: "outside.invalid" }, { originHost: "rsi.invalid:443" }, { extra: "sensitive" },
    { results: [] }, { results: sample().body.results.slice(1) },
    { results: [...sample().body.results, sample().body.results[0]] },
  ])("rejects dishonest aggregate or malformed body %#", (change) => {
    const { body, calls } = sample();
    expect(gradeRsiPublicPathCheck("NATIVE_RECEIVER", { ...body, ...change }, calls)).toEqual(mismatch);
  });
  it.each([
    { path: "/outside" }, { path: "/places" }, { status: 201 }, { status: 600 }, { status: -1 },
    { status: 200.5 }, { location: "/not-login" }, { location: "https://rsi.invalid/login" },
    { ok: false }, { extra: true },
  ])("rejects report path/status/location/ok tampering %#", (change) => {
    const { body, calls } = sample();
    Object.assign(body.results[0], change);
    expect(gradeRsiPublicPathCheck("NATIVE_RECEIVER", body, calls)).toEqual(mismatch);
  });
  it.each([null, undefined, {}, [], "PASS", [null], sample().calls.slice(1), [...sample().calls, sample().calls[0]]])
    ("rejects absent or wrong-size trace %#", (calls) => {
      expect(gradeRsiPublicPathCheck("NATIVE_RECEIVER", sample().body, calls)).toEqual(mismatch);
    });
  it.each([
    { path: "OUTSIDE_ALLOWLIST" }, { path: "/places" }, { method: "OTHER" }, { method: "POST" },
    { originAllowed: false }, { originAllowed: "true" }, { status: 201 }, { status: 200.5 },
    { location: "/not-login" }, { location: null }, { extra: "sensitive" },
  ])("rejects trace boundary tampering %#", (change) => {
    const { body, calls } = sample();
    Object.assign(calls[0], change);
    expect(gradeRsiPublicPathCheck("NATIVE_RECEIVER", body, calls)).toEqual(mismatch);
  });
  it.each(["HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"] as const)
    ("rejects a fabricated all-PASS body for %s", (fixture) => {
      const { body, calls } = sample(fixture);
      for (const row of body.results) row.ok = true;
      body.failed = 0;
      body.ok = true;
      expect(gradeRsiPublicPathCheck(fixture, body, calls)).toEqual(mismatch);
    });
  it.each(["AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"] as const)
    ("requires exact admin status/location even when report and trace agree for %s", (fixture) => {
      const { body, calls } = sample("NORMAL");
      expect(gradeRsiPublicPathCheck(fixture, body, calls)).toEqual(mismatch);
    });
  it("does not turn native-looking self-reported errors into R2 RED evidence", () => {
    const { body } = sample();
    Object.assign(body, { ok: false, failed: 6 });
    for (const row of body.results) Object.assign(row, { status: 0, location: "", ok: false });
    expect(gradeRsiPublicPathCheck("NATIVE_RECEIVER", body, [])).toEqual(mismatch);
    expect(gradeRsiPublicPathCheck("NATIVE_RECEIVER", { ...body, receiverErrors: 6 }, [])).toEqual(mismatch);
  });
  it("rejects an unknown fixture without echoing it", () => {
    const { body, calls } = sample();
    const result = gradeRsiPublicPathCheck("sensitive" as RsiFixture, body, calls);
    expect(result).toEqual(mismatch);
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
  it("binds evaluatorHash to evaluator, contracts, and shared oracle source bytes", async () => {
    const expected = createHash("sha256").update(Buffer.concat([
      readFileSync(new URL("../../scripts/rsi/evaluator.ts", import.meta.url)),
      readFileSync(new URL("../../scripts/rsi/contracts.ts", import.meta.url)),
      readFileSync(new URL("../../scripts/rsi/oracle.ts", import.meta.url)),
    ])).digest("hex");
    expect((await evaluateFixedCase({ source: "rejected" })).evaluatorHash).toBe(expected);
  });
});
