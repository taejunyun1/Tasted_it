import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFingerprint, digest } from "./lib/release-fingerprint.mjs";

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
const publicLocationPatch = "ops/releases/public-location-494c07f.patch";
const publicLocationTargets = [
  "app/components/map/HomeCurationCards.tsx",
  "app/components/map/HomeCurationPanel.tsx",
  "app/components/map/HomeCurationSheet.tsx",
  "app/components/map/MapExplorerPanel.tsx",
  "app/components/map/PlaceMap.tsx",
  "app/features/http/security-headers.ts",
  "app/features/maps/location-policy.ts",
  "app/features/maps/use-map-location-request.ts",
  "app/routes/home.tsx",
  "app/routes/map-category.tsx",
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
  "app/components/places/PlacePublicEvidence.tsx",
  "app/db/student-review-pilot-photo.ts",
  "app/features/ratings/student-review-pilot-photo.server.ts",
  "app/routes/admin-student-review-photos.tsx",
  "app/routes/reviewer-pilot-photo.tsx",
  "app/routes/student-review-photo.ts",
];
const reviewerPlacePickerPatch = "ops/releases/reviewer-place-picker-494c07f.patch";
const reviewerPlacePickerTargets = [
  "app/components/reviewer-visit-flow.tsx",
  "app/routes.ts",
  "app/routes/reviewer-ratings.tsx",
];
const reviewerPlacePickerFiles = [
  "app/components/reviewer-place-picker.tsx",
  "app/features/ratings/reviewer-place-search.server.ts",
  "app/features/ratings/reviewer-place-search.ts",
  "app/routes/reviewer-places-resource.ts",
  "app/styles/reviewer-place-picker.css",
];
const placeDetailVoteLinkPatch = "ops/releases/place-detail-vote-link-494c07f.patch";
const placeDetailVoteLinkTargets = ["app/components/places/PlaceDetailSheet.tsx"];
const publicVotePatch = "ops/releases/public-place-vote-494c07f.patch";
const publicVoteTargets = [
  "app/app.css",
  "app/components/map/PlaceMap.tsx",
  "app/components/onboarding/GuestSaveControl.tsx",
  "app/components/places/PlaceCard.tsx",
  "app/components/places/PlaceDetailSheet.tsx",
  "app/components/ratings/VoteControl.tsx",
  "app/features/auth/login.ts",
  "app/features/ratings/vote.server.ts",
  "app/routes/guest-saves-resource.ts",
  "app/routes/map-category.tsx",
  "app/routes/place-detail.tsx",
];
const publicVoteSupportFiles = [
  "app/features/a11y/focus-return.ts",
  "app/features/auth/place-detail-return.ts",
  "app/features/http/bounded-body.ts",
  "app/features/places/place-detail-client.ts",
  "app/features/places/place-detail-path.ts",
];
const directVerificationPatch = "ops/releases/direct-verification-profile-494c07f.patch";
const directVerificationTargets = ["app/routes/reviewer-profile.tsx"];
const directVerificationAuthorsPatch = "ops/releases/direct-verification-authors-494c07f.patch";
const directVerificationAuthorsTargets = [
  "app/components/places/PlaceDetailSheet.tsx",
  "app/features/ratings/reviewer-publication.server.ts",
];
const directVerificationFiles = ["app/features/reviewers/direct-verification.server.ts"];
const directVerificationReplacementFiles = [
  "app/features/reviewers/reviewer.server.ts",
  "app/routes/reviewer-apply.tsx",
];
const publicPlaceInformationDataPatch = "ops/releases/public-place-information-data-494c07f.patch";
const publicPlaceInformationDataTargets = [
  "app/features/places/place.server.ts",
  "app/features/places/place.types.ts",
];
const publicPlaceInformationUiPatch = "ops/releases/public-place-information-ui-494c07f.patch";
const publicPlaceInformationUiTargets = [
  "app/app.css",
  "app/components/map/MapPlaceDetail.tsx",
  "app/components/map/MapPlaceList.tsx",
  "app/components/places/PlaceDetailSheet.tsx",
  "app/routes/place-detail.tsx",
];
const publicPlaceInformationFiles = [
  "app/components/places/PlaceInformation.tsx",
  "app/features/places/public-information.ts",
  "app/styles/place-information.css",
];
const publicPlaceMapScopePatch = "ops/releases/public-place-map-scope-494c07f.patch";
const publicPlaceMapScopeTargets = [
  "app/components/map/MapExplorerPanel.tsx",
  "app/features/maps/home-curation-options.ts",
  "app/features/places/public-place-map-scope.ts",
  "app/routes/home.tsx",
  "app/routes/map-category.tsx",
  "app/routes/place-list.tsx",
  "app/styles/design-system.css",
];
const publicPlacePaginationDataPatch = "ops/releases/public-place-pagination-data-494c07f.patch";
const publicPlacePaginationDataTargets = ["app/features/places/place.server.ts"];
const publicPlacePaginationUiPatch = "ops/releases/public-place-pagination-ui-494c07f.patch";
const publicPlacePaginationUiTargets = [
  "app/components/map/MapExplorerPanel.tsx",
  "app/components/places/PublicPlacePageError.tsx",
  "app/features/places/public-place-map-scope.ts",
  "app/routes/home.tsx",
  "app/routes/map-category.tsx",
  "app/routes/place-list.tsx",
];
const publicPlacePaginationFiles = [
  "app/features/places/public-metadata.ts",
  "app/features/places/public-place-pagination.ts",
];
const publicAuthContinuationPatch = "ops/releases/public-auth-continuation-494c07f.patch";
const publicAuthContinuationTargets = [
  "app/components/auth/TokenHashField.tsx",
  "app/features/auth/account.server.ts",
  "app/features/auth/session.server.ts",
  "app/routes/auth-google-callback.tsx",
  "app/routes/auth-google.tsx",
  "app/routes/auth-naver-callback.tsx",
  "app/routes/auth-naver.tsx",
  "app/routes/forgot-password.tsx",
  "app/routes/login.tsx",
  "app/routes/reset-password.tsx",
  "app/routes/signup.tsx",
  "app/routes/verify-email.tsx",
];
const publicAuthContinuationFiles = [
  "app/features/auth/auth-form.tsx",
  "app/features/auth/oauth-failure.ts",
  "app/features/auth/verification-link.ts",
];
const poiMediaPublicPatch = "ops/releases/poi-media-public-494c07f.patch";
const poiMediaPublicTargets = [
  "app/components/places/PlaceDetailSheet.tsx",
  "app/features/places/place.server.ts",
  "app/routes/place-detail.tsx",
];
const poiMediaAdminPatch = "ops/releases/poi-media-admin-494c07f.patch";
const poiMediaAdminTargets = [
  "app/cloudflare-env.d.ts",
  "app/db/schema.ts",
  "app/features/operations/admin-activity.server.ts",
  "app/routes.ts",
  "app/routes/admin-places.tsx",
];
const poiMediaFiles = [
  "app/components/places/PlacePoiPhoto.tsx",
  "app/features/poi-media/poi-media-admin.server.ts",
  "app/features/poi-media/poi-media.server.ts",
  "app/features/poi-media/poi-media.ts",
  "app/routes/admin-poi-media-preview.ts",
  "app/routes/admin-poi-media.tsx",
  "app/routes/poi-media.ts",
];
const poiMediaMigrations = [
  "drizzle/0063_place_poi_media.sql",
  "drizzle/0064_place_poi_media_identity_guard.sql",
];
const pilotMigration = "drizzle/0065_student_review_pilot_photos.sql";
const orderedBaselineLedgerSha256 = "a9beee8c240ccef6d667125f9968c4d70483c315d1afe458f99b18c582762928";

