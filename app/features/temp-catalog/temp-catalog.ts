import { z } from "zod";

export const TEMP_SOURCE_HASH = "d949f94c4a760aa42c2894ff220c0203d272da49a793cbe402dc79e38cedc900";
const sourceHosts = new Set(["tour.gwangju.go.kr", "www.yeosu.go.kr", "m.xn--o39a81gi2cv0je9ktug.kr"]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const shortText = z.string().trim().min(1).max(240).refine((v) => !/[\u0000-\u001f<>]/u.test(v));
function safeUrl(value: string, hosts: Set<string>) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.has(url.hostname) && !url.username && !url.password
      && ![...url.searchParams.keys()].some((key) => /token|secret|password|credential|signature|api.?key/i.test(key));
  } catch { return false; }
}
const sourceUrl = z.string().max(2000).refine((v) => safeUrl(v, sourceHosts));
export const coordinateEvidenceSchema = z.object({
  sourceId: z.string().regex(/^temp100-\d{3}$/), name: shortText, address: shortText,
  latitude: z.number().finite().min(33).max(36), longitude: z.number().finite().min(125).max(128),
  sourceUrl, sourceSha256: hash, checkedAt: z.iso.datetime({ offset: true }),
}).strict();
const photoSchema = z.object({
  sha256: hash,
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  licenseType: z.literal("KOGL-1"),
  licenseUrl: z.string().max(2000).refine((v) => safeUrl(v, new Set(["www.kogl.or.kr", "kogl.or.kr", "www.yeosu.go.kr"]))),
  attribution: shortText,
  creator: shortText,
  evidenceUrl: z.string().max(2000).refine((v) => safeUrl(v, new Set(["www.yeosu.go.kr"]))),
}).strict();
export const tempEntrySchema = z.object({
  sourceId: z.string().regex(/^temp100-(?:00[1-9]|0[1-9][0-9]|100)$/),
  name: shortText, address: shortText, region: shortText,
  cuisine: shortText, summary: z.string().trim().min(10).max(600),
  sourceUrl, sourceTitle: shortText,
  checkedAt: z.iso.datetime({ offset: true }),
  evaluation: z.object({ kind: z.literal("OFFICIAL_CURATION"), provider: shortText, sourceUrl }).strict(),
  photo: photoSchema.nullable(),
}).strict();
export const tempManifestSchema = z.object({
  schemaVersion: z.literal(1), sourceHash: z.literal(TEMP_SOURCE_HASH),
  entries: z.array(tempEntrySchema).length(100),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.entries.map((e) => e.sourceId)).size !== 100
    || new Set(value.entries.map((e) => identityKey(e))).size !== 100
    || value.entries.filter((e) => e.photo).length !== 23) ctx.addIssue({ code: "custom", message: "TEMP100_COUNT_MISMATCH" });
});
export type TempEntry = z.infer<typeof tempEntrySchema>;
export type TempManifest = z.infer<typeof tempManifestSchema>;
export type TempPublicInfo = TempEntry & { entryId: string; photoUrl: string | null };
export function normalizeIdentity(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[\s.,·-]/gu, "");
}
export function normalizeAddress(value: string) { return normalizeIdentity(value.replace(/^(전남광주통합특별시|광주광역시|전라남도|광주|전남)\s*/, "")); }
export function identityKey(value: { name: string; address: string }) { return `${normalizeIdentity(value.name)}|${normalizeAddress(value.address)}`; }
export function categorySlug(entry: TempEntry) {
  if (/해산물|장어/.test(entry.cuisine)) return "seafood-dish";
  if (/고기/.test(entry.cuisine)) return "grill";
  return ({ 중식: "chinese-general", 일식: "japanese-general", 양식: "western-general" } as Record<string, string>)[entry.cuisine] ?? "korean-general";
}
export function photoObjectKey(batchId: string, entry: TempEntry) {
  if (!/^temp100-[a-f0-9]{16}$/.test(batchId) || !entry.photo) return null;
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const)[entry.photo.contentType];
  return `temp100/${batchId}/${entry.sourceId}-${entry.photo.sha256}.${extension}`;
}
export function verifiedCoordinates(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= 33 && latitude <= 36 && longitude >= 125 && longitude <= 128;
}
