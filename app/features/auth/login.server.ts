import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/client.server";
import { users } from "../../db/schema";
import type { UserRole } from "./guards.server";
import { assertMemberAccess } from "./member-access.server";

export interface UpsertBetaUserInput {
  email: string;
  displayName: string;
  adminEmail?: string;
  now: string;
  userId: string;
}

export async function upsertBetaUser(
  db: AppDb,
  input: UpsertBetaUserInput,
): Promise<{ id: string; role: UserRole }> {
  const email = input.email.trim().toLowerCase();
  const adminEmail = input.adminEmail?.trim().toLowerCase();
  const role: UserRole = adminEmail && email === adminEmail ? "ADMIN" : "USER";
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existing) {
    await assertMemberAccess(db, existing.id, input.now);
    await db
      .update(users)
      .set({
        displayName: input.displayName.trim(),
        updatedAt: input.now,
      })
      .where(eq(users.id, existing.id));
    return { id: existing.id, role: existing.role };
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