function git(args, cwd = repository) {
  return execFileSync("git", args, { cwd, maxBuffer: 128 * 1024 * 1024 });
}

const [output, ...modes] = process.argv.slice(2);
const studentPilot = modes.includes("--student-pilot");
const poiMedia = modes.includes("--poi-media");
if (!output || !isAbsolute(output) || modes.length !== Number(studentPilot) + Number(poiMedia) ||
    (poiMedia && !studentPilot)) {
  throw new Error("Usage: node scripts/build-official-photo-release.mjs <new-absolute-output-dir> [--student-pilot [--poi-media]]");
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

function copyMainFiles(files, { replace = false } = {}) {
  return Object.fromEntries(files.map((file) => {
    const bytes = committed(file);
    const target = join(output, file);
    if (replace && !existsSync(target)) throw new Error(`Missing baseline file for replacement: ${file}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: replace ? "w" : "wx" });
    return [file, digest(bytes)];
  }));
}

const patchSha256 = applyReleasePatch(patch, ".official-photos.patch", patchTargets, ["--unidiff-zero"]);
const photoAssetSha256 = copyMainFiles(mainAssets);
const publicLocationPatchSha256 = applyReleasePatch(publicLocationPatch, ".public-location.patch", publicLocationTargets, ["--unidiff-zero"]);
const pilotProof = studentPilot ? {
  studentPilotPatchSha256: applyReleasePatch(pilotPatch, ".student-pilot.patch", pilotPatchTargets),
  studentPilotFileSha256: copyMainFiles(pilotMainFiles),
  reviewerPlacePickerPatchSha256: applyReleasePatch(
    reviewerPlacePickerPatch, ".reviewer-place-picker.patch", reviewerPlacePickerTargets,
  ),
  reviewerPlacePickerFileSha256: copyMainFiles(reviewerPlacePickerFiles),
  migration: { file: pilotMigration, sha256: digest(committed(pilotMigration)), applied: false },
  orderedBaselineLedgerSha256,
} : null;
const placeDetailVoteLinkPatchSha256 = applyReleasePatch(
  placeDetailVoteLinkPatch, ".place-detail-vote-link.patch", placeDetailVoteLinkTargets,
);
const publicVoteSupportFileSha256 = copyMainFiles(publicVoteSupportFiles);
const publicVotePatchSha256 = applyReleasePatch(
  publicVotePatch, ".public-place-vote.patch", publicVoteTargets, ["--unidiff-zero"],
);
const directVerificationFileSha256 = {
  ...copyMainFiles(directVerificationFiles),
  ...copyMainFiles(directVerificationReplacementFiles, { replace: true }),
};
const directVerificationPatchSha256 = applyReleasePatch(
  directVerificationPatch, ".direct-verification-profile.patch", directVerificationTargets,
);
const poiMediaProof = poiMedia ? {
  activation: "dark",
  publicPatchSha256: applyReleasePatch(poiMediaPublicPatch, ".poi-media-public.patch", poiMediaPublicTargets),
  adminPatchSha256: applyReleasePatch(poiMediaAdminPatch, ".poi-media-admin.patch", poiMediaAdminTargets),
  fileSha256: copyMainFiles(poiMediaFiles),
  requiredMigrations: poiMediaMigrations.map((file) => ({ file, sha256: digest(committed(file)), applied: false })),
} : null;
const directVerificationAuthorsPatchSha256 = studentPilot ? applyReleasePatch(
  directVerificationAuthorsPatch, ".direct-verification-authors.patch", directVerificationAuthorsTargets,
) : null;
const publicPlaceInformationProof = {
  dataPatchSha256: applyReleasePatch(
    publicPlaceInformationDataPatch, ".public-place-information-data.patch", publicPlaceInformationDataTargets,
  ),
  uiPatchSha256: applyReleasePatch(
    publicPlaceInformationUiPatch, ".public-place-information-ui.patch", publicPlaceInformationUiTargets,
  ),
  fileSha256: copyMainFiles(publicPlaceInformationFiles),
};
const publicPlaceMapScopePatchSha256 = applyReleasePatch(
  publicPlaceMapScopePatch, ".public-place-map-scope.patch", publicPlaceMapScopeTargets,
);
const publicPlacePaginationProof = {
  dataPatchSha256: applyReleasePatch(
    publicPlacePaginationDataPatch, ".public-place-pagination-data.patch", publicPlacePaginationDataTargets,
  ),
  uiPatchSha256: applyReleasePatch(
    publicPlacePaginationUiPatch, ".public-place-pagination-ui.patch", publicPlacePaginationUiTargets,
  ),
  fileSha256: copyMainFiles(publicPlacePaginationFiles),
};
const publicAuthContinuationProof = {
  patchSha256: applyReleasePatch(
    publicAuthContinuationPatch, ".public-auth-continuation.patch", publicAuthContinuationTargets,
  ),
  fileSha256: copyMainFiles(publicAuthContinuationFiles),
};
for (const args of [["install", "--frozen-lockfile", "--prod=false"], ["run", "build"]]) {
  execFileSync("pnpm", args, { cwd: output, env: environment, stdio: "inherit" });
}

const buildRoot = join(output, "build");
const buildConfig = join(buildRoot, "server/wrangler.json");
const configBytes = readFileSync(buildConfig);
const attestation = {
  revision,
  baseline,
  patchSha256,
  publicLocationPatchSha256,
  placeDetailVoteLinkPatchSha256,
  publicVotePatchSha256,
  publicVoteSupportFileSha256,
  directVerificationPatchSha256,
  directVerificationFileSha256,
  publicPlaceInformation: publicPlaceInformationProof,
  publicPlaceMapScopePatchSha256,
  publicPlacePagination: publicPlacePaginationProof,
  publicAuthContinuation: publicAuthContinuationProof,
  photoAssetSha256,
  configSha256: digest(configBytes),
  buildSha256: buildFingerprint(buildRoot),
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
  if (poiMediaProof && Object.hasOwn(config.vars ?? {}, "POI_MEDIA_PUBLIC_ENABLED")) {
    throw new Error("The POI media compatibility build must leave publication off");
  }
  writeFileSync(join(output, "student-pilot-release.json"), JSON.stringify({
    ...attestation,
    ...pilotProof,
    directVerificationAuthorsPatchSha256,
    ...(poiMediaProof ? { poiMedia: poiMediaProof } : {}),
    activation: "dark",
  }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
} else {
  writeFileSync(join(output, "official-photo-release.json"), JSON.stringify(attestation, null, 2) + "\n",
    { mode: 0o600, flag: "wx" });
}
console.log(buildConfig);
