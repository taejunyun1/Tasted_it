import { and, desc, eq, exists, isNull, notExists, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../db/client.server";
import { categories, placeCategories, placePoiMedia, places, tempCatalogBatches, tempCatalogEntries } from "../../db/schema";
import { publicConditions } from "../places/place.server";
import {
  getPoiMediaObjectKey, POI_MEDIA_CONTENT_TYPE, poiMediaAttributionSchema, poiMediaByteSizeSchema,
  poiMediaIdSchema, poiMediaRightsBasisSchema, poiMediaRightsEvidenceSchema, poiMediaSha256Schema,
  poiMediaSourceUrlSchema, type PublicPoiPhoto,
} from "./poi-media";

export const poiMediaEvidenceSchema = z.object({
  id: poiMediaIdSchema,
  sourceUrl: poiMediaSourceUrlSchema,
  attribution: poiMediaAttributionSchema,
  rightsBasis: poiMediaRightsBasisSchema,
  rightsEvidence: poiMediaRightsEvidenceSchema,
  sha256: poiMediaSha256Schema,
  byteSize: poiMediaByteSizeSchema,
  contentType: z.literal(POI_MEDIA_CONTENT_TYPE),
  reviewedAt: z.iso.datetime({ precision: 3 }),
});

type PoiMediaEvidence = z.infer<typeof poiMediaEvidenceSchema>;

export const poiMediaEvidenceFields = {
  id: placePoiMedia.id,
  sourceUrl: placePoiMedia.sourceUrl,
  attribution: placePoiMedia.attribution,
  rightsBasis: placePoiMedia.rightsBasis,
  rightsEvidence: placePoiMedia.rightsEvidence,
  sha256: placePoiMedia.sha256,
  byteSize: placePoiMedia.byteSize,
  contentType: placePoiMedia.contentType,
  reviewedAt: placePoiMedia.reviewedAt,
};

export function eligiblePoiMediaPlace(db: AppDb, match: SQL): SQL {
  return exists(db.select({ id: places.id })
    .from(places)
    .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
    .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
    .where(and(
      match,
      publicConditions({}),
      isNull(places.closedAt),
      notExists(db.select({ id: tempCatalogEntries.id })
        .from(tempCatalogEntries)
        .innerJoin(tempCatalogBatches, eq(tempCatalogBatches.id, tempCatalogEntries.batchId))
        .where(and(eq(tempCatalogEntries.placeId, places.id), eq(tempCatalogBatches.status, "PUBLISHED")))),
    )));
}

async function findPublishedPoiMedia(db: AppDb, match: SQL) {
  const [row] = await db.select(poiMediaEvidenceFields)
    .from(placePoiMedia)
    .where(and(
      match,
      eq(placePoiMedia.state, "PUBLISHED"),
      eligiblePoiMediaPlace(db, eq(places.id, placePoiMedia.placeId)),
    ))
    .orderBy(desc(placePoiMedia.reviewedAt), desc(placePoiMedia.id))
    .limit(1);
  const validated = poiMediaEvidenceSchema.safeParse(row);
  return validated.success ? validated.data : null;
}

export async function getPublicPoiPhoto(db: AppDb, placeId: string, enabled?: string): Promise<PublicPoiPhoto | null> {
  if (enabled !== "true") return null;
  try {
    const photo = await findPublishedPoiMedia(db, eq(placePoiMedia.placeId, placeId));
    return photo ? { url: `/poi-media/${photo.id}`, sourceUrl: photo.sourceUrl, attribution: photo.attribution } : null;
  } catch {
    console.error("PUBLIC_POI_PHOTO_LOOKUP_FAILED");
    return null;
  }
}

export function getPublishedPoiMedia(db: AppDb, id: string) {
  return findPublishedPoiMedia(db, eq(placePoiMedia.id, id));
}

export async function readVerifiedPoiMedia(bucket: R2Bucket, photo: Pick<PoiMediaEvidence, "id" | "sha256" | "byteSize">) {
  const object = await bucket.get(getPoiMediaObjectKey(photo.id, photo.sha256));
  if (!object) return null;
  if (object.size !== photo.byteSize || object.httpMetadata?.contentType !== POI_MEDIA_CONTENT_TYPE) {
    await object.body.cancel();
    return null;
  }
  const buffer = await object.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length !== photo.byteSize || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  return digest === photo.sha256 ? buffer : null;
}
