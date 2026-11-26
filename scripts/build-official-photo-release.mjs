import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const baseline = "494c07f56c174df42a3b027b1639772e2d9796b7";
const repository = fileURLToPath(new URL("../", import.meta.url));
const patch = "ops/releases/official-photos-494c07f.patch";
const patchTargets = [
  "app/cloudflare-env.d.ts",
  "app/components/places/PlaceDetailSheet.tsx",
  "app/features/http/security-headers.ts",
  "app/features/places/place.server.ts",
  "app/routes/place-detail.tsx",
  "workers/app.ts",
  "wrangler.jsonc",
];
const mainAssets = [
  "app/components/places/PlaceInstagramPhoto.tsx",
  "app/features/poi-media/instagram-photos.ts",
];
const pilotPatch = "ops/releases/student-pilot-494c07f.patch";
const pilotPatchTargets = [
  "app/cloudflare-env.d.ts",
  "app/components/places/PlaceDetailSheet.tsx",
  "app/components/reviewer-visit-flow.tsx",
  "app/routes.ts",
  "app/routes/admin-reviewer-visits.tsx",
  "app/routes/place-detail.tsx",
  "app/routes/reviewer-ratings.tsx",
  "app/routes/student-index.tsx",
  "workers/app.ts",
];
const pilotMainFiles = [
  "app/db/student-review-pilot-photo.ts",
  "app/features/http/bounded-body.ts",
  "app/features/ratings/student-review-pilot-photo.server.ts",
  "app/routes/admin-student-review-photos.tsx",
  "app/routes/reviewer-pilot-photo.tsx",
  "app/routes/student-review-photo.ts",
];
const pilotMigration = "drizzle/0065_student_review_pilot_photos.sql";
const orderedBaselineLedgerSha256 = "a9beee8c240ccef6d667125f9968c4d70483c315d1afe458f99b18c582762928";

function git(args, cwd = repository) {
  return execFileSync("git", args, { cwd, maxBuffer: 128 * 1024 * 1024 });
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const [output, mode, ...extra] = process.argv.slice(2);
if (!output || !isAbsolute(output) || extra.length || (mode !== undefined && mode !== "--student-pilot")) {
  throw new Error("Usage: node scripts/build-official-photo-release.mjs <new-absolute-output-dir> [--student-pilot]");
}
const studentPilot = mode === "--student-pilot";
const fromRepository = relative(repository, output);
if (!fromRepository.startsWith("../") || existsSync(output)) {
  throw new Error("Use a new output directory outside the repository");
}
if (git(["status", "--porcelain"]).length > 0) throw new Error("Build from a clean commit");

const revision = git(["rev-parse", "HEAD"]).toString().trim();
const committed = (file) => git(["show", `${revision}:${file}`]);
const baselineFiles = git(["archive", "--format=tar.gz", baseline]);
const environment = {
  ...process.env,
  CI: "1",
  WRANGLER_SEND_METRICS: "false",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
};
delete environment.CLOUDFLARE_ENV;
delete environment.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH;

mkdirSync(output, { mode: 0o700 });
execFileSync("tar", ["-xzf", "-", "-C", output], { input: baselineFiles });
function applyReleasePatch(file, localName, expectedTargets, flags = []) {
  const patchFile = join(output, localName);
  const patchBytes = committed(file);
  writeFileSync(patchFile, patchBytes, { mode: 0o600, flag: "wx" });
  const targets = git(["apply", "--numstat", patchFile], output).toString().trim().split("\n")
    .map((row) => row.split("\t")[2]).sort();
  if (JSON.stringify(targets) !== JSON.stringify(expectedTargets)) {
    throw new Error(`Unexpected release patch targets in ${file}`);
  }
  git(["apply", "--check", ...flags, patchFile], output);
  git(["apply", ...flags, patchFile], output);
  return digest(patchBytes);
}

function copyMainFiles(files) {
  return Object.fromEntries(files.map((file) => {
    const bytes = committed(file);
    const target = join(output, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: "wx" });
    return [file, digest(bytes)];
  }));
}

const patchSha256 = applyReleasePatch(patch, ".official-photos.patch", patchTargets, ["--unidiff-zero"]);
const photoAssetSha256 = copyMainFiles(mainAssets);
const pilotProof = studentPilot ? {
  studentPilotPatchSha256: applyReleasePatch(pilotPatch, ".student-pilot.patch", pilotPatchTargets),
  studentPilotFileSha256: copyMainFiles(pilotMainFiles),
  migration: { file: pilotMigration, sha256: digest(committed(pilotMigration)), applied: false },
  orderedBaselineLedgerSha256,
} : null;
for (const args of [["install", "--frozen-lockfile", "--prod=false"], ["run", "build"]]) {
  execFileSync("pnpm", args, { cwd: output, env: environment, stdio: "inherit" });
}

const buildRoot = join(output, "build");
const buildConfig = join(buildRoot, "server/wrangler.json");
const emittedFiles = readdirSync(buildRoot, { recursive: true }).sort()
  .filter((file) => lstatSync(join(buildRoot, file)).isFile())
  .map((file) => [file, digest(readFileSync(join(buildRoot, file)))]);
const configBytes = readFileSync(buildConfig);
const attestation = {
  revision,
  baseline,
  patchSha256,
  photoAssetSha256,
  configSha256: digest(configBytes),
  buildSha256: digest(JSON.stringify(emittedFiles)),
};
if (pilotProof) {
  const config = JSON.parse(configBytes);
  const buckets = config.r2_buckets ?? [];
  const photoBucket = buckets.find(({ binding }) => binding === "REVIEW_PHOTOS");
  if (config.vars?.REVIEW_PHOTO_UPLOAD_ENABLED !== "false" ||
      config.vars?.POI_INSTAGRAM_PHOTO_ENABLED !== "true" ||
      Object.hasOwn(config.vars ?? {}, "STUDENT_REVIEW_PILOT_SEATS") ||
      buckets.some(({ binding }) => binding === "STUDENT_REVIEW_PILOT_PHOTOS") ||
      photoBucket?.bucket_name !== "retaste-review-photos") {
    throw new Error("The student pilot must build dark and preserve the existing photo storage");
  }
  writeFileSync(join(output, "student-pilot-release.json"), JSON.stringify({
    ...attestation,
    ...pilotProof,
    activation: "dark",
  }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
} else {
  writeFileSync(join(output, "official-photo-release.json"), JSON.stringify(attestation, null, 2) + "\n",
    { mode: 0o600, flag: "wx" });
}
console.log(buildConfig);
