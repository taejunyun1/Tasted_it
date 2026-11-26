import { and, asc, desc, eq, exists, inArray, ne, notExists, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, places, reviewerProfiles, reviewerVisitReviews, users } from "../../db/schema";
import { studentReviewPilotPhotos as photos } from "../../db/student-review-pilot-photo";
import { eligibleReviewCondition, eligibleReviewPlaceCondition } from "./reviewer-publication.server";
import { MAX_REVIEWER_PHOTO_BYTES, type ValidatedReviewerPhoto } from "./reviewer-photo";

type PilotBucket = Pick<R2Bucket, "put" | "head" | "delete">;
type Decision = "APPROVE" | "RETIRE";
type ReviewInput = { userId: string; reviewId: string; now: string; seats?: string };

const uploadWindowMs = 15 * 60_000;
const retryDelayMs = 6 * 60 * 60_000;
const cleanupLimit = 16;
const objectMarker = "studentReviewPilotPhotoId";
const databaseNow = sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export function matchesPilotPhotoObject(object: R2Object | null, expected: { photoId: string; byteSize: number }): object is R2Object {
  return object?.size === expected.byteSize && object.httpMetadata?.contentType === "image/jpeg"
    && object.customMetadata?.[objectMarker] === expected.photoId;
}

export class PilotPhotoError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function seatCodes(seats?: string) {
  if (seats === "A" || seats === "B") return [seats];
  return seats === "A,B" || seats === "B,A" ? ["A", "B"] : [];
}

function effectiveTime(now: string) {
  return sql<string>`max(${now}, ${databaseNow})`;
}

function hasMemberAccess(actor: SQLWrapper | string, now: SQLWrapper) {
  return sql`not exists (
    select 1 from member_access_restrictions r
    where r.user_id = ${actor} and r.lifted_at is null and r.starts_at <= ${now} and r.expires_at > ${now}
  )`;
}

function currentSession(userId: string, sessionId: string, now: SQLWrapper) {
  return sql`exists (
    select 1 from sessions s where s.id = ${sessionId} and s.user_id = ${userId} and s.expires_at > ${now}
  )`;
}

function activeReviewer(userId: SQLWrapper | string, now: SQLWrapper) {
  return sql`exists (
    select 1 from users u join reviewer_profiles p on p.user_id = u.id
    where u.id = ${userId} and u.role = 'REVIEWER' and p.status = 'ACTIVE'
      and u.email_verified_at is not null and lower(u.email) not like 'withdrawn.%@invalid.local'
      and ${hasMemberAccess(userId, now)}
  )`;
}

function adminActor(userId: string, now: SQLWrapper) {
  return sql`exists (
    select 1 from users u where u.id = ${userId} and u.role = 'ADMIN'
      and lower(u.email) not like 'withdrawn.%@invalid.local' and ${hasMemberAccess(userId, now)}
  )`;
}

function admission(userId: string, seats: string | undefined, now: SQLWrapper) {
  const codes = seatCodes(seats);
  if (codes.length === 0) return sql`0`;
  return and(
    activeReviewer(userId, now),
    sql`exists (
      select 1 from student_seats s where s.user_id = ${userId} and s.is_active = 1
        and s.code in (${sql.join(codes.map((code) => sql`${code}`), sql`, `)}) and s.expires_at > ${now}
    )`,
  );
}

export async function canAdmitPilotPhotoAuthor(db: AppDb, input: Omit<ReviewInput, "reviewId">) {
  if (seatCodes(input.seats).length === 0) return false;
  const result = await db.get<{ allowed: number }>(sql`select ${admission(input.userId, input.seats, effectiveTime(input.now))} as allowed`);
  return result?.allowed === 1;
}

function reviewCanHavePhoto() {
  return and(
    eligibleReviewPlaceCondition(places.id),
    sql`not exists (
      select 1 from temp_catalog_entries e
      join temp_catalog_batches b on b.id = e.batch_id
      where e.place_id = ${places.id} and b.status = 'PUBLISHED'
    )`,
    eq(reviewerVisitReviews.isCurrent, true),
    inArray(reviewerVisitReviews.status, ["PENDING", "APPROVED"]),
    sql`${reviewerVisitReviews.visitedOn} is not null and length(trim(${reviewerVisitReviews.visitNote})) > 0
      and ${reviewerVisitReviews.disclosure} = 'NONE'`,
  );
}

