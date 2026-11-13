import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const expectedHash = "d949f94c4a760aa42c2894ff220c0203d272da49a793cbe402dc79e38cedc900";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceHosts = new Set(["tour.gwangju.go.kr", "www.yeosu.go.kr", "m.xn--o39a81gi2cv0je9ktug.kr"]);
function reference(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !sourceHosts.has(url.hostname) || url.username || url.password) throw new Error("TEMP_REFERENCE_INVALID");
  return url.toString();
}
async function privateFile(file, maximum) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size > maximum) throw new Error("TEMP_PRIVATE_FILE_INVALID");
  return readFile(file);
}
export function assertNoImageMetadata(bytes, contentType) {
  if (contentType === "image/jpeg") {
    if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error("TEMP_IMAGE_SIGNATURE_INVALID");
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error("TEMP_IMAGE_SIGNATURE_INVALID");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) return;
      if ([0xe1, 0xed, 0xfe].includes(marker)) throw new Error("TEMP_IMAGE_PRIVATE_METADATA");
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error("TEMP_IMAGE_SIGNATURE_INVALID");
      offset += length;
    }
  } else if (contentType === "image/png") {
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("TEMP_IMAGE_SIGNATURE_INVALID");
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), chunk = bytes.subarray(offset + 4, offset + 8).toString();
      if (["eXIf", "tEXt", "iTXt", "zTXt"].includes(chunk)) throw new Error("TEMP_IMAGE_PRIVATE_METADATA");
      if (chunk === "IEND") return;
      offset += length + 12;
    }
  } else if (contentType === "image/webp") {
    if (bytes.subarray(0, 4).toString() !== "RIFF" || bytes.subarray(8, 12).toString() !== "WEBP") throw new Error("TEMP_IMAGE_SIGNATURE_INVALID");
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunk = bytes.subarray(offset, offset + 4).toString(), length = bytes.readUInt32LE(offset + 4);
      if (["EXIF", "XMP "].includes(chunk)) throw new Error("TEMP_IMAGE_PRIVATE_METADATA");
      offset += 8 + length + (length % 2);
    }
    if (offset === bytes.length) return;
  }
  throw new Error("TEMP_IMAGE_SIGNATURE_INVALID");
}
export async function buildTemp100Public(sourceDirectory, outputDirectory) {
  const sourceRoot = path.resolve(sourceDirectory), outputRoot = path.resolve(outputDirectory);
  if (sourceRoot === outputRoot || !outputRoot.includes(`${path.sep}.superpowers${path.sep}operations${path.sep}`)) throw new Error("TEMP_OUTPUT_PRIVATE_REQUIRED");
  const bytes = await privateFile(path.join(sourceRoot, "candidates.json"), 16 * 1024 * 1024);
  if (sha(bytes) !== expectedHash) throw new Error("TEMP_SOURCE_REVISION_MISMATCH");
  const source = JSON.parse(bytes);
  if (source.candidates.length !== 100) throw new Error("TEMP100_COUNT_MISMATCH");
  const uploads = [];
  const entries = [];
  for (const row of source.candidates) {
    let photo = null;
    if (row.photo.localAssetRelativePath) {
      if (row.photo.licenseStatus !== "PERMITTED" || row.photo.licenseType !== "KOGL-1" || !/^photos\/temp100-\d{3}\.(jpg|jpeg|png|webp)$/.test(row.photo.localAssetRelativePath)) throw new Error("TEMP_PHOTO_INVALID");
      const asset = path.join(sourceRoot, row.photo.localAssetRelativePath);
      const photoBytes = await privateFile(asset, 8 * 1024 * 1024);
      if (sha(photoBytes) !== row.photo.photoSha256) throw new Error("TEMP_PHOTO_HASH_MISMATCH");
      const extension = path.extname(asset).slice(1);
      const contentType = extension === "webp" ? "image/webp" : extension === "png" ? "image/png" : "image/jpeg";
      assertNoImageMetadata(photoBytes, contentType);
      photo = { sha256: row.photo.photoSha256, contentType, licenseType: "KOGL-1", licenseUrl: row.photo.licenseUrl, attribution: row.photo.attribution, creator: row.photo.creator, evidenceUrl: reference(row.photo.assetSpecificEvidenceUrl) };
      uploads.push({ sourceId: row.id, localPath: asset, sha256: photo.sha256, contentType });
    }
    entries.push({ sourceId: row.id, name: row.name, address: row.address, region: row.region, cuisine: row.cuisine,
      summary: `${row.region}에 위치한 ${row.cuisine} 음식점입니다. 공식 관광 안내의 장소 정보를 바탕으로 정리했습니다. 현재 영업 여부와 메뉴·가격은 방문 전 원문에서 확인해 주세요.`,
      sourceUrl: reference(row.sourceUrl), sourceTitle: row.sourceTitle, checkedAt: row.checkedAt,
      evaluation: { kind: "OFFICIAL_CURATION", provider: row.externalEvaluation.provider, sourceUrl: reference(row.externalEvaluation.sourceUrl) }, photo });
  }
  if (uploads.length !== 23 || new Set(entries.map((e) => e.sourceId)).size !== 100) throw new Error("TEMP100_COUNT_MISMATCH");
  const manifest = { schemaVersion: 1, sourceHash: expectedHash, entries };
  const manifestHash = sha(JSON.stringify(manifest));
  const batchId = `temp100-${manifestHash.slice(0, 16)}`;
  for (const upload of uploads) upload.objectKey = `temp100/${batchId}/${upload.sourceId}-${upload.sha256}.${upload.contentType === "image/webp" ? "webp" : upload.contentType === "image/png" ? "png" : "jpg"}`;
  await mkdir(outputRoot, { mode: 0o700, recursive: false });
  await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode: 0o600 });
  await writeFile(path.join(outputRoot, "photo-upload-plan.json"), `${JSON.stringify({ batchId, manifestHash, uploads }, null, 2)}\n`, { flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode: 0o600 });
  return { batchId, manifestHash, count: entries.length, photographs: uploads.length, noInlinePhoto: entries.length - uploads.length };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw new Error("usage: node scripts/build-temp100-public.mjs <private-source-directory> <new-private-output-directory>");
  console.log(JSON.stringify(await buildTemp100Public(source, output)));
}
