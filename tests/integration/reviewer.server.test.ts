import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { adminAuditLogs, reviewerApplications, reviewerProfiles, users } from "../../app/db/schema";
import {
  applyReviewerDormancy,
  changeReviewerStatus,
  getPublicReviewerProfile,
  listReviewerAdminRows,
  reviewReviewerApplication,
  submitReviewerApplication,
} from "../../app/features/reviewers/reviewer.server";

const now = "2026-08-05T00:00:00.000Z";
const input = {
  statement: "광주 골목 식당을 직접 방문하고 음식의 간과 재료, 가격 대비 만족도, 재방문 의사를 함께 기록합니다. 광고보다 일관된 기준과 솔직한 근거를 중요하게 생각합니다. 같은 기준으로 여러 번 방문해 계절과 시간대에 따른 차이도 기록하겠습니다.",
  occupation: "지역 콘텐츠 기획자",
  tasteDirection: "국물 요리와 오래된 동네 식당을 좋아합니다.",
  regionCode: "GWANGJU" as const,
  specialtySlugs: ["korean"],
};

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reviewer_profiles WHERE user_id='review-user'"),
    env.DB.prepare("DELETE FROM reviewer_applications WHERE user_id='review-user'"),
    env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,created_at,updated_at) VALUES ('review-user','review-user@example.com','맛기록자','USER',?,?)").bind(now, now),
    env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,created_at,updated_at) VALUES ('review-admin','review-admin@example.com','관리자','ADMIN',?,?)").bind(now, now),
    env.DB.prepare("UPDATE users SET role='USER' WHERE id='review-user'"),
  ]);
});

describe("reviewer management service", () => {
  it("prevents a duplicate open application but allows applying after rejection", async () => {
    const db = createDb(env.DB);
    const first = await submitReviewerApplication(db, { userId: "review-user", ...input, now });
    await expect(submitReviewerApplication(db, { userId: "review-user", ...input, now })).rejects.toThrow("REVIEWER_APPLICATION_IN_PROGRESS");
    await reviewReviewerApplication(db, { applicationId: first.id, actorUserId: "review-admin", decision: "REJECT", reason: "활동 근거를 더 작성해 주세요.", now });
    await expect(submitReviewerApplication(db, { userId: "review-user", ...input, now })).resolves.toBeDefined();
  });

  it("requires ten approved suggestions unless an override reason is recorded", async () => {
    const db = createDb(env.DB);
    const application = await submitReviewerApplication(db, { userId: "review-user", ...input, now });
    await expect(reviewReviewerApplication(db, { applicationId: application.id, actorUserId: "review-admin", decision: "APPROVE", reason: "", now })).rejects.toThrow("REVIEWER_REQUIREMENT_NOT_MET");
    await reviewReviewerApplication(db, { applicationId: application.id, actorUserId: "review-admin", decision: "OVERRIDE_APPROVE", reason: "초기 지역 리뷰어로 직접 검증 완료", now });
    expect(await db.query.users.findFirst({ where: (table, { eq }) => eq(table.id, "review-user") })).toMatchObject({ role: "REVIEWER" });
    expect(await db.query.reviewerProfiles.findFirst({ where: (table, { eq }) => eq(table.userId, "review-user") })).toMatchObject({ status: "ACTIVE" });
    expect((await db.select().from(adminAuditLogs)).some((log) => log.action === "OVERRIDE_APPROVE_REVIEWER")).toBe(true);
    await expect(submitReviewerApplication(db, { userId: "review-user", ...input, now })).rejects.toThrow("REVIEWER_PROFILE_EXISTS");

    const activeRows = await listReviewerAdminRows(db, { status: "ACTIVE" });
    expect(activeRows.applications).toHaveLength(0);
    expect(activeRows.profiles).toHaveLength(1);
    const searchedRows = await listReviewerAdminRows(db, { query: "review-user@example.com" });
    expect(searchedRows.applications).toHaveLength(0);
    expect(searchedRows.profiles).toHaveLength(1);
  });

  it("moves inactive reviewers to dormant and can reactivate or suspend them", async () => {
    const db = createDb(env.DB);
    const application = await submitReviewerApplication(db, { userId: "review-user", ...input, now: "2026-04-01T00:00:00.000Z" });
    await reviewReviewerApplication(db, { applicationId: application.id, actorUserId: "review-admin", decision: "OVERRIDE_APPROVE", reason: "초기 리뷰어", now: "2026-04-01T00:00:00.000Z" });
    expect(await applyReviewerDormancy(db, { actorUserId: "review-admin", now })).toEqual({ changed: 1 });
    expect(await db.query.users.findFirst({ where: (table, { eq }) => eq(table.id, "review-user") })).toMatchObject({ role: "USER" });
    await expect(submitReviewerApplication(db, { userId: "review-user", ...input, now })).rejects.toThrow("REVIEWER_PROFILE_EXISTS");
    await changeReviewerStatus(db, { userId: "review-user", actorUserId: "review-admin", status: "ACTIVE", reason: "활동 재개 확인", now });
    expect(await db.query.users.findFirst({ where: (table, { eq }) => eq(table.id, "review-user") })).toMatchObject({ role: "REVIEWER" });
    await changeReviewerStatus(db, { userId: "review-user", actorUserId: "review-admin", status: "SUSPENDED", reason: "운영 정책 위반", now });
    const profile = await db.query.reviewerProfiles.findFirst({ where: (table, { eq }) => eq(table.userId, "review-user") });
    expect(profile).toMatchObject({ status: "SUSPENDED" });
    await expect(getPublicReviewerProfile(db, profile!.slug)).resolves.toBeNull();
  });
});
