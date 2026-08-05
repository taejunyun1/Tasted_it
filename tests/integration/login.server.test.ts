import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { upsertBetaUser } from "../../app/features/auth/login.server";

describe("upsertBetaUser", () => {
  it("assigns ADMIN only to the configured admin email", async () => {
    const db = createDb(env.DB);

    const admin = await upsertBetaUser(db, {
      email: env.ADMIN_EMAIL,
      displayName: "관리자",
      adminEmail: env.ADMIN_EMAIL,
      now: "2026-08-05T00:00:00Z",
      userId: "admin-user",
    });
    const user = await upsertBetaUser(db, {
      email: "user@example.com",
      displayName: "일반 사용자",
      adminEmail: env.ADMIN_EMAIL,
      now: "2026-08-05T00:00:00Z",
      userId: "normal-user",
    });

    expect(admin.role).toBe("ADMIN");
    expect(user.role).toBe("USER");
  });
});
