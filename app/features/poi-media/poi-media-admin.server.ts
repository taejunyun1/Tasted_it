import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { AppDb } from "../../db/client.server";
import { placePoiMedia, places } from "../../db/schema";
import { getAdminAssurance, type AdminSession } from "../auth/admin-assurance.server";
import {
  poiMediaByteSizeSchema, poiMediaIdSchema, poiMediaSha256Schema, poiMediaSourceUrlSchema,
} from "./poi-media";
import {
  eligiblePoiMediaPlace, poiMediaEvidenceFields, poiMediaEvidenceSchema, readVerifiedPoiMedia,
} from "./poi-media.server";

const photoIdentitySchema = z.object({
  id: poiMediaIdSchema,
  sha256: poiMediaSha256Schema,
  byteSize: poiMediaByteSizeSchema,
});

const transitionFields = {
  id: poiMediaIdSchema,
  expectedSha256: poiMediaSha256Schema,
  reason: z.string().trim().min(3).max(200),
};

export const poiMediaAdminTransitionSchema = z.discriminatedUnion("intent", [
  z.object({
    ...transitionFields,
    intent: z.literal("PUBLISH"),
    expectedState: z.literal("STAGED"),
    expectedPlaceName: z.string().min(1).max(2048),
    expectedPlaceAddress: z.string().min(1).max(2048),
  }),
  z.object({
    ...transitionFields,
    intent: z.literal("WITHDRAW"),
    expectedState: z.enum(["STAGED", "PUBLISHED"]),
  }),
]);

type PoiMediaState = typeof placePoiMedia.$inferSelect.state;
type TransitionInput = z.infer<typeof poiMediaAdminTransitionSchema> & AdminSession & { now: string };
type TransitionResult =
  | { ok: true; state: PoiMediaState; changed: boolean }
  | { ok: false; code: "INVALID_INPUT" | "NOT_FOUND" | "STALE" | "INELIGIBLE" | "ASSET_UNVERIFIED" | "FORBIDDEN" };

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

function checkTransitionState(
  photo: AdminPoiMedia | null,
  input: z.infer<typeof poiMediaAdminTransitionSchema>,
  nextState: PoiMediaState,
): TransitionResult | null {
  if (!photo) return { ok: false, code: "NOT_FOUND" };
  if (photo.sha256 !== input.expectedSha256) return { ok: false, code: "STALE" };
  if (input.intent === "PUBLISH") {
    if (photo.placeName !== input.expectedPlaceName || photo.placeAddress !== input.expectedPlaceAddress) {
      return { ok: false, code: "STALE" };
    }
    if (!photo.eligibleForPublication) return { ok: false, code: "INELIGIBLE" };
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
    const identity = photoIdentitySchema.safeParse(photo);
    if (!bucket || !identity.success || !await readVerifiedPoiMedia(bucket, identity.data)) {
      return { ok: false, code: "ASSET_UNVERIFIED" };
    }
    publishCondition = eligiblePoiMediaPlace(db, sql`
      ${places.id} = ${placePoiMedia.placeId} AND ${places.name} = ${transition.expectedPlaceName}
        AND ${places.address} = ${transition.expectedPlaceAddress}
    `);
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
