import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { buildFingerprint, digest } from "../../scripts/lib/release-fingerprint.mjs";

const revision = "a".repeat(40);
const profilePatch = "b".repeat(64);
const authorsPatch = "c".repeat(64);
const seatVariable = "STUDENT_REVIEW_PILOT_SEATS";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function prepare(phase: string, proof: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "student-release-config-"));
  roots.push(root);
  const candidate = join(root, "candidate");
  const build = join(candidate, "build");
  const output = join(root, "prepared");
  mkdirSync(join(build, "server"), { recursive: true });
  const config = JSON.stringify({
    name: "retaste-beta",
    preview_urls: false,
    vars: {
      STUDENT_WORKSPACE_ENABLED: "true",
      REVIEW_PHOTO_UPLOAD_ENABLED: "false",
      POI_INSTAGRAM_PHOTO_ENABLED: "true",
    },
    r2_buckets: [{ binding: "REVIEW_PHOTOS", bucket_name: "retaste-review-photos" }],
  });
  writeFileSync(join(build, "server/wrangler.json"), config);
  writeFileSync(join(candidate, "student-pilot-release.json"), JSON.stringify({
    activation: "dark",
    revision,
    buildSha256: buildFingerprint(build),
    configSha256: digest(config),
    ...proof,
  }));
  const result = spawnSync(process.execPath, [
    resolve("scripts/prepare-student-pilot-release-config.mjs"), candidate, output, revision, phase,
  ], { encoding: "utf8" });
  return { result, output };
}

test("lets the original dark build prepare only the closed configuration", () => {
  const { result, output } = prepare("closed");
  expect(result.status, result.stderr).toBe(0);
  const config = JSON.parse(readFileSync(join(output, "build/server/wrangler.json"), "utf8"));
  expect(config.vars).not.toHaveProperty(seatVariable);
});

test.each(["a", "ab"])("blocks opening %s on a build missing the direct verification labels", (phase) => {
  const { result, output } = prepare(phase, { directVerificationPatchSha256: profilePatch });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("direct verification labels");
  expect(existsSync(output)).toBe(false);
});

test.each([["a", "A"], ["ab", "A,B"]])("allows %s with both label patches", (phase, seats) => {
  const { result, output } = prepare(phase, {
    directVerificationPatchSha256: profilePatch,
    directVerificationAuthorsPatchSha256: authorsPatch,
  });
  expect(result.status, result.stderr).toBe(0);
  const config = JSON.parse(readFileSync(join(output, "build/server/wrangler.json"), "utf8"));
  expect(config.vars[seatVariable]).toBe(seats);
});
