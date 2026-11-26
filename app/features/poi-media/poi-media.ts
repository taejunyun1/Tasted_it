import { z } from "zod";

export const POI_MEDIA_CONTENT_TYPE = "image/jpeg";
export const POI_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const poiMediaIdSchema = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export const poiMediaSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const poiMediaSourceUrlSchema = z.string().max(2048).refine((value) => {
  if (!value.startsWith("https://") || /[\u0000-\u0020\u007f\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
});
export const poiMediaAttributionSchema = z.string().trim().min(1).max(160);
export const poiMediaRightsBasisSchema = z.enum(["OWN_WORK", "MERCHANT_PERMISSION", "KOGL_1", "OPEN_LICENSE"]);
export const poiMediaRightsEvidenceSchema = z.string().trim().min(1).max(1000);
export const poiMediaByteSizeSchema = z.number().int().min(4).max(POI_MEDIA_MAX_BYTES);

export function getPoiMediaObjectKey(id: string, sha256: string) {
  return `poi-media/${poiMediaIdSchema.parse(id)}-${poiMediaSha256Schema.parse(sha256)}.jpg`;
}

export type PublicPoiPhoto = {
  url: string;
  sourceUrl: string;
  attribution: string;
};