function matchesCurrentReview() {
  return and(
    eq(reviewerVisitReviews.id, photos.reviewId),
    eq(reviewerVisitReviews.reviewerUserId, photos.authorUserId),
    eq(reviewerVisitReviews.contentVersion, photos.contentVersion),
    eq(places.id, photos.placeId),
    eq(places.name, photos.placeName),
    eq(places.address, photos.placeAddress),
    reviewCanHavePhoto(),
  );
}

function canPublish() {
  return and(matchesCurrentReview(), activeReviewer(photos.authorUserId, databaseNow),
    eligibleReviewCondition(reviewerVisitReviews.id, photos.contentVersion));
}

function activeVersionPhoto() {
  return sql`exists (
    select 1 from student_review_pilot_photos p where p.review_id = ${reviewerVisitReviews.id}
      and p.author_user_id = ${reviewerVisitReviews.reviewerUserId}
      and p.content_version = ${reviewerVisitReviews.contentVersion} and p.status <> 'RETIRED'
  )`;
}

export async function listPilotPhotoHistoryLinks(db: AppDb, input: {
  userId: string; reviewIds: string[]; seats?: string; now: string;
}) {
  const reviewIds = input.reviewIds.slice(0, 50);
  if (reviewIds.length === 0) return [];
  const rows = await db.select({ id: reviewerVisitReviews.id }).from(reviewerVisitReviews)
    .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
    .where(and(eq(reviewerVisitReviews.reviewerUserId, input.userId), inArray(reviewerVisitReviews.id, reviewIds),
      or(activeVersionPhoto(), and(reviewCanHavePhoto(), admission(input.userId, input.seats, effectiveTime(input.now))))));
  return rows.map(({ id }) => id);
}

export async function getOwnedPilotPhotoReview(db: AppDb, input: ReviewInput) {
  const [review] = await db.select({
    id: reviewerVisitReviews.id, placeName: places.name, contentVersion: reviewerVisitReviews.contentVersion,
    status: reviewerVisitReviews.status,
    canAdmit: sql<number>`case when ${reviewCanHavePhoto()} and ${admission(input.userId, input.seats, effectiveTime(input.now))} then 1 else 0 end`,
  }).from(reviewerVisitReviews).innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
    .where(and(eq(reviewerVisitReviews.id, input.reviewId), eq(reviewerVisitReviews.reviewerUserId, input.userId))).limit(1);
  if (!review) return null;
  const entries = await db.select({ id: photos.id, status: photos.status, caption: photos.caption, takenOn: photos.takenOn })
    .from(photos).where(and(eq(photos.reviewId, input.reviewId), eq(photos.authorUserId, input.userId),
      eq(photos.contentVersion, review.contentVersion), ne(photos.status, "RETIRED")));
  const { canAdmit, ...result } = review;
  return { ...result, mayUpload: canAdmit === 1 && entries.length === 0, photos: entries };
}

function validatePhoto(input: {
  photo: ValidatedReviewerPhoto; caption: string; takenOn: string; now: string; expectedContentVersion: number;
}) {
  const caption = input.caption.trim();
  const date = Date.parse(`${input.takenOn}T00:00:00.000Z`);
  const now = Date.parse(input.now);
  const bytes = input.photo.bytes;
  if (!caption || caption.length > 240 || !Number.isFinite(date)
    || new Date(date).toISOString().slice(0, 10) !== input.takenOn
    || !Number.isFinite(now)
    || input.takenOn > new Date(now + 9 * 60 * 60_000).toISOString().slice(0, 10)
    || input.photo.contentType !== "image/jpeg"
    || bytes.byteLength !== input.photo.byteSize || bytes.byteLength < 4 || bytes.byteLength > MAX_REVIEWER_PHOTO_BYTES
    || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9
    || !Number.isSafeInteger(input.expectedContentVersion) || input.expectedContentVersion < 1) {
    throw new PilotPhotoError(400, "PILOT_PHOTO_INPUT");
  }
  return caption;
}

