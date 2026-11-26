import { and, asc, desc, eq, inArray, isNull, like, ne, notExists, or, sql } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { adminAuditLogs, categories, placeSuggestions, reviewerApplications, reviewerProfiles, users } from "../../db/schema";
import { isWithdrawnEmail } from "../auth/withdraw";
import { slugifyPlaceName } from "../places/place-slug";
import { directlyVerifiedAuthorCondition } from "./direct-verification.server";
import { isDormantAt, type ReviewerApplicationInput, validateReviewerApplication } from "./reviewer-policy";

const OPEN_APPLICATIONS = ["APPLIED", "REVIEWING"] as const;

export async function countApprovedPlaceSuggestions(db: AppDb, userId: string) {
  const rows = await db.select({ id: placeSuggestions.id }).from(placeSuggestions)
    .where(and(eq(placeSuggestions.userId, userId), eq(placeSuggestions.status, "APPROVED")));
  return rows.length;
}

export async function submitReviewerApplication(db: AppDb, input: ReviewerApplicationInput & { userId: string; now: string }) {
  const errors = validateReviewerApplication(input);
  if (Object.keys(errors).length) throw new Error(`REVIEWER_APPLICATION_INVALID:${JSON.stringify(errors)}`);
  const openApplications = db.select({ id: reviewerApplications.id }).from(reviewerApplications)
    .where(and(eq(reviewerApplications.userId, input.userId), inArray(reviewerApplications.status, OPEN_APPLICATIONS)))
    .limit(1);
  const existingProfiles = db.select({ userId: reviewerProfiles.userId }).from(reviewerProfiles)
    .where(eq(reviewerProfiles.userId, input.userId)).limit(1);
  const assertCanApply = async () => {
    if (await openApplications.get()) throw new Error("REVIEWER_APPLICATION_IN_PROGRESS");
    if (await existingProfiles.get()) throw new Error("REVIEWER_PROFILE_EXISTS");
  };
  await assertCanApply();

  const specialties = [...new Set(input.specialtySlugs)];
  const specialtyRows = await db.select({ slug: categories.slug }).from(categories)
    .where(and(inArray(categories.slug, specialties), isNull(categories.parentId), eq(categories.isActive, true)));
  if (specialtyRows.length !== specialties.length) throw new Error("REVIEWER_SPECIALTY_NOT_FOUND");
  const id = crypto.randomUUID();
  const approvedSuggestionCount = await countApprovedPlaceSuggestions(db, input.userId);
  const [application] = await db.all<{ id: string }>(sql`
    insert into ${reviewerApplications}
      (id, user_id, status, statement, occupation, taste_direction, region_code, specialty_slugs,
       approved_suggestion_count, created_at, updated_at)
    select ${id}, ${input.userId}, 'APPLIED', ${input.statement.trim()}, ${input.occupation.trim()},
      ${input.tasteDirection.trim()}, ${input.regionCode}, ${JSON.stringify(specialties)},
      ${approvedSuggestionCount}, ${input.now}, ${input.now}
    where ${notExists(openApplications)} and ${notExists(existingProfiles)}
    returning id
  `);
  if (!application) {
    await assertCanApply();
    throw new Error("REVIEWER_APPLICATION_IN_PROGRESS");
  }
  return { id: application.id, approvedSuggestionCount };
}

