import { describe, expect, it } from "vitest";
import { assignmentSchema, classificationSchema, inviteTokenSchema, mayReviewTask, permissionsForSeat, safeQaPath } from "../../app/features/students/policy";

describe("student capabilities", () => {
  it("gives A and B registration attestation without an administrator role", () => {
    for (const seat of ["A", "B"] as const) {
      expect(permissionsForSeat(seat)).toEqual({ classifyPlaces: true, classifyReviews: false, recordQa: true, approveRegistration: true });
    }
    for (const seat of ["C", "D"] as const) {
      expect(permissionsForSeat(seat)).toEqual({ classifyPlaces: false, classifyReviews: true, recordQa: true, approveRegistration: false });
    }
  });
  it("requires a distinct assigned checker rather than trusting a submitted user ID", () => {
    expect(mayReviewTask({ actorSeat: "B", assignedSeat: "A", checkerSeat: "B", actorUserId: "b", submittedBy: "a" })).toBe(true);
    expect(mayReviewTask({ actorSeat: "A", assignedSeat: "A", checkerSeat: "B", actorUserId: "a", submittedBy: "a" })).toBe(false);
    expect(mayReviewTask({ actorSeat: "C", assignedSeat: "A", checkerSeat: "B", actorUserId: "c", submittedBy: "a" })).toBe(false);
    expect(mayReviewTask({ actorSeat: "B", assignedSeat: "A", checkerSeat: "B", actorUserId: "a", submittedBy: "a" })).toBe(false);
  });
});

describe("student input contracts", () => {
  it("accepts a bounded random invitation and rejects malformed tokens", () => {
    expect(inviteTokenSchema.safeParse("A".repeat(43)).success).toBe(true);
    for (const token of ["", "A".repeat(42), "A".repeat(44), "../".repeat(15), "<script>"]) expect(inviteTokenSchema.safeParse(token).success).toBe(false);
  });
  it("forbids self assignment and fields that could broaden authority", () => {
    expect(assignmentSchema.safeParse({ kind: "PLACE", assignedSeat: "A", checkerSeat: "B", targetId: "item", title: "점포 분류" }).success).toBe(true);
    expect(assignmentSchema.safeParse({ kind: "PLACE", assignedSeat: "A", checkerSeat: "A", targetId: "item", title: "점포 분류" }).success).toBe(false);
    expect(assignmentSchema.safeParse({ kind: "QA", assignedSeat: "D", checkerSeat: "C", targetId: "/places", title: "목록 시험", role: "ADMIN" }).success).toBe(false);
  });
  it("requires a reason and a category for eligible place classification", () => {
    expect(classificationSchema.safeParse({ kind: "PLACE", decision: "ELIGIBLE", categoryId: "food", note: "현장에서 영업과 홀 좌석 및 대표 메뉴를 확인했습니다.", evidenceUrl: "https://example.org/store" }).success).toBe(true);
    expect(classificationSchema.safeParse({ kind: "PLACE", decision: "ELIGIBLE", note: "충분히 긴 조사 근거를 이곳에 기록합니다.", evidenceUrl: "" }).success).toBe(false);
    expect(classificationSchema.safeParse({ kind: "REVIEW", decision: "PASS", note: "리뷰 확인", evidenceUrl: "" }).success).toBe(false);
  });
  it("does not accept executable evidence links or private URL credentials", () => {
    for (const evidenceUrl of ["javascript:alert(1)", "https://user:password@example.org/", "file:///etc/passwd"]) {
      expect(classificationSchema.safeParse({ kind: "REVIEW", decision: "VERIFIED", note: "장소와 메뉴가 일치하는지 확인했습니다.", evidenceUrl }).success).toBe(false);
    }
  });
  it("restricts QA destinations to public internal routes", () => {
    for (const path of ["/", "/places", "/places/store?category=food", "/courses", "/onboarding/taste"]) expect(safeQaPath(path)).toBe(path);
    for (const path of ["//evil.test", "/admin", "/admin/ratings", "/auth/google", "/student/join#token", "/places/../admin", "/places/%2e%2e/admin", "https://example.org", "/places\\admin"]) expect(safeQaPath(path)).toBeNull();
  });
});
