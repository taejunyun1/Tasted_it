import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { placeSuggestions, reviewerApplications, reviewerProfiles, sessions, users } from "../../app/db/schema";
import { loader as mySuggestions } from "../../app/routes/my-suggestions";
import { loader as reviewerApply } from "../../app/routes/reviewer-apply";
import { loader as publicReviewer } from "../../app/routes/reviewer-profile";

const now = "2026-11-20T02:00:00.000Z";
const staffNote = "synthetic-staff-only-review-note";
const memberNote = "제안에 현재 영업 정보를 추가로 확인해 주세요.";

async function ownerFixture() {
  const db = createDb(env.DB);
  const id = crypto.randomUUID();
  const category = await db.query.categories.findFirst();
  if (!category) throw new Error("missing category fixture");
  const staffId = `internal-staff-${id}`;
  const owners = (["ACTIVE", "DORMANT"] as const).map((status) => ({
    id: `owner-${status}-${id}`, sessionId: crypto.randomUUID(), slug: `public-${status.toLowerCase()}-${id}`,
    suggestionId: crypto.randomUUID(), status, name: `합성 장소 ${status}`,
    role: status === "ACTIVE" ? "REVIEWER" as const : "USER" as const,
  }));
  await db.insert(users).values([
    { id: staffId, email: `${staffId}@example.test`, displayName: "합성 운영자", role: "ADMIN", createdAt: now, updatedAt: now },
    ...owners.map((owner) => ({ id: owner.id, email: `${owner.id}@example.test`, displayName: owner.name, role: owner.role, createdAt: now, updatedAt: now })),
  ]);
  await db.insert(sessions).values(owners.map((owner) => ({
    id: owner.sessionId, userId: owner.id, expiresAt: "2099-01-01T00:00:00.000Z", createdAt: now,
  })));
  await db.insert(placeSuggestions).values(owners.map((owner) => ({
    id: owner.suggestionId, userId: owner.id, status: "NEEDS_INFO" as const,
    name: owner.name, normalizedName: "synthetic-normalized-name", address: "광주광역시 동구 합성로 10", normalizedAddress: "synthetic-normalized-address",
    neighborhood: "동명동", categoryId: category.id, latitude: 35.15, longitude: 126.92, phone: "000-0000-0000",
    duplicateOverrideReason: "synthetic-duplicate-reason", reviewReason: memberNote, reviewedBy: staffId, reviewedAt: now, createdAt: now, updatedAt: now,
  })));
  await db.insert(reviewerApplications).values(owners.map((owner) => ({
    id: crypto.randomUUID(), userId: owner.id, status: "APPROVED" as const,
    statement: "synthetic-application-text", occupation: "합성 활동 소개", tasteDirection: "균형",
    regionCode: "GWANGJU" as const, specialtySlugs: "[]", adminNote: staffNote, overrideReason: staffNote,
    reviewedBy: staffId, reviewedAt: now, createdAt: now, updatedAt: now,
  })));
  await db.insert(reviewerProfiles).values(owners.map((owner) => ({
    userId: owner.id, slug: owner.slug, status: owner.status,
    occupation: "합성 활동 소개", tasteDirection: "균형", regionCode: "GWANGJU" as const, specialtySlugs: "[]",
    lastActivityAt: now, approvedAt: now, approvedBy: staffId, statusReason: owner.status === "DORMANT" ? staffNote : null,
    createdAt: now, updatedAt: now,
  })));
  return { db, owners, staffId };
}

function request(path: string, sessionId: string) {
  return new Request(`https://fixture.test${path}`, { headers: { Cookie: `retaste_session=${sessionId}` } });
}

it("returns only each member's displayed suggestion history and keeps the member-facing review reason", async () => {
  const { owners } = await ownerFixture();
  for (const owner of owners) {
    expect(await mySuggestions({ request: request("/me/suggestions", owner.sessionId) } as never)).toEqual({
      items: [{
        id: owner.suggestionId, status: "NEEDS_INFO", name: owner.name, address: "광주광역시 동구 합성로 10",
        reviewReason: memberNote, reviewedAt: now, createdAt: now,
      }],
    });
  }
});

it("returns only reviewer application status and offers a link only while the public profile is eligible", async () => {
  const { db, owners, staffId } = await ownerFixture();
  for (const owner of owners) {
    const result = await reviewerApply({ request: request("/reviewer/apply", owner.sessionId) } as never);
    expect(Object.keys(result).sort()).toEqual(["dashboard", "parentCategories"]);
    expect(result.dashboard).toEqual({
      latestApplication: { status: "APPROVED" },
      profile: { status: owner.status, publicSlug: owner.status === "ACTIVE" ? owner.slug : null },
      approvedSuggestionCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain(staffId);
    expect(JSON.stringify(result)).not.toContain(staffNote);
    expect(Object.keys(result.parentCategories[0]!).sort()).toEqual(["emoji", "id", "name", "slug"]);

    const profile = () => publicReviewer({ params: { slug: owner.slug } } as never);
    if (owner.status === "DORMANT") {
      await expect(profile()).rejects.toMatchObject({ status: 404 });
    } else {
      await expect(profile()).resolves.toMatchObject({ profile: { displayName: owner.name } });
      await db.update(users).set({ role: "USER" }).where(eq(users.id, owner.id));
      const downgraded = await reviewerApply({ request: request("/reviewer/apply", owner.sessionId) } as never);
      expect(downgraded.dashboard.profile).toEqual({ status: "ACTIVE", publicSlug: null });
      await expect(profile()).rejects.toMatchObject({ status: 404 });
    }
  }
});
