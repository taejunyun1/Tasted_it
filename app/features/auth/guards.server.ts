export type UserRole = "USER" | "REVIEWER" | "ADMIN";

export function assertRole(
  actual: UserRole,
  allowed: readonly UserRole[],
): void {
  if (!allowed.includes(actual)) {
    throw new Response("Forbidden", {
      status: 403,
      statusText: "FORBIDDEN",
    });
  }
}
