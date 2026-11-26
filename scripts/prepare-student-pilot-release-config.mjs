import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { buildFingerprint, digest } from "./lib/release-fingerprint.mjs";

const pilotBinding = "STUDENT_REVIEW_PILOT_PHOTOS";
const pilotBucket = "retaste-ab-review-photo-pilot-20261126";
const seatVariable = "STUDENT_REVIEW_PILOT_SEATS";
const seatValues = new Map([["closed", ""], ["a", "A"], ["ab", "A,B"]]);
const configPath = "server/wrangler.json";

const [source, destination, expectedRevision, phase, ...extra] = process.argv.slice(2);
if (!source || !destination || !isAbsolute(source) || !isAbsolute(destination) ||
    !/^[0-9a-f]{40}$/.test(expectedRevision ?? "") || !seatValues.has(phase) || extra.length) {
  throw new Error(
    "Usage: node scripts/prepare-student-pilot-release-config.mjs " +
    "<absolute-candidate-dir> <new-absolute-output-dir> <commit-sha> <closed|a|ab>",
  );
}
const candidate = realpathSync(source);
const output = join(realpathSync(dirname(destination)), basename(destination));
const fromCandidate = relative(candidate, output);
if (!isAbsolute(fromCandidate) && fromCandidate.split(sep)[0] !== "..") {
  throw new Error("Use an output directory outside the candidate");
}

const manifest = JSON.parse(readFileSync(join(candidate, "student-pilot-release.json")));
if (manifest.activation !== "dark" || manifest.revision !== expectedRevision) {
  throw new Error("Expected a dark candidate from the specified revision");
}
const sourceBuild = join(candidate, "build");
const sourceBuildSha256 = buildFingerprint(sourceBuild);
const configBytes = readFileSync(join(sourceBuild, configPath));
const sourceConfigSha256 = digest(configBytes);
if (sourceBuildSha256 !== manifest.buildSha256 || sourceConfigSha256 !== manifest.configSha256) {
  throw new Error("Candidate build or configuration does not match its manifest");
}

const config = JSON.parse(configBytes);
const { vars, r2_buckets: buckets } = config;
const reviewBuckets = Array.isArray(buckets) ? buckets.filter(({ binding }) => binding === "REVIEW_PHOTOS") : [];
if (config.name !== "retaste-beta" || config.preview_urls !== false ||
    vars?.STUDENT_WORKSPACE_ENABLED !== "true" || vars?.REVIEW_PHOTO_UPLOAD_ENABLED !== "false" ||
    vars?.POI_INSTAGRAM_PHOTO_ENABLED !== "true" || Object.hasOwn(vars, seatVariable) ||
    reviewBuckets.length !== 1 || reviewBuckets[0].bucket_name !== "retaste-review-photos" ||
    buckets.some(({ binding, bucket_name }) => binding === pilotBinding || bucket_name === pilotBucket)) {
  throw new Error("Candidate is missing the expected closed production settings");
}

mkdirSync(output, { mode: 0o700 });
const outputBuild = join(output, "build");
cpSync(sourceBuild, outputBuild, { recursive: true, force: false, errorOnExist: true });
if (buildFingerprint(outputBuild) !== sourceBuildSha256) {
  throw new Error("Candidate build changed while being copied");
}

buckets.push({ binding: pilotBinding, bucket_name: pilotBucket });
const configuredSeats = seatValues.get(phase);
if (configuredSeats) vars[seatVariable] = configuredSeats;
const outputConfig = join(outputBuild, configPath);
const deploymentConfig = JSON.stringify(config, null, 2) + "\n";
writeFileSync(outputConfig, deploymentConfig);
const receipt = {
  revision: expectedRevision,
  phase,
  configuredSeats,
  sourceBuildSha256,
  sourceConfigSha256,
  deploymentConfigSha256: digest(deploymentConfig),
  deploymentBuildSha256: buildFingerprint(outputBuild),
};
writeFileSync(join(output, "student-pilot-config.json"), JSON.stringify(receipt, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log(outputConfig);
