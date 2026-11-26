import { sql, type SQLWrapper } from "drizzle-orm";

export function directlyVerifiedAuthorCondition(userId: SQLWrapper) {
  return sql<boolean>`(
    exists(select 1 from student_seats where user_id = ${userId})
    or exists(select 1 from student_invitations where consumed_by = ${userId} and consumed_at is not null)
  )`.mapWith(Boolean);
}
