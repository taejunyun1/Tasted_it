import type { AppDb } from "../../db/client.server";
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
    return Boolean(seat && codes.includes(seat.code));
  } catch {
    // A failed seat lookup must not open uploads or prevent text-only reviews.
    return false;
  }
}
