import { z } from "zod";

export const TEMP_PHOTO_TARGET_BATCH = "temp100-652f4d261db7795b";
const pageHosts = new Set(["map.naver.com", "place.naver.com", "m.place.naver.com", "pcmap.place.naver.com", "search.naver.com", "m.search.naver.com", "blog.naver.com", "m.blog.naver.com"]);
const imageHosts = new Set(["ldb-phinf.pstatic.net", "naverbooking-phinf.pstatic.net", "pup-review-phinf.pstatic.net", "postfiles.pstatic.net", "mblogthumb-phinf.pstatic.net", "search.pstatic.net", "blogfiles.naver.net", "blogfiles.pstatic.net"]);
function safeUrl(value: string, hosts: Set<string>) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !hosts.has(url.hostname) || url.username || url.password || url.port
      || [...url.searchParams.keys()].some((key) => /token|secret|password|credential|signature|api.?key/i.test(key))) return false;
    const imageSource = url.searchParams.get("src");
    if (imageSource) {
      const inner = new URL(imageSource);
      if (url.hostname !== "search.pstatic.net" || !["https:", "http:"].includes(inner.protocol) || !imageHosts.has(inner.hostname) || inner.username || inner.password || inner.port || inner.searchParams.has("src")
        || [...inner.searchParams.keys()].some((key) => /token|secret|password|credential|signature|api.?key/i.test(key))) return false;
    }
    return true;
  } catch { return false; }
}
const text = z.string().trim().min(1).max(240).refine((value) => !/[\u0000-\u001f<>]/u.test(value));
export const tempPhotoSupplementEntrySchema = z.object({
  sourceId: z.string().regex(/^temp100-(?:00[1-9]|0[1-9][0-9]|100)$/),
  name: text, address: text,
  sourcePageUrl: z.string().max(2000).refine((value) => safeUrl(value, pageHosts)),
  imageUrl: z.string().max(4000).refine((value) => safeUrl(value, imageHosts)),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  checkedAt: z.iso.datetime({ offset: true }),
  rightsStatus: z.literal("UNVERIFIED"),
  attribution: text,
}).strict();
export const tempPhotoSupplementManifestSchema = z.object({
  schemaVersion: z.literal(1),
  targetBatchId: z.literal(TEMP_PHOTO_TARGET_BATCH),
  entries: z.array(tempPhotoSupplementEntrySchema).length(77),
}).strict().refine((value) => new Set(value.entries.map((entry) => entry.sourceId)).size === 77, "TEMP_PHOTO_DUPLICATE_ENTRY");
export type TempPhotoSupplementEntry = z.infer<typeof tempPhotoSupplementEntrySchema>;
export type TempPhotoSupplementManifest = z.infer<typeof tempPhotoSupplementManifestSchema>;
export function supplementalPhotoKey(batchId: string, entry: TempPhotoSupplementEntry) {
  if (!/^temp100-[a-f0-9]{16}$/.test(batchId)) throw new Error("TEMP_PHOTO_BATCH_INVALID");
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const)[entry.contentType];
  return `temp100-naver/${batchId}/${entry.sourceId}-${entry.sha256}.${extension}`;
}
