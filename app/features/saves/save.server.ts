import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { memberSaveChoices, savedPlaces } from "../../db/schema";
import {
  advanceTasteLearningVersion,
  refreshInferredTasteSignals,
} from "../members/taste-learning.server";

export interface SaveInput {
  userId: string;
  placeId: string;
  saved: boolean;
  now: string;
}

export async function setSaved(db: AppDb, input: SaveInput): Promise<void> {
  const mutation = input.saved
    ? db.insert(savedPlaces).values({
      userId: input.userId,
      placeId: input.placeId,
      createdAt: input.now,
    }).onConflictDoNothing()
    : db.delete(savedPlaces).where(and(
      eq(savedPlaces.userId, input.userId),
      eq(savedPlaces.placeId, input.placeId),
    ));
  await db.batch([
    mutation,
    db.insert(memberSaveChoices).values({ userId: input.userId, placeId: input.placeId, saved: input.saved, updatedAt: input.now })
      .onConflictDoUpdate({ target: [memberSaveChoices.userId, memberSaveChoices.placeId], set: { saved: input.saved, updatedAt: input.now } }),
  ]);
}

export async function setSavedAndRefreshTaste(
  db: AppDb,
  input: SaveInput,
  options: {
    advanceVersion?: typeof advanceTasteLearningVersion;
    refreshTaste?: typeof refreshInferredTasteSignals;
  } = {},
): Promise<void> {
  await setSaved(db, input);
  try {
    const observedVersion = await (options.advanceVersion ?? advanceTasteLearningVersion)(
      db,
      input.userId,
      input.now,
    );
    await (options.refreshTaste ?? refreshInferredTasteSignals)(
      db,
      input.userId,
      input.now,
      { observedVersion },
    );
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