function retireFields(now: string | SQL<string>) {
  return { status: "RETIRED" as const, caption: "", takenOn: "", cleanupAfter: now };
}

async function retireUpload(db: AppDb, id: string, sealed: boolean) {
  await db.update(photos).set({ ...retireFields(databaseNow), ...(sealed ? { sealed: true } : {}) })
    .where(and(eq(photos.id, id), inArray(photos.status, ["UPLOADING", "RETIRED"]))).run();
}

export async function submitPilotPhoto(db: AppDb, bucket: Pick<PilotBucket, "put">, input: ReviewInput & {
  sessionId: string; expectedContentVersion: number; photo: ValidatedReviewerPhoto; caption: string; takenOn: string;
}) {
  const caption = validatePhoto(input);
  const now = effectiveTime(input.now);
  if (!seatCodes(input.seats).length || !input.sessionId) throw new PilotPhotoError(403, "PILOT_PHOTO_ADMISSION");
  const id = crypto.randomUUID();
  const objectKey = `student-review-pilot/${id}.jpg`;
  const expiresAt = new Date(Date.parse(input.now) + uploadWindowMs).toISOString();
  const [reservation] = await db.all<{ id: string }>(sql`
    insert into student_review_pilot_photos
      (id, review_id, author_user_id, place_id, place_name, place_address, content_version, object_key,
       byte_size, caption, taken_on, status, created_at, upload_expires_at, cleanup_after)
    select ${id}, ${reviewerVisitReviews.id}, ${input.userId}, ${places.id}, ${places.name}, ${places.address},
      ${reviewerVisitReviews.contentVersion}, ${objectKey}, ${input.photo.byteSize}, ${caption}, ${input.takenOn},
      'UPLOADING', ${now}, ${expiresAt}, ${expiresAt}
    from reviewer_visit_reviews join places on places.id = reviewer_visit_reviews.place_id
    where ${reviewerVisitReviews.id} = ${input.reviewId} and ${reviewerVisitReviews.reviewerUserId} = ${input.userId}
      and ${reviewerVisitReviews.contentVersion} = ${input.expectedContentVersion}
      and ${input.takenOn} >= ${reviewerVisitReviews.visitedOn}
      and ${reviewCanHavePhoto()} and ${admission(input.userId, input.seats, now)}
      and ${currentSession(input.userId, input.sessionId, now)}
    on conflict do nothing returning id
  `);
  if (!reservation) throw new PilotPhotoError(409, "PILOT_PHOTO_ADMISSION");

  let sealed = false;
  try {
    const object = await bucket.put(objectKey, input.photo.bytes, {
      onlyIf: new Headers({ "If-None-Match": "*" }),
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: { [objectMarker]: id },
    });
    if (!object) throw new PilotPhotoError(503, "PILOT_PHOTO_UPLOAD");
    sealed = true;
    const ready = db.select({ id: photos.id }).from(photos)
      .innerJoin(reviewerVisitReviews, eq(reviewerVisitReviews.id, photos.reviewId))
      .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
      .where(and(eq(photos.id, id), matchesCurrentReview(), admission(input.userId, input.seats, now),
        currentSession(input.userId, input.sessionId, now)));
    const [finished] = await db.update(photos).set({ status: "PENDING", sealed })
      .where(and(eq(photos.id, id), eq(photos.status, "UPLOADING"), sql`${photos.uploadExpiresAt} > ${now}`,
        exists(ready))).returning({ id: photos.id });
    if (!finished) throw new PilotPhotoError(409, "PILOT_PHOTO_ADMISSION");
    return finished;
  } catch (error) {
    // Preserve a possibly committed PENDING row. Uncertain puts retain an exact private key for cleanup.
    await retireUpload(db, id, sealed);
    if (error instanceof PilotPhotoError) throw error;
    throw new PilotPhotoError(503, "PILOT_PHOTO_UPLOAD");
  }
}

