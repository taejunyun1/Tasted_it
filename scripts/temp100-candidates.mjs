import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 2 * 1024 * 1024;
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SHA = /^[a-f0-9]{64}$/;
const PHOTO_LICENSES = new Set(["KOGL-0", "KOGL-1", "CC0", "CC-BY-4.0", "CC-BY-SA-4.0"]);
const rowKeys = ["id", "name", "address", "region", "cuisine", "sourceUrl", "sourceTitle", "checkedAt", "summary", "existenceStatus", "operatingStatus", "chainStatus", "chainNote", "photo", "externalEvaluation"];
const photoKeys = ["imageUrl", "sourcePageUrl", "licenseStatus", "licenseUrl", "attribution", "depictsPlace", "licenseType", "assetSpecificEvidenceUrl", "creator", "localAssetRelativePath", "photoSha256"];
const evaluationKeys = ["kind", "provider", "sourceUrl", "summary", "score", "rightsStatus"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fail = (code) => { throw new Error(code); };

export function parseArguments(args) {
  if (args.length !== 3 || args[0] !== "--prepare" || args[1] !== "--private-dir" || !isAbsolute(args[2]) || args[2].includes("://")) fail("TEMP100_ARGUMENTS_INVALID");
  return args[2];
}

export function validateReferenceUrl(value) {
  try {
    if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw new Error();
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || isIP(host) || !host.includes(".")
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
      || [...url.searchParams.keys()].some((key) => /token|secret|password|credential|signature|api[_-]?key|access[_-]?key/i.test(key))) throw new Error();
    return url.href;
  } catch { fail("TEMP100_REFERENCE_URL_INVALID"); }
}

function fields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail("TEMP100_FIELDS_INVALID");
}
function text(value, limit = 400) {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail("TEMP100_CANDIDATE_INVALID");
  return value.trim();
}
const normalized = (value) => value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s.,()·-]/g, "");
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function validateRow(row, asOf) {
  fields(row, rowKeys); fields(row.photo, photoKeys); fields(row.externalEvaluation, evaluationKeys);
  for (const key of ["id", "name", "address", "region", "cuisine", "sourceTitle", "checkedAt", "summary", "chainNote"]) text(row[key]);
  if (!/^temp100-\d{3}$/.test(row.id) || !/^(?:광주|전남|전라남도)(?:\s|$)/.test(row.region)
    || row.existenceStatus !== "OFFICIAL_LISTING" || row.operatingStatus !== "UNCONFIRMED_WEB_LISTING"
    || !["NO_CHAIN_SIGNAL", "REVIEW_REQUIRED"].includes(row.chainStatus)
    || !/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(row.checkedAt) || !Number.isFinite(Date.parse(row.checkedAt))
    || row.checkedAt.slice(0, 10) > asOf) fail("TEMP100_CANDIDATE_INVALID");
  validateReferenceUrl(row.sourceUrl);
  const p = row.photo;
  validateReferenceUrl(p.sourcePageUrl);
  if (p.imageUrl !== null) validateReferenceUrl(p.imageUrl);
  if (p.licenseUrl !== null) validateReferenceUrl(p.licenseUrl);
  text(p.attribution);
  if (!["PAGE_ASSOCIATED", "UNCONFIRMED"].includes(p.depictsPlace)
    || !["LINK_ONLY_UNCONFIRMED", "PERMITTED"].includes(p.licenseStatus)) fail("TEMP100_CANDIDATE_INVALID");
  if (p.licenseStatus === "PERMITTED") {
    if (!p.imageUrl || !PHOTO_LICENSES.has(p.licenseType) || !p.licenseUrl || !p.assetSpecificEvidenceUrl || !p.creator || p.depictsPlace !== "PAGE_ASSOCIATED") fail("TEMP100_PHOTO_EVIDENCE_REQUIRED");
    validateReferenceUrl(p.assetSpecificEvidenceUrl); text(p.creator);
  }
  if (p.localAssetRelativePath !== undefined && p.localAssetRelativePath !== null) {
    if (p.licenseStatus !== "PERMITTED" || !/^photos\/[a-z0-9][a-z0-9-]*\.(?:jpg|jpeg|png|webp)$/.test(p.localAssetRelativePath) || !SHA.test(p.photoSha256 ?? "")) fail("TEMP100_PHOTO_EVIDENCE_REQUIRED");
  }
  const e = row.externalEvaluation;
  if (e.score !== null) fail("TEMP100_EXTERNAL_SCORE_FORBIDDEN");
  if (!["OFFICIAL_CURATION", "EXTERNAL_RATING_REFERENCE"].includes(e.kind) || e.rightsStatus !== "LINK_REFERENCE") fail("TEMP100_CANDIDATE_INVALID");
  text(e.provider); text(e.summary); validateReferenceUrl(e.sourceUrl);
}

