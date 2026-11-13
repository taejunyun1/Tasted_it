import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import {
  currentVotes,
  placeCategories,
  placeRevisions,
  placeSlugRedirects,
  places,
  savedPlaces,
  users,
  voteEvents,
} from "../../app/db/schema";
import {
  mergePlaces,
  restorePlaceRevision,
} from "../../app/features/places/place-merge.server";

describe("place merge and forward restore", () => {
  it("moves current relationships, hides the absorbed place, and creates a slug redirect", async () => {
    const db = createDb(env.DB);
    const prefix = `merge-${crypto.randomUUID()}`;
    const now = "2026-08-06T12:00:00.000Z";
    const category = await db.query.categories.findFirst();
    if (!category) throw new Error("category fixture missing");
    await db.insert(users).values([
      {
        id: `${prefix}-admin`,
        email: `${prefix}-admin@example.com`,
        displayName: "관리자",
        role: "ADMIN",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `${prefix}-user`,
        email: `${prefix}-user@example.com`,
        displayName: "회원",
        role: "USER",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    for (const suffix of ["target", "source"])
      await db
        .insert(places)
        .values({
          id: `${prefix}-${suffix}`,
          slug: `${prefix}-${suffix}`,
          name: suffix,
          status: "PUBLISHED",
          address: `광주 ${suffix}`,
          neighborhood: "동명동",
          latitude: 35.1,
          longitude: 126.9,
          searchText: suffix,
          createdAt: now,
          updatedAt: now,
        });
    await db
      .insert(placeCategories)
      .values({
        placeId: `${prefix}-source`,
        categoryId: category.id,
        isPrimary: true,
      });
    await db
      .insert(savedPlaces)
      .values({
        userId: `${prefix}-user`,
        placeId: `${prefix}-source`,
        createdAt: now,
      });
    await db
      .insert(voteEvents)
      .values({
        id: `${prefix}-event`,
        placeId: `${prefix}-source`,
        userId: `${prefix}-user`,
        value: 1,
        eventType: "CREATE",
        createdAt: now,
      });
    await db
      .insert(currentVotes)
      .values({
        placeId: `${prefix}-source`,
        userId: `${prefix}-user`,
        eventId: `${prefix}-event`,
        value: 1,
        updatedAt: now,
      });
    await mergePlaces(db, {
      targetPlaceId: `${prefix}-target`,
      sourcePlaceId: `${prefix}-source`,
      actorUserId: `${prefix}-admin`,
      reason: "동일 지점",
      now,
    });
    expect(
      (await db.select().from(places)).find(
        (row) => row.id === `${prefix}-source`,
      )?.status,
    ).toBe("HIDDEN");
    expect(
      (await db.select().from(savedPlaces)).some(
        (row) => row.placeId === `${prefix}-target`,
      ),
    ).toBe(true);
    expect(
      (await db.select().from(currentVotes)).some(
        (row) => row.placeId === `${prefix}-target`,
      ),
    ).toBe(true);
    expect(
      (await db.select().from(placeSlugRedirects)).find(
        (row) => row.oldSlug === `${prefix}-source`,
      )?.placeId,
    ).toBe(`${prefix}-target`);
  });

  it("restores an earlier snapshot by creating a new revision", async () => {
    const db = createDb(env.DB);
    const prefix = `restore-${crypto.randomUUID()}`;
    const now = "2026-08-06T12:00:00.000Z";
    await db
      .insert(users)
      .values({
        id: `${prefix}-admin`,
        email: `${prefix}@example.com`,
        displayName: "관리자",
        role: "ADMIN",
        createdAt: now,
        updatedAt: now,
      });
    const original = {
      id: `${prefix}-place`,
      slug: `${prefix}-place`,
      name: "원래 상호",
      status: "PUBLISHED",
      address: "광주",
      neighborhood: "동명동",
      latitude: 35.1,
      longitude: 126.9,
      phone: null,
      parkingSummary: null,
      heroImageUrl: null,
      kakaoPlaceId: null,
      searchText: "원래 상호",
      lastVerifiedAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(places).values({ ...original, name: "변경 상호" });
    await db
      .insert(placeRevisions)
      .values({
        id: `${prefix}-revision`,
        placeId: original.id,
        actorUserId: `${prefix}-admin`,
        action: "CORRECTION",
        reason: "이전 수정",
        beforeJson: JSON.stringify(original),
        afterJson: JSON.stringify({ ...original, name: "변경 상호" }),
        sourceType: "TEST",
        createdAt: now,
      });
    await restorePlaceRevision(db, {
      revisionId: `${prefix}-revision`,
      actorUserId: `${prefix}-admin`,
      reason: "잘못된 수정 복원",
      now: "2026-08-06T12:10:00.000Z",
    });
    expect(
      (await db.select().from(places)).find((row) => row.id === original.id)
        ?.name,
    ).toBe("원래 상호");
    expect(
      (await db.select().from(placeRevisions))
        .filter((row) => row.placeId === original.id)
        .some((row) => row.action === "RESTORE"),
    ).toBe(true);
  });
});

async function mergeFixture() {
  const db = createDb(env.DB);
  const prefix = `merge-policy-${crypto.randomUUID()}`;
  const now = "2026-11-13T00:00:00.000Z";
  await db
    .insert(users)
    .values({
      id: `${prefix}-admin`,
      email: `${prefix}-admin@example.test`,
      displayName: "합성 관리자",
      role: "ADMIN",
      createdAt: now,
      updatedAt: now,
    });
  for (const suffix of ["source", "target"])
    await db
      .insert(places)
      .values({
        id: `${prefix}-${suffix}`,
        slug: `${prefix}-${suffix}`,
        name: `합성 ${suffix}`,
        status: "PUBLISHED",
        address: "합성 주소",
        neighborhood: "동명동",
        latitude: 35.1,
        longitude: 126.9,
        searchText: "합성",
        createdAt: now,
        updatedAt: now,
      });
  return {
    db,
    prefix,
    now,
    source: `${prefix}-source`,
    target: `${prefix}-target`,
    input: {
      sourcePlaceId: `${prefix}-source`,
      targetPlaceId: `${prefix}-target`,
      actorUserId: `${prefix}-admin`,
      reason: "같은 장소 중복 확인",
      now,
    },
  };
}

it("preserves immutable sources and forwards only a valid general projection with an audit mapping", async () => {
  const { db, prefix, now, source, target, input } = await mergeFixture();
  const sources = [
    "GENERAL",
    "REVIEWER",
    "LEGACY_REVIEWER",
    "INVALID",
  ] as const;
  for (const [index, kind] of sources.entries()) {
    const userId = `${prefix}-user-${index}`;
    const eventId = `${prefix}-event-${index}`;
    await db
      .insert(users)
      .values({
        id: userId,
        email: `${userId}@example.test`,
        displayName: "합성 회원",
        role: "USER",
        createdAt: now,
        updatedAt: now,
      });
    if (kind === "REVIEWER") {
      const category = await db.query.categories.findFirst();
      await env.DB.prepare(
        "INSERT INTO reviewer_visit_reviews(id,place_id,reviewer_user_id,category_id,evaluation,badges_json,photo_count,published_at,created_at,updated_at) VALUES(?,?,?,?,'RECOMMEND','[]',0,?,?,?)",
      )
        .bind(
          `${prefix}-unbound-review`,
          source,
          userId,
          category!.id,
          now,
          now,
          now,
        )
        .run();
    }
    await db
      .insert(voteEvents)
      .values({
        id: eventId,
        userId,
        placeId: source,
        value: 1,
        eventType: "CREATE",
        source: kind === "INVALID" ? "GENERAL" : kind,
        reviewId: kind === "REVIEWER" ? `${prefix}-unbound-review` : null,
        reviewVersion: kind === "REVIEWER" ? 1 : null,
        createdAt: now,
      });
    await db
      .insert(currentVotes)
      .values({ userId, placeId: source, value: 1, eventId, updatedAt: now });
  }
  await env.DB.prepare(
    "INSERT INTO integrity_cases(id,signal_type,subject_type,subject_id,dedupe_key,evidence_json,created_at,updated_at) VALUES(?,'SYNTHETIC','USER',?,?,'{}',?,?)",
  )
    .bind(prefix, `${prefix}-user-3`, prefix, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO invalidated_vote_events(vote_event_id,integrity_case_id,reason,invalidated_at) VALUES(?,?,'synthetic invalidation',?)",
  )
    .bind(`${prefix}-event-3`, prefix, now)
    .run();
  await mergePlaces(db, input);
  const events = await db.select().from(voteEvents);
  expect(events.filter((e) => e.placeId === source)).toHaveLength(4);
  const forwarded = events.filter((e) => e.placeId === target);
  expect(forwarded).toHaveLength(1);
  expect(forwarded[0]).toMatchObject({
    source: "GENERAL",
    previousEventId: `${prefix}-event-0`,
    reviewId: null,
  });
  expect(
    (await db.select().from(currentVotes))
      .filter((v) => v.placeId === target)
      .map((v) => v.userId),
  ).toEqual([`${prefix}-user-0`]);
  const audit = await env.DB.prepare(
    "SELECT after_state FROM admin_audit_logs WHERE target_id=? AND action='MERGE_PLACES'",
  )
    .bind(target)
    .first<{ after_state: string }>();
  expect(JSON.parse(audit!.after_state).voteForwards).toEqual([
    { sourceEventId: `${prefix}-event-0`, targetEventId: forwarded[0]!.id },
  ]);
  await expect(
    env.DB.prepare("UPDATE vote_events SET value=-1 WHERE id=?")
      .bind(`${prefix}-event-0`)
      .run(),
  ).rejects.toThrow("VOTE_EVENT_IMMUTABLE");
});

it("preserves a newer target choice and a source vote changed after the merge read", async () => {
  const { db, prefix, now, source, target, input } = await mergeFixture();
  const userId = `${prefix}-user`;
  await db
    .insert(users)
    .values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "합성 회원",
      role: "USER",
      createdAt: now,
      updatedAt: now,
    });
  const { castVote } = await import("../../app/features/ratings/vote.server");
  await castVote(db, {
    userId,
    placeId: source,
    value: 1,
    eventId: `${prefix}-old`,
    now,
  });
  const original = db.batch.bind(db);
  let intercept = true;
  const wrapped = new Proxy(db, {
    get(object, key) {
      if (key === "batch")
        return async (statements: Parameters<typeof db.batch>[0]) => {
          if (intercept) {
            intercept = false;
            await castVote(db, {
              userId,
              placeId: source,
              value: -1,
              eventId: `${prefix}-source-new`,
              now,
            });
            await castVote(db, {
              userId,
              placeId: target,
              value: 1,
              eventId: `${prefix}-target-new`,
              now,
            });
          }
          return original(statements);
        };
      return Reflect.get(object, key);
    },
  });
  await mergePlaces(wrapped, input);
  expect(
    await env.DB.prepare(
      "SELECT event_id FROM current_votes WHERE user_id=? AND place_id=?",
    )
      .bind(userId, target)
      .first(),
  ).toEqual({ event_id: `${prefix}-target-new` });
  expect(
    await env.DB.prepare(
      "SELECT event_id FROM current_votes WHERE user_id=? AND place_id=?",
    )
      .bind(userId, source)
      .first(),
  ).toEqual({ event_id: `${prefix}-source-new` });
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM vote_events WHERE previous_event_id=? AND place_id=?",
    )
      .bind(`${prefix}-old`, target)
      .first(),
  ).toEqual({ n: 0 });
});

