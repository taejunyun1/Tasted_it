import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  getPoiMediaObjectKey,
  POI_MEDIA_CONTENT_TYPE,
  POI_MEDIA_MAX_BYTES,
  poiMediaAttributionSchema,
  poiMediaIdSchema,
  poiMediaRightsBasisSchema,
  poiMediaRightsEvidenceSchema,
  poiMediaSha256Schema,
  poiMediaSourceUrlSchema,
} from "../app/features/poi-media/poi-media.ts";
import { parseReviewerPhotoFiles } from "../app/features/ratings/reviewer-photo.ts";

const maximumBatchBytes = 64 * 1024 * 1024;
const identity = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(300),
  address: z.string().min(1).max(800),
}).strict();
const manifest = z.object({
  schemaVersion: z.literal(1),
  photos: z.array(z.object({
    id: poiMediaIdSchema,
    place: identity,
    sourceUrl: poiMediaSourceUrlSchema,
    attribution: poiMediaAttributionSchema,
    rightsBasis: poiMediaRightsBasisSchema,
    rightsEvidence: poiMediaRightsEvidenceSchema,
    reviewedAt: z.string().datetime({ precision: 3 }),
    sha256: poiMediaSha256Schema,
    file: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.jpg$/),
  }).strict()).min(1).max(25),
}).strict();
const snapshot = z.array(identity).min(1).max(1000);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function quote(value) {
  if (value.includes("\u0000")) throw new Error("POI_INPUT_CHARACTER_INVALID");
  return `'${value.replaceAll("'", "''")}'`;
}

async function readBoundedFile(path, maximumSize) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximumSize) throw new Error("POI_INPUT_SIZE_INVALID");
    const data = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(data, { length: stat.size, position: 0 });
    if (bytesRead !== stat.size || (await handle.stat()).size !== stat.size) throw new Error("POI_INPUT_CHANGED");
    return data;
  } finally {
    await handle.close();
  }
}

export async function preparePoiMediaPlan(rawManifest, rawSnapshot, assetsDir, now = new Date()) {
  const { photos } = manifest.parse(rawManifest);
  const places = snapshot.parse(rawSnapshot);
  const byId = new Map(places.map((place) => [place.id, place]));
  if (byId.size !== places.length || new Set(photos.map((photo) => photo.id)).size !== photos.length) {
    throw new Error("POI_DUPLICATE_ID");
  }

  let totalBytes = 0;
  const plan = [];
  const rows = [];
  for (const photo of photos) {
    const place = byId.get(photo.place.id);
    if (place?.name !== photo.place.name || place.address !== photo.place.address) throw new Error("POI_PLACE_MISMATCH");
    if (!Number.isFinite(Date.parse(photo.reviewedAt)) || Date.parse(photo.reviewedAt) > now.getTime()) throw new Error("POI_REVIEW_DATE_INVALID");

    const bytes = await readBoundedFile(join(assetsDir, photo.file), POI_MEDIA_MAX_BYTES);
    totalBytes += bytes.length;
    if (totalBytes > maximumBatchBytes) throw new Error("POI_BATCH_SIZE_INVALID");
    if (hash(bytes) !== photo.sha256) throw new Error("POI_PHOTO_HASH_MISMATCH");
    const form = new FormData();
    form.append("photos", new File([bytes], photo.file, { type: POI_MEDIA_CONTENT_TYPE }));
    await parseReviewerPhotoFiles(form);

    plan.push({ file: photo.file, objectKey: getPoiMediaObjectKey(photo.id, photo.sha256), sha256: photo.sha256, size: bytes.length });
    const placeId = `(SELECT p.id FROM places p
      WHERE p.id=${quote(place.id)} AND p.name=${quote(place.name)} AND p.address=${quote(place.address)}
        AND p.status='PUBLISHED' AND p.closed_at IS NULL
        AND EXISTS(SELECT 1 FROM place_categories pc JOIN categories c ON c.id=pc.category_id
          WHERE pc.place_id=p.id AND pc.is_primary=1)
        AND NOT EXISTS(SELECT 1 FROM temp_catalog_entries e JOIN temp_catalog_batches b ON b.id=e.batch_id
          WHERE e.place_id=p.id AND b.status='PUBLISHED'))`;
    rows.push(`(${quote(photo.id)},${placeId},'STAGED',${[
      photo.sourceUrl, photo.attribution, photo.rightsBasis, photo.rightsEvidence, photo.sha256,
    ].map(quote).join(",")},${bytes.length},'${POI_MEDIA_CONTENT_TYPE}',${quote(photo.reviewedAt)})`);
  }
  const stagedSql = `INSERT INTO place_poi_media(id,place_id,state,source_url,attribution,rights_basis,rights_evidence,sha256,byte_size,content_type,reviewed_at) VALUES\n${rows.join(",\n")};\n`;
  if (Buffer.byteLength(stagedSql) > 100_000) throw new Error("POI_SQL_SIZE_INVALID");
  return { count: plan.length, totalBytes, assets: plan, stagedSql, stagedSqlSha256: hash(stagedSql) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestFile, snapshotFile, assetsDir, outputFile, ...extra] = process.argv.slice(2);
  if (!manifestFile || !snapshotFile || !assetsDir || !outputFile || extra.length) throw new Error("POI_INPUT_ARGUMENTS_REQUIRED");
  const plan = await preparePoiMediaPlan(
    JSON.parse(await readBoundedFile(manifestFile, 128 * 1024)),
    JSON.parse(await readBoundedFile(snapshotFile, 2 * 1024 * 1024)),
    assetsDir,
  );
  await writeFile(outputFile, JSON.stringify(plan, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ count: plan.count, totalBytes: plan.totalBytes, stagedSqlSha256: plan.stagedSqlSha256 }));
}