function renderPreview(candidates, verifiedAssets) {
  const link = (url, label) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  const cards = candidates.map((r) => {
    const p = r.photo;
    const local = p.localAssetRelativePath && verifiedAssets.has(p.localAssetRelativePath);
    const photo = local ? `<img src="${escapeHtml(p.localAssetRelativePath)}" alt="${escapeHtml(r.name)} — 출처 사진" loading="lazy"><p>원본 라이선스 근거 있음 · 관리자 최종 검수 대기</p>` : "<p>사진 표시 보류 — 이용권리/장소 일치 확인 필요</p>";
    return `<article><h2>${escapeHtml(r.id)} · ${escapeHtml(r.name)}</h2><p>${escapeHtml(r.address)} · ${escapeHtml(r.cuisine)}</p>${photo}<p>${escapeHtml(r.summary)}</p><p>외부 자료: ${escapeHtml(r.externalEvaluation.provider)} · ${escapeHtml(r.externalEvaluation.summary)}</p><p>${link(r.sourceUrl, "장소 출처")} · ${link(r.externalEvaluation.sourceUrl, "외부 평가·선정 근거")}${p.imageUrl ? ` · ${link(p.imageUrl, "원본 사진 링크")}` : ""}${p.licenseUrl ? ` · ${link(p.licenseUrl, "사진 권리 근거")}` : ""}</p><p>${escapeHtml(p.attribution)}</p><p>확인일 ${escapeHtml(r.checkedAt)} · 영업/체인/권리/개인정보 최종 검수 대기</p><p>${escapeHtml(r.chainNote)}</p></article>`;
  }).join("\n");
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${verifiedAssets.size ? "file:" : "'none'"}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>TEMP100 관리자 로컬 검수</title><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:32px auto;padding:0 16px;line-height:1.6;color:#172b22}article{border:1px solid #ccd5ce;border-radius:12px;margin:20px 0;padding:20px}h2{font-size:1.2rem}img{max-width:100%;max-height:360px;object-fit:contain}a{color:#145a44}header{background:#f5f0dc;padding:20px}</style><header><h1>TEMP100 · 관리자 로컬 검수 자료</h1><p>비공개 · 공개/추천 반영 0 · 실제 방문/리뷰어 승인 아님. 외부 공식 선정·소개는 고객별점과 다릅니다. 사진이 보이지 않으면 권리 확인 대기이며 원본 링크만 제공합니다. 외부 링크는 사용자가 선택할 때만 열립니다.</p></header>${cards}</html>\n`;
}

export function buildTemp100Artifacts(input, asOf, verifiedAssets = new Set()) {
  if (!Array.isArray(input) || input.length !== 100) fail("TEMP100_COUNT_INVALID");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail("TEMP100_CANDIDATE_INVALID");
  const rows = structuredClone(input).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const expectedIds = Array.from({ length: 100 }, (_, n) => `temp100-${String(n + 1).padStart(3, "0")}`);
  if (rows.some((row, n) => row.id !== expectedIds[n])) fail("TEMP100_IDENTIFIERS_INVALID");
  const seen = new Set();
  const candidates = rows.map((row) => {
    validateRow(row, asOf);
    const identity = `${normalized(row.name)}|${normalized(row.address)}`;
    if (seen.has(identity)) fail("TEMP100_DUPLICATE_PLACE");
    seen.add(identity);
    return { ...row, candidateKey: `temp100:${hash(identity)}`, publicationStatus: "QUARANTINED", reviewStatus: "PENDING_REVIEW", rightsReviewStatus: "PENDING", visibility: "PRIVATE", internalScore: null, reviewerVisit: null };
  });
  const dataset = { schemaVersion: "temp100-v1", purpose: "ADMIN_REVIEW_PREVIEW_ONLY", asOf, candidates };
  const datasetSha256 = hash(json(dataset));
  const photoRightsEvidencePresent = candidates.filter((r) => r.photo.licenseStatus === "PERMITTED").length;
  const aggregate = { schemaVersion: "temp100-v1", asOf, candidateCount: candidates.length, sourceReferenceCount: candidates.length,
    photoReferenceCount: candidates.filter((r) => r.photo.imageUrl).length, photoRightsEvidencePresent,
    photoRightsConfirmed: 0, photoRightsBlocked: 100 - photoRightsEvidencePresent, localPhotoPreviewCount: verifiedAssets.size,
    externalCurationCount: candidates.filter((r) => r.externalEvaluation.kind === "OFFICIAL_CURATION").length,
    externalNumericScoreCount: 0, internalScoreCount: 0, publishedCount: 0, pendingReviewCount: candidates.length,
    operatingStatusConfirmed: 0, chainStatusConfirmed: 0, datasetSha256,
    completion: photoRightsEvidencePresent === 100 && verifiedAssets.size === 100 ? "PHOTO_EVIDENCE_READY_ADMIN_REVIEW_PENDING" : "PARTIAL_PHOTO_RIGHTS_PENDING" };
  const importPlan = { schemaVersion: "temp100-import-plan-v1", target: "ADMIN_ONLY_QUARANTINE_ADAPTER_NOT_IMPLEMENTED", datasetSha256,
    canWriteDatabase: false, canPublish: false, canAffectRatings: false, operationCount: 0,
    records: candidates.map((r) => ({ id: r.id, idempotencyKey: r.candidateKey, revisionSha256: hash(json(r)), intendedStatus: "QUARANTINED", requiredReviews: ["PLACE_IDENTITY", "OPERATING_STATUS", "LOCAL_DINING_V1", "PHOTO_RIGHTS", "PHOTO_PLACE_MATCH", "PRIVACY"], existingPlaceMatch: "UNRESOLVED" })) };
  return { dataset, aggregate, importPlan, previewHtml: renderPreview(candidates, verifiedAssets) };
}