export function listPilotPhotosForAdmin(db: AppDb) {
  return db.select({
    id: photos.id, reviewId: photos.reviewId, status: photos.status, caption: photos.caption, takenOn: photos.takenOn,
    placeName: places.name, reviewerDisplayName: users.displayName,
    mayApprove: sql<boolean>`case when ${photos.status} = 'PENDING' and ${canPublish()} then 1 else 0 end`.mapWith(Boolean),
  }).from(photos)
    .innerJoin(reviewerVisitReviews, eq(reviewerVisitReviews.id, photos.reviewId))
    .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
    .innerJoin(users, eq(users.id, photos.authorUserId))
    .where(and(inArray(photos.status, ["PENDING", "APPROVED"]), matchesCurrentReview()))
    .orderBy(asc(sql`case when ${photos.status} = 'PENDING' then 0 else 1 end`), desc(photos.createdAt), asc(photos.id)).limit(50);
}

export async function decidePilotPhoto(db: AppDb, input: {
  photoId: string; adminUserId: string; sessionId: string; decision: Decision; reason: string; now: string;
}) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 500 || !["APPROVE", "RETIRE"].includes(input.decision)) {
    throw new PilotPhotoError(400, "PILOT_PHOTO_INPUT");
  }
  if (!input.sessionId) throw new PilotPhotoError(403, "PILOT_PHOTO_ADMISSION");
  const now = effectiveTime(input.now);
  const approving = input.decision === "APPROVE";
  const eligible = db.select({ id: photos.id }).from(photos)
    .innerJoin(reviewerVisitReviews, eq(reviewerVisitReviews.id, photos.reviewId))
    .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
    .where(and(eq(photos.id, input.photoId), canPublish()));
  const decisionId = crypto.randomUUID();
  const outcome = approving ? "APPROVED" : "RETIRED";
  const [decided] = await db.batch([
    db.update(photos).set({ ...(approving ? { status: "APPROVED" as const } : retireFields(now)), decisionId })
      .where(and(eq(photos.id, input.photoId), adminActor(input.adminUserId, now), currentSession(input.adminUserId, input.sessionId, now),
        sql`exists (
          select 1 from admin_session_assurances a where a.session_id = ${input.sessionId} and a.actor_user_id = ${input.adminUserId}
            and a.verified_at <= ${now} and a.expires_at > ${now}
        )`,
        approving ? and(eq(photos.status, "PENDING"), exists(eligible)) : inArray(photos.status, ["UPLOADING", "PENDING", "APPROVED"])))
      .returning({ id: photos.id }),
    db.insert(adminAuditLogs).select(sql`
      select ${decisionId}, ${input.adminUserId}, ${approving ? "STUDENT_REVIEW_PILOT_PHOTO_APPROVED" : "STUDENT_REVIEW_PILOT_PHOTO_RETIRED"},
        'STUDENT_REVIEW_PILOT_PHOTO', ${input.photoId}, null, ${JSON.stringify({ status: outcome, reason })}, ${now}
      where exists (select 1 from student_review_pilot_photos where id = ${input.photoId} and decision_id = ${decisionId})
    `),
  ]);
  if (!decided.length) throw new PilotPhotoError(409, "PILOT_PHOTO_DECISION");
}

export async function withdrawPilotPhoto(db: AppDb, input: { photoId: string; userId: string; sessionId: string; now: string }) {
  const now = effectiveTime(input.now);
  const [row] = await db.update(photos).set(retireFields(effectiveTime(input.now)))
    .where(and(eq(photos.id, input.photoId), eq(photos.authorUserId, input.userId), ne(photos.status, "RETIRED"),
      currentSession(input.userId, input.sessionId, now), hasMemberAccess(input.userId, now)))
    .returning({ id: photos.id });
  if (!row) throw new PilotPhotoError(404, "PILOT_PHOTO_NOT_FOUND");
}

type PilotPhotoReadInput =
  | { photoId: string; previewForUserId?: never; previewSessionId?: never }
  | { photoId: string; previewForUserId: string; previewSessionId: string };

