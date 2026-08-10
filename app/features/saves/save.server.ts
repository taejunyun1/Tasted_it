import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { savedPlaces } from "../../db/schema";
import { refreshInferredTasteSignals } from "../members/taste-learning.server";

export interface SaveInput {
  userId: string;
  placeId: string;
  saved: boolean;
  now: string;
}

export async function setSaved(db: AppDb, input: SaveInput): Promise<void> {
  if (input.saved) {
    await db.insert(savedPlaces).values({
      userId: input.userId,
      placeId: input.placeId,
      createdAt: input.now,
    }).onConflictDoNothing();
    return;
  }
  await db.delete(savedPlaces).where(and(
    eq(savedPlaces.userId, input.userId),
    eq(savedPlaces.placeId, input.placeId),
  ));
}

export async function setSavedAndRefreshTaste(
  db: AppDb,
  input: SaveInput,
  options: { refreshTaste?: typeof refreshInferredTasteSignals } = {},
): Promise<void> {
  await setSaved(db, input);
  try {
    await (options.refreshTaste ?? refreshInferredTasteSignals)(db, input.userId, input.now);
  } catch {
    console.error("TASTE_LEARNING_REFRESH_FAILED");
  }
}

export async function getSaved(
  db: AppDb,
  input: Pick<SaveInput, "userId" | "placeId">,
): Promise<boolean> {
  const row = await db.query.savedPlaces.findFirst({
    where: and(
      eq(savedPlaces.userId, input.userId),
      eq(savedPlaces.placeId, input.placeId),
    ),
  });
  return Boolean(row);
}