function assertOwned(node, directory) {
  const stat = lstatSync(node);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || stat.uid !== process.getuid() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) fail("TEMP100_PRIVATE_DIRECTORY_REQUIRED");
  return stat;
}
export function assertPrivateDirectory(directory, operationsRoot) {
  try {
    const root = realpathSync(operationsRoot);
    if (dirname(resolve(directory)) !== root || !/^temp100-seed-\d{8}-[a-zA-Z0-9-]+$/.test(basename(directory))) fail("TEMP100_PRIVATE_DIRECTORY_REQUIRED");
    assertOwned(directory, true);
    if (realpathSync(directory) !== resolve(directory)) fail("TEMP100_PRIVATE_DIRECTORY_REQUIRED");
    return realpathSync(directory);
  } catch { fail("TEMP100_PRIVATE_DIRECTORY_REQUIRED"); }
}
function readPrivateFile(file, limit = MAX_BYTES) {
  let fd;
  try {
    assertOwned(file, false);
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > limit || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) fail("TEMP100_PRIVATE_FILE_INVALID");
    const bytes = readFileSync(fd);
    if (bytes.length > limit) fail("TEMP100_PRIVATE_FILE_INVALID");
    return bytes;
  } catch { fail("TEMP100_PRIVATE_FILE_INVALID"); }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function writePrivateArtifacts(directory, artifacts) {
  assertOwned(directory, true);
  const outputs = { "candidates.json": json(artifacts.dataset), "aggregate.json": json(artifacts.aggregate), "import-plan.json": json(artifacts.importPlan), "preview.html": artifacts.previewHtml };
  for (const [name, content] of Object.entries(outputs)) {
    try { if (hash(readPrivateFile(join(directory, name))) !== hash(content)) fail("TEMP100_ARTIFACT_CONFLICT"); }
    catch (error) { if (error.message === "TEMP100_ARTIFACT_CONFLICT") throw error; try { lstatSync(join(directory, name)); fail("TEMP100_ARTIFACT_CONFLICT"); } catch (e) { if (e.code !== "ENOENT") throw e; } }
  }
  for (const [name, content] of Object.entries(outputs)) {
    try { writeFileSync(join(directory, name), content, { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; if (hash(readPrivateFile(join(directory, name))) !== hash(content)) fail("TEMP100_ARTIFACT_CONFLICT"); }
  }
}

function validatedLocalAssets(directory, rows) {
  const verified = new Set();
  for (const row of rows) {
    const p = row.photo;
    if (!p.localAssetRelativePath) continue;
    if (p.licenseStatus !== "PERMITTED") fail("TEMP100_PHOTO_EVIDENCE_REQUIRED");
    assertOwned(join(directory, "photos"), true);
    const bytes = readPrivateFile(join(directory, p.localAssetRelativePath), 8 * 1024 * 1024);
    const image = (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP");
    if (!image || hash(bytes) !== p.photoSha256) fail("TEMP100_PHOTO_BYTES_INVALID");
    verified.add(p.localAssetRelativePath);
  }
  return verified;
}

function main() {
  const directory = parseArguments(process.argv.slice(2));
  const commonGit = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" }).trim();
  const operationsRoot = join(dirname(commonGit), ".superpowers", "operations");
  assertPrivateDirectory(directory, operationsRoot); assertOwned(join(directory, "shards"), true);
  const rows = ["gwangju.json", "jeonnam.json"].flatMap((name) => JSON.parse(readPrivateFile(join(directory, "shards", name)).toString("utf8")));
  const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  buildTemp100Artifacts(rows, asOf); // Validate all paths/claims before reading any optional image.
  const artifacts = buildTemp100Artifacts(rows, asOf, validatedLocalAssets(directory, rows));
  writePrivateArtifacts(directory, artifacts);
  process.stdout.write(json(artifacts.aggregate));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`${/^TEMP100_[A-Z_]+$/.test(error.message) ? error.message : "TEMP100_PREPARATION_FAILED"}\n`); process.exitCode = 1; }
}
