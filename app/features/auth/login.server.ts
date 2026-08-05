import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { users } from "../../db/schema";
import type { UserRole } from "./guards.server";

export interface UpsertBetaUserInput {
  email: string;
  displayName: string;
  adminEmail: string;
  now: string;
  userId: string;
}

export async function upsertBetaUser(
  db: AppDb,
  input: UpsertBetaUserInput,
): Promise<{ id: string; role: UserRole }> {
  const email = input.email.trim().toLowerCase();
  const role: UserRole =
    email === input.adminEmail.trim().toLowerCase() ? "ADMIN" : "USER";
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existing) {
    await db
      .update(users)
      .set({
        displayName: input.displayName.trim(),
        role,
        updatedAt: input.now,
      })
      .where(eq(users.id, existing.id));
    return { id: existing.id, role };
  }

  await db.insert(users).values({
    id: input.userId,
    email,
    displayName: input.displayName.trim(),
    role,
    createdAt: input.now,
    updatedAt: input.now,
  });
  return { id: input.userId, role };
}
