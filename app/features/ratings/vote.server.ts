import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { currentVotes, voteEvents } from "../../db/schema";

export interface CastVoteInput {
  placeId: string;
  userId: string;
  value: -1 | 1;
  now: string;
  eventId: string;
}

export async function castVote(
  db: AppDb,
  input: CastVoteInput,
): Promise<void> {
  if (input.value !== 1 && input.value !== -1) {
    throw new Error("INVALID_VOTE_VALUE");
  }

  const previous = await db.query.currentVotes.findFirst({
    where: and(
      eq(currentVotes.placeId, input.placeId),
      eq(currentVotes.userId, input.userId),
    ),
  });

  await db.batch([
    db.insert(voteEvents).values({
      id: input.eventId,
      placeId: input.placeId,
      userId: input.userId,
      value: input.value,
      eventType: previous ? "CHANGE" : "CREATE",
      previousEventId: previous?.eventId ?? null,
      createdAt: input.now,
    }),
    db
      .insert(currentVotes)
      .values({
        placeId: input.placeId,
        userId: input.userId,
        eventId: input.eventId,
        value: input.value,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [currentVotes.placeId, currentVotes.userId],
        set: {
          eventId: input.eventId,
          value: input.value,
          updatedAt: input.now,
        },
      }),
  ]);
}
