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

function git(args, cwd = repository) {
  return execFileSync("git", args, { cwd, maxBuffer: 128 * 1024 * 1024 });
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const [output, ...extra] = process.argv.slice(2);
if (!output || extra.length || !isAbsolute(output)) {
  throw new Error("Usage: node scripts/build-official-photo-release.mjs <new-absolute-output-dir>");
}
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
const patchFile = join(output, ".official-photos.patch");
const patchBytes = committed(patch);
writeFileSync(patchFile, patchBytes, { mode: 0o600, flag: "wx" });
const targets = git(["apply", "--numstat", patchFile], output).toString().trim().split("\n")
  .map((row) => row.split("\t")[2]).sort();
if (JSON.stringify(targets) !== JSON.stringify(patchTargets)) throw new Error("Unexpected release patch targets");
git(["apply", "--check", "--unidiff-zero", patchFile], output);
git(["apply", "--unidiff-zero", patchFile], output);
for (const asset of mainAssets) {
  const target = join(output, asset);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, committed(asset), { flag: "wx" });
}
for (const args of [["install", "--frozen-lockfile", "--prod=false"], ["run", "build"]]) {
  execFileSync("pnpm", args, { cwd: output, env: environment, stdio: "inherit" });
}

const buildRoot = join(output, "build");
const buildConfig = join(buildRoot, "server/wrangler.json");
const emittedFiles = readdirSync(buildRoot, { recursive: true }).sort()
  .filter((file) => lstatSync(join(buildRoot, file)).isFile())
  .map((file) => [file, digest(readFileSync(join(buildRoot, file)))]);
writeFileSync(join(output, "official-photo-release.json"), JSON.stringify({
  revision,
  baseline,
  patchSha256: digest(patchBytes),
  photoAssetSha256: Object.fromEntries(mainAssets.map((file) => [file, digest(committed(file))])),
  configSha256: digest(readFileSync(buildConfig)),
  buildSha256: digest(JSON.stringify(emittedFiles)),
}, null, 2) + "\n", { mode: 0o600, flag: "wx" });
console.log(buildConfig);
