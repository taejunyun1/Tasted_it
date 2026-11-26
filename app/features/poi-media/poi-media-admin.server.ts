import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../db/client.server";
import { placePoiMedia, places } from "../../db/schema";
import { getAdminAssurance, type AdminSession } from "../auth/admin-assurance.server";
import { parseReviewerPhotoFiles } from "../ratings/reviewer-photo";
import {
  getPoiMediaObjectKey, POI_MEDIA_CONTENT_TYPE,
  poiMediaByteSizeSchema, poiMediaIdSchema, poiMediaSha256Schema, poiMediaSourceUrlSchema,
} from "./poi-media";
import {
  eligiblePoiMediaPlace, poiMediaEvidenceFields, poiMediaEvidenceSchema, POI_MEDIA_ORIGINAL_ATTACHMENT_KEY,
  readVerifiedPoiMedia, readVerifiedPoiMediaAsset,
} from "./poi-media.server";

const photoIdentitySchema = z.object({
  id: poiMediaIdSchema,
  sha256: poiMediaSha256Schema,
  byteSize: poiMediaByteSizeSchema,
});

const placeIdentityFields = {
  expectedPlaceName: z.string().min(1).max(2048),
  expectedPlaceAddress: z.string().min(1).max(2048),
};

const transitionFields = {
  id: poiMediaIdSchema,
  expectedSha256: poiMediaSha256Schema,
  reason: z.string().trim().min(3).max(200),
};

export const poiMediaAdminTransitionSchema = z.discriminatedUnion("intent", [
  z.object({
    ...transitionFields,
    ...placeIdentityFields,
    intent: z.literal("PUBLISH"),
    expectedState: z.literal("STAGED"),
  }),
  z.object({
    ...transitionFields,
    intent: z.literal("WITHDRAW"),
    expectedState: z.enum(["STAGED", "PUBLISHED"]),
  }),
]);

const originalAttachmentSchema = z.object({
  id: poiMediaIdSchema,
  expectedSha256: poiMediaSha256Schema,
  ...placeIdentityFields,
  now: z.iso.datetime({ precision: 3 }),
});

type PoiMediaState = typeof placePoiMedia.$inferSelect.state;
type TransitionInput = z.infer<typeof poiMediaAdminTransitionSchema> & AdminSession & { now: string };
type AdminMediaFailure = "INVALID_INPUT" | "NOT_FOUND" | "STALE" | "INELIGIBLE" | "ASSET_UNVERIFIED" | "FORBIDDEN";
type TransitionResult =
  | { ok: true; state: PoiMediaState; changed: boolean }
  | { ok: false; code: AdminMediaFailure };
type PhotoPlaceIdentity = z.infer<z.ZodObject<typeof placeIdentityFields>>;
type OriginalAttachmentInput = z.infer<typeof originalAttachmentSchema> & AdminSession & { bytes: Uint8Array<ArrayBuffer> };
type OriginalAttachmentResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: AdminMediaFailure | "UPLOAD_UNCONFIRMED" };

export type AdminPoiMedia = {
  id: string;
  placeId: string;
  placeName: string;
  placeAddress: string;
  placeSlug: string;
  state: PoiMediaState;
  sourceUrl: string | null;
  attribution: string;
  rightsBasis: typeof placePoiMedia.$inferSelect.rightsBasis;
  rightsEvidence: string;
  sha256: string;
  byteSize: number;
  contentType: typeof placePoiMedia.$inferSelect.contentType;
  reviewedAt: string;
  eligibleForPublication: boolean;
};

export async function getAdminPoiMedia(db: AppDb, id: string): Promise<AdminPoiMedia | null> {
  if (!poiMediaIdSchema.safeParse(id).success) return null;
  const [row] = await db.select({
    ...poiMediaEvidenceFields,
    placeId: placePoiMedia.placeId,
    state: placePoiMedia.state,
    placeName: places.name,
    placeAddress: places.address,
    placeSlug: places.slug,
    eligibleForPublication: eligiblePoiMediaPlace(db, eq(places.id, placePoiMedia.placeId)),
  }).from(placePoiMedia)
    .innerJoin(places, eq(places.id, placePoiMedia.placeId))
    .where(eq(placePoiMedia.id, id))
    .limit(1);
  if (!row) return null;

  return {
    ...row,
    sourceUrl: poiMediaSourceUrlSchema.safeParse(row.sourceUrl).success ? row.sourceUrl : null,
    eligibleForPublication: Boolean(row.eligibleForPublication) && poiMediaEvidenceSchema.safeParse(row).success,
  };
}