it("rolls back all merge effects when its audit insert fails", async () => {
  const { db, prefix, now, source, target, input } = await mergeFixture();
  const userId = `${prefix}-user`;
  await db
    .insert(users)
    .values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "합성 회원",
      role: "USER",
      createdAt: now,
      updatedAt: now,
    });
  await db
    .insert(voteEvents)
    .values({
      id: prefix,
      userId,
      placeId: source,
      value: 1,
      eventType: "CREATE",
      source: "GENERAL",
      createdAt: now,
    });
  await db
    .insert(currentVotes)
    .values({
      eventId: prefix,
      userId,
      placeId: source,
      value: 1,
      updatedAt: now,
    });
  await db
    .insert(savedPlaces)
    .values({ userId, placeId: source, createdAt: now });
  await env.DB.exec(
    "CREATE TRIGGER fail_merge_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='MERGE_PLACES' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;",
  );
  try {
    await expect(mergePlaces(db, input)).rejects.toThrow();
  } finally {
    await env.DB.exec("DROP TRIGGER fail_merge_audit");
  }
  expect(
    await env.DB.prepare("SELECT status FROM places WHERE id=?")
      .bind(source)
      .first(),
  ).toEqual({ status: "PUBLISHED" });
  expect(
    await env.DB.prepare("SELECT place_id FROM current_votes WHERE event_id=?")
      .bind(prefix)
      .first(),
  ).toEqual({ place_id: source });
  expect(
    await env.DB.prepare("SELECT place_id FROM saved_places WHERE user_id=?")
      .bind(userId)
      .first(),
  ).toEqual({ place_id: source });
  expect(
    await env.DB.prepare("SELECT count(*) n FROM vote_events WHERE place_id=?")
      .bind(target)
      .first(),
  ).toEqual({ n: 0 });
});

