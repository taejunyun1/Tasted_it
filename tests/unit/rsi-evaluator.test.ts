import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateFixedCase, loadDevelopmentManifest, validateManifest } from "../../scripts/rsi/evaluator";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = () => structuredClone(loadDevelopmentManifest().manifest);

describe("fixed RSI manifest boundary", () => {
  it("loads the content-locked development manifest", () => {
    const loaded = loadDevelopmentManifest();
    expect(loaded.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded.manifest.cases).toHaveLength(5);
    expect(loaded.manifest.cases.every((row) => row.split === "DEVELOPMENT")).toBe(true);
  });
  it("rejects a mismatched content digest", () => {
    expect(() => validateManifest(copy(), "0".repeat(64))).toThrow("RSI_MANIFEST_HASH_MISMATCH");
  });
  it.each(["url", "source", "filePath", "secret"])("rejects arbitrary %s input without echoing it", (key) => {
    const value = { ...copy(), [key]: "sensitive-value" };
    expect(() => validateManifest(value, digest(value))).toThrow("RSI_INVALID_MANIFEST");
  });
  it("rejects answer and fixture-family tampering", () => {
    for (const key of ["expected", "rootCauseFamily", "fixture"] as const) {
      const value = copy();
      Object.assign(value.cases[0], { [key]: key === "expected" ? "NO_CHANGE" : "NORMAL" });
      expect(() => validateManifest(value, digest(value))).toThrow("RSI_INVALID_MANIFEST");
    }
  });
  it.each([true, false])("rejects family leakage across splits, same ID=%s", (sameId) => {
    const value = copy();
    const duplicate = { ...value.cases[1], id: sameId ? value.cases[1].id : "00000000-0000-4000-8000-000000000099", split: "FINAL" };
    const changed = { ...value, cases: [...value.cases, duplicate] };
    expect(() => validateManifest(changed, digest(changed))).toThrow("RSI_INVALID_MANIFEST");
  });
  it("never admits the known native receiver family to a holdout", () => {
    const value = copy();
    value.cases[0].split = "FINAL";
    expect(() => validateManifest(value, digest(value))).toThrow("RSI_INVALID_MANIFEST");
  });
});

describe("native fixed evaluator", () => {
  const run = (fixture: string, program: string) => evaluateFixedCase({ fixture, program });
  it("reproduces native receiver RED then bound six-path GREEN", async () => {
    const red = await run("NATIVE_RECEIVER", "UNBOUND");
    expect(red).toMatchObject({ verdict: "FAIL", reasonCode: "NATIVE_RECEIVER_REPRODUCED", nativeRuntime: "WORKERD", redReproduced: true, greenVerified: false, calls: [] });
    const green = await run("NATIVE_RECEIVER", "BOUND");
    expect(green).toMatchObject({ verdict: "PASS", reasonCode: "SIX_PATHS_VERIFIED", redReproduced: false, greenVerified: true, expectedNoChange: false });
    expect(green.calls).toHaveLength(6);
    expect(green.calls.find((call) => call.path === "/admin")).toMatchObject({ method: "GET", status: 302 });
    for (const key of ["manifestHash", "evaluatorHash", "programHash"] as const) expect(green[key]).toMatch(/^[a-f0-9]{64}$/);
    expect(green.programHash).not.toBe(red.programHash);
  }, 20_000);
  it.each(["NORMAL", "HTTP_FAILURE", "AUTH_REDIRECT_FAILURE", "AUTH_STATUS_FAILURE"])("classifies %s honestly as expected NO_CHANGE", async (fixture) => {
    const result = await run(fixture, "BOUND");
    expect(result).toMatchObject({ verdict: "NO_CHANGE", expectedNoChange: true, greenVerified: fixture === "NORMAL" });
    expect(result.calls).toHaveLength(6);
  }, 10_000);
  it.each([
    ["NORMAL", "SKIP_CHECK"], ["HTTP_FAILURE", "WEAK_SUCCESS"],
    ["HTTP_FAILURE", "FALSE_PASS"], ["NORMAL", "ESCAPE_PATH"],
    ["NORMAL", "WRONG_METHOD"], ["NORMAL", "DUPLICATE_PATH"],
    ["AUTH_REDIRECT_FAILURE", "WEAK_SUCCESS"], ["NORMAL", "MALFORMED_RESULT"],
    ["NORMAL", "UNBOUND"],
  ])("rejects %s / %s by external oracle", async (fixture, program) => {
    const result = await run(fixture, program);
    expect(result.verdict).toBe("FAIL");
    expect(result.greenVerified).toBe(false);
    expect(result.redReproduced).toBe(false);
  }, 10_000);
  it.each(["THROW", "TIMEOUT"])("keeps %s unresolved, never PASS", async (program) => {
    const result = await run("NORMAL", program);
    expect(result).toMatchObject({ verdict: "INCONCLUSIVE", reasonCode: program === "TIMEOUT" ? "EXECUTION_TIMEOUT" : "EXECUTION_ERROR", nativeRuntime: "WORKERD", greenVerified: false, redReproduced: false });
  }, 15_000);
  it.each([
    { fixture: "https://example.com", program: "BOUND" },
    { fixture: "NORMAL", program: "throw new Error('sensitive')" },
    { fixture: "NORMAL", program: "BOUND", source: "sensitive" },
  ])("rejects invalid execution input without starting a native runtime", async (input) => {
    expect(await evaluateFixedCase(input)).toMatchObject({ verdict: "FAIL", reasonCode: "INPUT_REJECTED", nativeRuntime: "NOT_STARTED", programHash: null });
    expect(JSON.stringify(await evaluateFixedCase(input))).not.toContain("sensitive");
  });
});