export async function readAdminPoiMediaPreview(db: AppDb, bucket: R2Bucket, id: string): Promise<ArrayBuffer | null> {
  const row = await getAdminPoiMedia(db, id);
  if (!row || row.state === "WITHDRAWN") return null;
  const photo = photoIdentitySchema.safeParse(row);
  return photo.success ? readVerifiedPoiMedia(bucket, photo.data) : null;
}

const originalAttachmentAction = "POI_MEDIA_ORIGINAL_ATTACH";
type OriginalIdentity = z.infer<typeof photoIdentitySchema>;
type OriginalStatus = "READY" | "UNCONFIRMED";

function originalAttachmentAudit(photo: OriginalIdentity) {
  return {
    id: `poi-media-original-attach-${photo.id}-${photo.sha256}`,
    beforeState: JSON.stringify({ state: "STAGED", sha256: photo.sha256 }),
    afterState: JSON.stringify({ state: "STAGED", sha256: photo.sha256, originalAttached: true, byteSize: photo.byteSize }),
  };
}

function matchesOriginalAttachmentAudit(photo: OriginalIdentity) {
  const audit = originalAttachmentAudit(photo);
  return sql`a.id = ${audit.id} AND a.action = ${originalAttachmentAction} AND a.target_type = 'PLACE_POI_MEDIA'
    AND a.target_id = ${photo.id} AND a.before_state = ${audit.beforeState} AND a.after_state = ${audit.afterState}`;
}

async function verifiedOriginalCondition(
  bucket: R2Bucket | undefined,
  photo: AdminPoiMedia | null,
): Promise<SQL | true | null> {
  if (!bucket || !photo || photo.state === "WITHDRAWN") return null;
  const identity = photoIdentitySchema.safeParse(photo);
  if (!identity.success) return null;
  try {
    const asset = await readVerifiedPoiMediaAsset(bucket, identity.data);
    if (!asset) return null;
    // Legacy, verified originals staged outside this browser flow have no attachment marker.
    if (asset.attachmentId === undefined) return true;
    if (asset.attachmentId !== photo.id) return null;
    return sql`EXISTS (SELECT 1 FROM admin_audit_logs a WHERE ${matchesOriginalAttachmentAudit(identity.data)})`;
  } catch {
    return null;
  }
}

async function originalConditionIsReady(db: AppDb, condition: SQL | true | null) {
  if (condition === true) return true;
  if (condition === null) return false;
  return Boolean((await db.get<{ ready: number }>(sql`SELECT ${condition} AS ready`))?.ready);
}

export async function getAdminPoiMediaOriginalStatus(
  db: AppDb,
  bucket: R2Bucket | undefined,
  photo: AdminPoiMedia | null,
): Promise<OriginalStatus> {
  try {
    const condition = await verifiedOriginalCondition(bucket, photo);
    return await originalConditionIsReady(db, condition) ? "READY" : "UNCONFIRMED";
  } catch {
    return "UNCONFIRMED";
  }
}

type AdminAssurance = NonNullable<Awaited<ReturnType<typeof getAdminAssurance>>>;