it("keeps explicit canonical save choices, copies source choices, and deduplicates a full guest session", async () => {
  const { db, prefix, now, source, target, input } = await mergeFixture();
  for (const suffix of ["target-no", "target-yes", "source-no", "legacy"]) {
    const userId = `${prefix}-${suffix}`;
    await db
      .insert(users)
      .values({
        id: userId,
        email: `${userId}@example.test`,
        displayName: "합성 회원",
        role: "USER",
        createdAt: now,
        updatedAt: now,
      });
    await db
      .insert(savedPlaces)
      .values({ userId, placeId: source, createdAt: now });
  }
  await db
    .insert(savedPlaces)
    .values({ userId: `${prefix}-source-no`, placeId: target, createdAt: now });
  for (const [suffix, placeId, saved] of [
    ["target-no", target, 0],
    ["target-no", source, 1],
    ["target-yes", target, 1],
    ["target-yes", source, 0],
    ["source-no", source, 0],
  ] as const)
    await env.DB.prepare(
      "INSERT INTO member_save_choices(user_id,place_id,saved,updated_at) VALUES(?,?,?,?)",
    )
      .bind(`${prefix}-${suffix}`, placeId, saved, now)
      .run();
  await env.DB.prepare(
    "INSERT INTO guest_taste_sessions(id,expires_at,created_at,updated_at) VALUES(?,'2099-01-01',?,?)",
  )
    .bind(prefix, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO guest_saved_places(session_id,place_id,created_at) VALUES(?,?,?)",
  )
    .bind(prefix, source, now)
    .run();
  for (let index = 0; index < 49; index++) {
    const placeId = `${prefix}-extra-${index}`;
    await db
      .insert(places)
      .values({
        id: placeId,
        slug: placeId,
        name: "합성",
        status: "PUBLISHED",
        address: "합성",
        neighborhood: "합성",
        latitude: 35,
        longitude: 126,
        searchText: "합성",
        createdAt: now,
        updatedAt: now,
      });
    await env.DB.prepare(
      "INSERT INTO guest_saved_places(session_id,place_id,created_at) VALUES(?,?,?)",
    )
      .bind(prefix, placeId, now)
      .run();
  }
  await mergePlaces(db, input);
  expect(
    (
      await env.DB.prepare(
        "SELECT user_id FROM saved_places WHERE place_id=? ORDER BY user_id",
      )
        .bind(target)
        .all<{ user_id: string }>()
    ).results.map((r) => r.user_id),
  ).toEqual([`${prefix}-legacy`, `${prefix}-target-yes`].sort());
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM member_save_choices WHERE place_id=?",
    )
      .bind(source)
      .first(),
  ).toEqual({ n: 3 });
  expect(
    await env.DB.prepare(
      "SELECT saved FROM member_save_choices WHERE user_id=? AND place_id=?",
    )
      .bind(`${prefix}-source-no`, target)
      .first(),
  ).toEqual({ saved: 0 });
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM guest_saved_places WHERE session_id=?",
    )
      .bind(prefix)
      .first(),
  ).toEqual({ n: 50 });
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM guest_saved_places WHERE session_id=? AND place_id=?",
    )
      .bind(prefix, target)
      .first(),
  ).toEqual({ n: 1 });
});