export async function reviewReviewerApplication(db: AppDb, input: {
  applicationId: string;
  actorUserId: string;
  decision: "START_REVIEW" | "APPROVE" | "OVERRIDE_APPROVE" | "REJECT";
  reason: string;
  now: string;
}) {
  const application = await db.query.reviewerApplications.findFirst({ where: eq(reviewerApplications.id, input.applicationId) });
  if (!application || !OPEN_APPLICATIONS.includes(application.status as (typeof OPEN_APPLICATIONS)[number])) throw new Error("REVIEWER_APPLICATION_NOT_REVIEWABLE");
  const reason = input.reason.trim();
  if (input.decision === "START_REVIEW") {
    await db.batch([
      db.update(reviewerApplications).set({ status: "REVIEWING", reviewedBy: input.actorUserId, updatedAt: input.now }).where(eq(reviewerApplications.id, application.id)),
      audit(db, input.actorUserId, "START_REVIEWER_REVIEW", application.id, application.status, "REVIEWING", input.now),
    ]);
    return { status: "REVIEWING" as const };
  }
  if (input.decision === "REJECT") {
    if (!reason) throw new Error("REVIEW_REASON_REQUIRED");
    await db.batch([
      db.update(reviewerApplications).set({ status: "REJECTED", adminNote: reason, reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(eq(reviewerApplications.id, application.id)),
      audit(db, input.actorUserId, "REJECT_REVIEWER_APPLICATION", application.id, application.status, "REJECTED", input.now),
    ]);
    return { status: "REJECTED" as const };
  }
  const override = input.decision === "OVERRIDE_APPROVE";
  if (application.approvedSuggestionCount < 10 && !override) throw new Error("REVIEWER_REQUIREMENT_NOT_MET");
  if (override && !reason) throw new Error("REVIEWER_OVERRIDE_REASON_REQUIRED");
  const user = await db.query.users.findFirst({ where: eq(users.id, application.userId) });
  if (!user) throw new Error("USER_NOT_FOUND");
  let slug = slugifyPlaceName(user.displayName);
  for (let suffix = 2; ; suffix += 1) {
    const existing = await db.query.reviewerProfiles.findFirst({ where: eq(reviewerProfiles.slug, slug) });
    if (!existing || existing.userId === user.id) break;
    slug = `${slugifyPlaceName(user.displayName)}-${suffix}`;
  }
  await db.batch([
    db.update(reviewerApplications).set({ status: "APPROVED", overrideReason: override ? reason : null, adminNote: reason || null, reviewedBy: input.actorUserId, reviewedAt: input.now, updatedAt: input.now }).where(eq(reviewerApplications.id, application.id)),
    db.insert(reviewerProfiles).values({
      userId: user.id, slug, status: "ACTIVE", occupation: application.occupation, tasteDirection: application.tasteDirection,
      regionCode: application.regionCode, specialtySlugs: application.specialtySlugs, lastActivityAt: input.now,
      approvedAt: input.now, approvedBy: input.actorUserId, statusReason: override ? reason : null, createdAt: input.now, updatedAt: input.now,
    }).onConflictDoUpdate({ target: reviewerProfiles.userId, set: { slug, status: "ACTIVE", occupation: application.occupation, tasteDirection: application.tasteDirection, regionCode: application.regionCode, specialtySlugs: application.specialtySlugs, lastActivityAt: input.now, approvedAt: input.now, approvedBy: input.actorUserId, statusReason: override ? reason : null, updatedAt: input.now } }),
    db.update(users).set({ role: "REVIEWER", updatedAt: input.now }).where(and(eq(users.id, user.id), ne(users.role, "ADMIN"))),
    audit(db, input.actorUserId, override ? "OVERRIDE_APPROVE_REVIEWER" : "APPROVE_REVIEWER", application.id, application.status, "APPROVED", input.now),
  ]);
  return { status: "APPROVED" as const, slug };
}

export async function changeReviewerStatus(db: AppDb, input: { userId: string; actorUserId: string; status: "ACTIVE" | "DORMANT" | "SUSPENDED"; reason: string; now: string }) {
  const profile = await db.query.reviewerProfiles.findFirst({ where: eq(reviewerProfiles.userId, input.userId) });
  if (!profile) throw new Error("REVIEWER_PROFILE_NOT_FOUND");
  const reason = input.reason.trim();
  if (!reason) throw new Error("REVIEW_REASON_REQUIRED");
  await db.batch([
    db.update(reviewerProfiles).set({ status: input.status, statusReason: reason, lastActivityAt: input.status === "ACTIVE" ? input.now : profile.lastActivityAt, updatedAt: input.now }).where(eq(reviewerProfiles.userId, input.userId)),
    db.update(users).set({ role: input.status === "ACTIVE" ? "REVIEWER" : "USER", updatedAt: input.now }).where(and(eq(users.id, input.userId), ne(users.role, "ADMIN"))),
    audit(db, input.actorUserId, `SET_REVIEWER_${input.status}`, input.userId, profile.status, input.status, input.now),
  ]);
}

export async function applyReviewerDormancy(db: AppDb, input: { actorUserId: string; now: string }) {
  const active = await db.select().from(reviewerProfiles).where(eq(reviewerProfiles.status, "ACTIVE"));
  const targets = active.filter((profile) => isDormantAt(profile.lastActivityAt, input.now));
  for (const profile of targets) await changeReviewerStatus(db, { userId: profile.userId, actorUserId: input.actorUserId, status: "DORMANT", reason: "90일 리뷰어 활동 없음", now: input.now });
  return { changed: targets.length };
}

export async function getPublicReviewerProfile(db: AppDb, slug: string) {
  const [row] = await db.select({
    profile: reviewerProfiles,
    displayName: users.displayName,
    email: users.email,
    directlyVerified: directlyVerifiedAuthorCondition(reviewerProfiles.userId),
  }).from(reviewerProfiles)
    .innerJoin(users, eq(users.id, reviewerProfiles.userId))
    .where(and(eq(reviewerProfiles.slug, slug), eq(reviewerProfiles.status, "ACTIVE"), eq(users.role, "REVIEWER"))).limit(1);
  if (!row || isWithdrawnEmail(row.email)) return null;
  const specialtySlugs = parseSlugs(row.profile.specialtySlugs);
  const specialtyRows = specialtySlugs.length ? await db.select({ slug: categories.slug, name: categories.name, emoji: categories.emoji }).from(categories).where(inArray(categories.slug, specialtySlugs)) : [];
  return { ...row.profile, displayName: row.displayName, directlyVerified: row.directlyVerified, specialties: specialtyRows };
}

export async function getReviewerDashboard(db: AppDb, userId: string) {
  const [latestApplication, profile, approvedSuggestionCount] = await Promise.all([
    db.query.reviewerApplications.findFirst({
      columns: { status: true },
      where: eq(reviewerApplications.userId, userId),
      // Older duplicate submissions can leave a pending application after a later rejection.
      orderBy: [
        desc(inArray(reviewerApplications.status, OPEN_APPLICATIONS)),
        desc(reviewerApplications.createdAt),
        desc(reviewerApplications.id),
      ],
    }),
    db.query.reviewerProfiles.findFirst({ columns: { status: true, slug: true }, where: eq(reviewerProfiles.userId, userId) }),
    countApprovedPlaceSuggestions(db, userId),
  ]);
  return { latestApplication, profile, approvedSuggestionCount };
}

export async function listReviewerAdminRows(db: AppDb, filters: { status?: string; query?: string } = {}) {
  const applicationStatuses = ["APPLIED", "REVIEWING", "REJECTED"] as const;
  const profileStatuses = ["ACTIVE", "DORMANT", "SUSPENDED"] as const;
  const applicationFilter = filters.status && applicationStatuses.includes(filters.status as (typeof applicationStatuses)[number]);
  const profileFilter = filters.status && profileStatuses.includes(filters.status as (typeof profileStatuses)[number]);
  const applicationConditions = applicationFilter
    ? [eq(reviewerApplications.status, filters.status as (typeof applicationStatuses)[number])]
    : [inArray(reviewerApplications.status, [...applicationStatuses])];
  if (filters.query?.trim()) {
    const query = `%${filters.query.trim()}%`;
    applicationConditions.push(or(like(users.displayName, query), like(users.email, query))! as never);
  }
  const applications = profileFilter ? [] : await db.select({ application: reviewerApplications, displayName: users.displayName, email: users.email }).from(reviewerApplications)
    .innerJoin(users, eq(users.id, reviewerApplications.userId))
    .where(applicationConditions.length ? and(...applicationConditions) : undefined).orderBy(desc(reviewerApplications.createdAt));
  const profileConditions = profileFilter ? [eq(reviewerProfiles.status, filters.status as (typeof profileStatuses)[number])] : [];
  if (filters.query?.trim()) {
    const query = `%${filters.query.trim()}%`;
    profileConditions.push(or(like(users.displayName, query), like(users.email, query))! as never);
  }
  const profiles = applicationFilter ? [] : await db.select({ profile: reviewerProfiles, displayName: users.displayName, email: users.email }).from(reviewerProfiles)
    .innerJoin(users, eq(users.id, reviewerProfiles.userId)).where(profileConditions.length ? and(...profileConditions) : undefined).orderBy(asc(users.displayName));
  return { applications, profiles };
}

function parseSlugs(value: string) {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}

function audit(db: AppDb, actorUserId: string, action: string, targetId: string, beforeState: string | null, afterState: string | null, now: string) {
  return db.insert(adminAuditLogs).values({ id: crypto.randomUUID(), actorUserId, action, targetType: "REVIEWER", targetId, beforeState, afterState, createdAt: now });
}
