import { getTableColumns } from "drizzle-orm";
import type { AppDb } from "../../db/client.server";
import { reviewerPhotoCleanupGuards, reviewerPhotoCleanupJobs } from "../../db/schema";
import type { SessionUser } from "../auth/session.server";
import { getStudentSeat } from "./invitations.server";
import { seatCodeSchema } from "./policy";

export async function canUploadReviewerPhotos(db: AppDb, input: {
  user: Pick<SessionUser, "id" | "role">;
  now: string;
  globalEnabled: string;
  studentWorkspaceEnabled: string;
  pilotSeats?: string;
}) {
  if (input.globalEnabled === "true") return true;
  if (input.studentWorkspaceEnabled !== "true" || input.user.role !== "REVIEWER" || !input.pilotSeats) return false;

  const codes = input.pilotSeats.split(",").map((value) => value.trim());
  if (codes.length > 2 || new Set(codes).size !== codes.length ||
      codes.some((code) => !seatCodeSchema.safeParse(code).success)) return false;

  try {
    const seat = await getStudentSeat(db, { userId: input.user.id, now: input.now });
    if (!seat || !codes.includes(seat.code)) return false;

    // A zero-row select verifies the cleanup schema without reading job data.
    await db.select({
      ...getTableColumns(reviewerPhotoCleanupJobs),
      guardId: reviewerPhotoCleanupGuards.id,
      guardPassed: reviewerPhotoCleanupGuards.passed,
    }).from(reviewerPhotoCleanupJobs).crossJoin(reviewerPhotoCleanupGuards).limit(0);
    return true;
  } catch {
    // An unavailable seat or cleanup schema must not prevent text-only reviews.
    return false;
  }
}
