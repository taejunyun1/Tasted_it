import { and, desc, eq, isNull, notExists, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../db/client.server";
import { categories, placeCategories, placePoiMedia, places, tempCatalogBatches, tempCatalogEntries } from "../../db/schema";
import { publicConditions } from "../places/place.server";
import {
  getPoiMediaObjectKey, POI_MEDIA_CONTENT_TYPE, poiMediaAttributionSchema, poiMediaByteSizeSchema,
  poiMediaIdSchema, poiMediaRightsBasisSchema, poiMediaRightsEvidenceSchema, poiMediaSha256Schema,
  poiMediaSourceUrlSchema, type PublicPoiPhoto,
} from "./poi-media";

const publishedPoiMediaSchema = z.object({
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

type PublishedPoiMedia = z.infer<typeof publishedPoiMediaSchema>;

async function findPublishedPoiMedia(db: AppDb, match: SQL) {
  const [row] = await db.select({
    id: placePoiMedia.id,
    sourceUrl: placePoiMedia.sourceUrl,
    attribution: placePoiMedia.attribution,
    rightsBasis: placePoiMedia.rightsBasis,
    rightsEvidence: placePoiMedia.rightsEvidence,
    sha256: placePoiMedia.sha256,
    byteSize: placePoiMedia.byteSize,
    contentType: placePoiMedia.contentType,
    reviewedAt: placePoiMedia.reviewedAt,
  })
    .from(placePoiMedia)
    .innerJoin(places, eq(places.id, placePoiMedia.placeId))
    .innerJoin(placeCategories, eq(placeCategories.placeId, places.id))
    .innerJoin(categories, eq(categories.id, placeCategories.categoryId))
    .where(and(
      match,
      eq(placePoiMedia.state, "PUBLISHED"),
      publicConditions({}),
      isNull(places.closedAt),
      notExists(db.select({ id: tempCatalogEntries.id })
        .from(tempCatalogEntries)
        .innerJoin(tempCatalogBatches, eq(tempCatalogBatches.id, tempCatalogEntries.batchId))
        .where(and(eq(tempCatalogEntries.placeId, places.id), eq(tempCatalogBatches.status, "PUBLISHED")))),
    ))
    .orderBy(desc(placePoiMedia.reviewedAt), desc(placePoiMedia.id))
    .limit(1);
  const validated = publishedPoiMediaSchema.safeParse(row);
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

export async function readVerifiedPoiMedia(bucket: R2Bucket, photo: PublishedPoiMedia) {
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
