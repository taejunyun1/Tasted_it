import { eq } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { studentInvitations, studentSeats } from "../../db/schema";
import { studentAudit } from "./invitations.server";

type FailureReason = "ACCOUNT_NOT_ELIGIBLE" | "INVITE_NOT_FOUND" | "INVITE_ALREADY_USED" | "INVITE_REVOKED" | "INVITE_EXPIRED"
  | "SEAT_NOT_FOUND" | "SEAT_INACTIVE" | "SEAT_EXPIRED" | "SEAT_ALREADY_LINKED" | "ACCOUNT_ALREADY_LINKED" | "CLAIM_CONFLICT" | "UNEXPECTED";

async function diagnose(db: AppDb, input: { userId: string; token: string; error: unknown; now: string }): Promise<{ reason: FailureReason; status: number; seatCode: string | null }> {
  const code = input.error instanceof Error ? input.error.message : "";
  if (code === "STUDENT_ACCOUNT_REQUIRED") return { reason: "ACCOUNT_NOT_ELIGIBLE", status: 403, seatCode: null };
  if (code !== "STUDENT_INVITE_INVALID") return { reason: "UNEXPECTED", status: 500, seatCode: null };
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const invite = await db.query.studentInvitations.findFirst({
    columns: { seatCode: true, consumedAt: true, revokedAt: true, expiresAt: true },
    where: eq(studentInvitations.tokenHash, hash),
  });
  const failure = (reason: FailureReason) => ({ reason, status: 400, seatCode: invite?.seatCode ?? null });
  if (!invite) return failure("INVITE_NOT_FOUND");
  if (invite.consumedAt) return failure("INVITE_ALREADY_USED");
  if (invite.revokedAt) return failure("INVITE_REVOKED");
  if (invite.expiresAt <= input.now) return failure("INVITE_EXPIRED");
  const seat = await db.query.studentSeats.findFirst({ columns: { isActive: true, expiresAt: true, userId: true }, where: eq(studentSeats.code, invite.seatCode) });
  if (!seat) return failure("SEAT_NOT_FOUND");
  if (!seat.isActive) return failure("SEAT_INACTIVE");
  if (seat.expiresAt <= input.now) return failure("SEAT_EXPIRED");
  if (seat.userId) return failure("SEAT_ALREADY_LINKED");
  const linked = await db.query.studentSeats.findFirst({ columns: { code: true }, where: eq(studentSeats.userId, input.userId) });
  return failure(linked ? "ACCOUNT_ALREADY_LINKED" : "CLAIM_CONFLICT");
}

/** Call only after the authenticated request passes form and JOIN rate-limit validation. */
export async function recordStudentInviteFailure(db: AppDb, input: { userId: string; token: string; error: unknown; now: string }) {
  try {
    // This is a post-failure state snapshot, not a replacement for the atomic acceptance checks.
    const detail = await diagnose(db, input);
    await studentAudit(db, input.userId, "STUDENT_INVITE_FAILED", detail.seatCode ?? "join", detail, input.now);
  } catch {
    // Logging must not replace the original response or expose database errors/token material.
    console.warn("STUDENT_INVITE_AUDIT_FAILED");
  }
}