export async function lookupPilotPhoto(db: AppDb, input: PilotPhotoReadInput) {
  const { photoId, previewForUserId: preview, previewSessionId } = input;
  const [row] = await db.select({ objectKey: photos.objectKey, byteSize: photos.byteSize }).from(photos)
    .innerJoin(reviewerVisitReviews, eq(reviewerVisitReviews.id, photos.reviewId))
    .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
    .where(and(eq(photos.id, photoId), eq(photos.sealed, true), preview === undefined
      ? and(eq(photos.status, "APPROVED"), canPublish())
      : and(inArray(photos.status, ["PENDING", "APPROVED"]), matchesCurrentReview(),
        currentSession(preview, previewSessionId, databaseNow),
        or(adminActor(preview, databaseNow), and(eq(photos.authorUserId, preview), activeReviewer(preview, databaseNow))))))
    .limit(1);
  return row ?? null;
}

export async function listPublicPilotPhotos(db: AppDb, placeId: string) {
  const rows = await db.select({
    id: photos.id, reviewId: photos.reviewId, position: sql<number>`0`,
    publishedAt: reviewerVisitReviews.publishedAt, reviewerSlug: reviewerProfiles.slug, reviewerDisplayName: users.displayName,
  }).from(photos)
    .innerJoin(reviewerVisitReviews, eq(reviewerVisitReviews.id, photos.reviewId))
    .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId))
    .innerJoin(reviewerProfiles, eq(reviewerProfiles.userId, photos.authorUserId))
    .innerJoin(users, eq(users.id, photos.authorUserId))
    .where(and(eq(photos.placeId, placeId), eq(photos.status, "APPROVED"), eq(photos.sealed, true), canPublish()))
    .orderBy(desc(reviewerVisitReviews.publishedAt), desc(photos.id)).limit(12);
  return rows.map((photo) => ({ ...photo, url: `/student-review-photos/${photo.id}` }));
}

export async function cleanupPilotPhotos(db: AppDb, bucket: Pick<PilotBucket, "head" | "delete">, now: string) {
  const currentReview = db.select({ id: reviewerVisitReviews.id }).from(reviewerVisitReviews)
    .innerJoin(places, eq(places.id, reviewerVisitReviews.placeId)).where(matchesCurrentReview());
  const stale = db.select({ id: photos.id }).from(photos).where(and(ne(photos.status, "RETIRED"),
    or(
      and(eq(photos.status, "UPLOADING"), sql`${photos.uploadExpiresAt} <= ${now}`),
      notExists(currentReview),
    ))).orderBy(asc(photos.createdAt), asc(photos.id)).limit(cleanupLimit);
  await db.update(photos).set(retireFields(now)).where(inArray(photos.id, stale)).run();
  const jobs = await db.select({ id: photos.id, objectKey: photos.objectKey, sealed: photos.sealed }).from(photos)
    .where(and(eq(photos.status, "RETIRED"), sql`${photos.cleanupAfter} <= ${now}`))
    .orderBy(asc(photos.cleanupAfter), asc(photos.id)).limit(cleanupLimit);
  const retryAt = new Date(Date.parse(now) + retryDelayMs).toISOString();
  const result = { deleted: 0, pending: 0, failed: 0 };
  for (const job of jobs) {
    const retired = and(eq(photos.id, job.id), eq(photos.status, "RETIRED"));
    try {
      if (!job.sealed) {
        const object = await bucket.head(job.objectKey);
        if (!object || object.customMetadata?.[objectMarker] !== job.id) {
          // An absent result cannot prove that a single uncertain upload will never finish.
          await db.update(photos).set({ cleanupAfter: retryAt }).where(and(retired, eq(photos.sealed, false))).run();
          result.pending++;
          continue;
        }
        await db.update(photos).set({ sealed: true }).where(retired).run();
      }
      await bucket.delete(job.objectKey);
      const rows = await db.delete(photos).where(and(retired, eq(photos.sealed, true))).returning({ id: photos.id });
      result.deleted += rows.length;
    } catch {
      await db.update(photos).set({ cleanupAfter: retryAt }).where(retired).run();
      result.failed++;
    }
  }
  return result;
}