function currentAssuranceCondition(operator: AdminSession, assurance: AdminAssurance): SQL {
  const currentTime = sql`strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
  return sql`EXISTS (
    SELECT 1 FROM admin_session_assurances a
    JOIN sessions s ON s.id = a.session_id AND s.user_id = a.actor_user_id
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${operator.sessionId} AND u.id = ${operator.actorUserId}
      AND u.role = 'ADMIN' AND u.email NOT LIKE 'withdrawn.%@invalid.local'
      AND s.expires_at > ${currentTime}
      AND a.method = ${assurance.method}
      AND a.verified_at = ${assurance.verifiedAt} AND a.verified_at <= ${currentTime}
      AND a.expires_at = ${assurance.expiresAt} AND a.expires_at > ${currentTime}
      AND NOT EXISTS (
        SELECT 1 FROM member_access_restrictions r
        WHERE r.user_id = u.id AND r.lifted_at IS NULL
          AND r.starts_at <= ${currentTime} AND r.expires_at > ${currentTime}
      )
  )`;
}

function eligiblePhotoPlace(db: AppDb, expected: PhotoPlaceIdentity): SQL {
  return eligiblePoiMediaPlace(db, sql`
    ${places.id} = ${placePoiMedia.placeId} AND ${places.name} = ${expected.expectedPlaceName}
      AND ${places.address} = ${expected.expectedPlaceAddress}
  `);
}

function checkPhotoPlace(photo: AdminPoiMedia, expected: PhotoPlaceIdentity) {
  if (photo.placeName !== expected.expectedPlaceName || photo.placeAddress !== expected.expectedPlaceAddress) {
    return "STALE" as const;
  }
  return photo.eligibleForPublication ? null : "INELIGIBLE" as const;
}

function checkTransitionState(
  photo: AdminPoiMedia | null,
  input: z.infer<typeof poiMediaAdminTransitionSchema>,
  nextState: PoiMediaState,
): TransitionResult | null {
  if (!photo) return { ok: false, code: "NOT_FOUND" };
  if (photo.sha256 !== input.expectedSha256) return { ok: false, code: "STALE" };
  if (input.intent === "PUBLISH") {
    const code = checkPhotoPlace(photo, input);
    if (code) return { ok: false, code };
  }
  if (photo.state === nextState) return { ok: true, state: nextState, changed: false };
  if (photo.state !== input.expectedState) return { ok: false, code: "STALE" };
  return null;
}

export async function applyPoiMediaAdminTransition(
  db: AppDb,
  bucket: R2Bucket | undefined,
  input: TransitionInput,
): Promise<TransitionResult> {
  const validated = poiMediaAdminTransitionSchema.safeParse(input);
  if (!validated.success || !z.iso.datetime({ precision: 3 }).safeParse(input.now).success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const transition = validated.data;
  const assurance = await getAdminAssurance(db.$client, { ...input, now: new Date(input.now) });
  if (!assurance) return { ok: false, code: "FORBIDDEN" };
  const operatorCondition = currentAssuranceCondition(input, assurance);
  const activeOperator = () => db.get<{ allowed: number }>(sql`SELECT ${operatorCondition} AS allowed`);

  const nextState = transition.intent === "PUBLISH" ? "PUBLISHED" : "WITHDRAWN";
  const photo = await getAdminPoiMedia(db, transition.id);
  const preflight = checkTransitionState(photo, transition, nextState);
  if (preflight) {
    if (preflight.ok && !(await activeOperator())?.allowed) return { ok: false, code: "FORBIDDEN" };
    return preflight;
  }

  let publishCondition: SQL | undefined;
  if (transition.intent === "PUBLISH") {
    const original = await verifiedOriginalCondition(bucket, photo);
    if (original === null || !await originalConditionIsReady(db, original)) {
      return { ok: false, code: "ASSET_UNVERIFIED" };
    }
    publishCondition = and(eligiblePhotoPlace(db, transition), original === true ? undefined : original);
  }

  const update = db.update(placePoiMedia).set({ state: nextState }).where(and(
    eq(placePoiMedia.id, transition.id),
    eq(placePoiMedia.sha256, transition.expectedSha256),
    eq(placePoiMedia.state, transition.expectedState),
    operatorCondition,
    publishCondition,
  )).toSQL();
  const beforeState = JSON.stringify({ state: transition.expectedState, sha256: transition.expectedSha256 });
  const afterState = JSON.stringify({ state: nextState, sha256: transition.expectedSha256, reason: transition.reason });
  // D1 runs a batch as a transaction. The audit row records only a successful compare-and-set.
  const [updated] = await db.$client.batch([
    db.$client.prepare(update.sql).bind(...update.params),
    db.$client.prepare(`INSERT INTO admin_audit_logs
      (id, actor_user_id, action, target_type, target_id, before_state, after_state, created_at)
      SELECT ?, ?, ?, 'PLACE_POI_MEDIA', ?, ?, ?, ? WHERE changes() = 1`).bind(
      crypto.randomUUID(), input.actorUserId, `POI_MEDIA_${transition.intent}`,
      transition.id, beforeState, afterState, input.now,
    ),
  ]);
  if (updated?.meta.changes === 1) return { ok: true, state: nextState, changed: true };

  if (!(await activeOperator())?.allowed) return { ok: false, code: "FORBIDDEN" };
  return checkTransitionState(await getAdminPoiMedia(db, transition.id), transition, nextState)
    ?? { ok: false, code: "STALE" };
}

function originalAttachmentFailure(photo: AdminPoiMedia, input: z.infer<typeof originalAttachmentSchema>) {
  if (photo.state !== "STAGED" || photo.sha256 !== input.expectedSha256) return "STALE" as const;
  return checkPhotoPlace(photo, input);
}

export async function applyPoiMediaOriginalAttachment(
  db: AppDb,
  bucket: R2Bucket | undefined,
  input: OriginalAttachmentInput,
): Promise<OriginalAttachmentResult> {
  const validated = originalAttachmentSchema.safeParse(input);
  const bytes = input.bytes;
  if (!validated.success || !(bytes instanceof Uint8Array) || !poiMediaByteSizeSchema.safeParse(bytes.byteLength).success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const attachment = validated.data;
  const assurance = await getAdminAssurance(db.$client, { ...input, now: new Date(attachment.now) });
  if (!assurance) return { ok: false, code: "FORBIDDEN" };

  const photo = await getAdminPoiMedia(db, attachment.id);
  if (!photo) return { ok: false, code: "NOT_FOUND" };
  const preflight = originalAttachmentFailure(photo, attachment);
  if (preflight) return { ok: false, code: preflight };
  const identity = photoIdentitySchema.safeParse(photo);
  if (!identity.success || bytes.byteLength !== photo.byteSize) return { ok: false, code: "ASSET_UNVERIFIED" };
  const form = new FormData();
  form.set("photos", new File([bytes], "original.jpg", { type: POI_MEDIA_CONTENT_TYPE }));
  try {
    await parseReviewerPhotoFiles(form);
  } catch {
    return { ok: false, code: "ASSET_UNVERIFIED" };
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  if (Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") !== photo.sha256) {
    return { ok: false, code: "ASSET_UNVERIFIED" };
  }
  if (!bucket) return { ok: false, code: "UPLOAD_UNCONFIRMED" };

  const operator = currentAssuranceCondition(input, assurance);
  const matches = and(
    eq(placePoiMedia.id, photo.id), eq(placePoiMedia.sha256, photo.sha256), eq(placePoiMedia.byteSize, photo.byteSize),
    eq(placePoiMedia.state, "STAGED"), operator, eligiblePhotoPlace(db, attachment),
  );
  const permittedRow = db.select({ id: placePoiMedia.id }).from(placePoiMedia).where(matches);
  const explainWriteDenial = async (): Promise<OriginalAttachmentResult> => {
    const status = await db.get<{ allowed: number }>(sql`SELECT ${operator} AS allowed`);
    if (!status?.allowed) return { ok: false, code: "FORBIDDEN" };
    const current = await getAdminPoiMedia(db, photo.id);
    if (!current) return { ok: false, code: "NOT_FOUND" };
    return { ok: false, code: originalAttachmentFailure(current, attachment) ?? "UPLOAD_UNCONFIRMED" };
  };
  if (!(await permittedRow.get())) return explainWriteDenial();

  const objectKey = getPoiMediaObjectKey(photo.id, photo.sha256);
  try {
    await bucket.put(objectKey, bytes, {
      onlyIf: new Headers({ "If-None-Match": "*" }),
      httpMetadata: { contentType: POI_MEDIA_CONTENT_TYPE },
      customMetadata: { [POI_MEDIA_ORIGINAL_ATTACHMENT_KEY]: photo.id },
      sha256: digest,
    });
  } catch {
    // A failed response can follow a committed write. Read the exact key before deciding.
  }
  try {
    const asset = await readVerifiedPoiMediaAsset(bucket, identity.data);
    if (!asset) {
      return { ok: false, code: await bucket.head(objectKey) ? "ASSET_UNVERIFIED" : "UPLOAD_UNCONFIRMED" };
    }
    if (asset.attachmentId !== undefined && asset.attachmentId !== photo.id) {
      return { ok: false, code: "ASSET_UNVERIFIED" };
    }
  } catch {
    return { ok: false, code: "UPLOAD_UNCONFIRMED" };
  }

  const audit = originalAttachmentAudit(identity.data);
  try {
    const inserted = await db.get<{ id: string }>(sql`
      INSERT INTO admin_audit_logs
        (id, actor_user_id, action, target_type, target_id, before_state, after_state, created_at)
      SELECT ${audit.id}, ${input.actorUserId}, ${originalAttachmentAction}, 'PLACE_POI_MEDIA', ${photo.id},
        ${audit.beforeState}, ${audit.afterState}, ${attachment.now}
      FROM place_poi_media WHERE ${matches}
      ON CONFLICT (id) DO NOTHING RETURNING id
    `);
    if (inserted) return { ok: true, changed: true };
  } catch {
    // A retry can reconcile an already-verified private object without overwriting it.
  }
  try {
    const confirmed = await db.get<{ id: string }>(sql`
      SELECT a.id FROM place_poi_media JOIN admin_audit_logs a ON ${matchesOriginalAttachmentAudit(identity.data)}
      WHERE ${matches}
    `);
    if (confirmed) return { ok: true, changed: false };
    return await explainWriteDenial();
  } catch {
    return { ok: false, code: "UPLOAD_UNCONFIRMED" };
  }
}
