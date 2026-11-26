import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

const now = "2026-11-26T02:00:00.000Z";
const name = "합성 카페";
const address = "광주 동구 합성길 1";
const hash = "a".repeat(64);

type MediaState = "STAGED" | "PUBLISHED" | "WITHDRAWN";

async function seedPlace(states: MediaState[]) {
  const placeId = crypto.randomUUID();
  const photos = states.map((state) => ({ id: crypto.randomUUID(), state }));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO places (
      id, slug, name, status, address, neighborhood, latitude, longitude, search_text, created_at, updated_at
    ) VALUES (?, ?, ?, 'PUBLISHED', ?, '동구', 35.1, 126.9, ?, ?, ?)`)
      .bind(placeId, placeId, name, address, name, now, now),
    ...photos.map(({ id, state }) => env.DB.prepare(`INSERT INTO place_poi_media (
      id, place_id, state, source_url, attribution, rights_basis, rights_evidence, sha256, byte_size, content_type, reviewed_at
    ) VALUES (?, ?, ?, 'https://example.com/reviewed-photo', '합성 제공자', 'OWN_WORK', 'private evidence', ?, 8, 'image/jpeg', ?)`)
      .bind(id, placeId, state, hash, now)),
  ]);
  return { placeId, photos };
}

async function readPhotos(placeId: string) {
  return (await env.DB.prepare("SELECT * FROM place_poi_media WHERE place_id = ? ORDER BY id")
    .bind(placeId).all<{ id: string; state: MediaState }>()).results;
}

async function readAudit(photoId: string) {
  return (await env.DB.prepare(`SELECT actor_user_id, target_type, before_state, after_state, created_at
    FROM admin_audit_logs WHERE action = 'POI_MEDIA_IDENTITY_WITHDRAWN' AND target_id = ?`)
    .bind(photoId).all<{
      actor_user_id: string | null; target_type: string; before_state: string; after_state: string; created_at: string;
    }>()).results;
}

it.each([
  { nextName: "새 합성 카페", nextAddress: address, nameChanged: true, addressChanged: false },
  { nextName: name, nextAddress: "광주 동구 합성길 2", nameChanged: false, addressChanged: true },
])("withdraws the old identity's photos when nameChanged=$nameChanged and addressChanged=$addressChanged", async ({
  nextName, nextAddress, nameChanged, addressChanged,
}) => {
  const { placeId, photos } = await seedPlace(["STAGED", "PUBLISHED", "WITHDRAWN"]);
  const { placeId: otherPlace } = await seedPlace(["PUBLISHED"]);
  const before = await readPhotos(placeId);
  const otherPhotos = await readPhotos(otherPlace);

  await env.DB.prepare("UPDATE places SET name = ?, address = ? WHERE id = ?")
    .bind(nextName, nextAddress, placeId).run();
  expect(await readPhotos(placeId)).toEqual(before.map((row) => ({ ...row, state: "WITHDRAWN" })));
  expect(await readPhotos(otherPlace)).toEqual(otherPhotos);

  // Reverting the place identity must neither re-enable the assets nor log them again.
  await env.DB.prepare("UPDATE places SET name = ?, address = ? WHERE id = ?").bind(name, address, placeId).run();
  for (const photo of photos) {
    const audits = await readAudit(photo.id);
    if (photo.state === "WITHDRAWN") {
      expect(audits).toEqual([]);
      continue;
    }
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    expect(audit.actor_user_id).toBeNull();
    expect(audit.target_type).toBe("PLACE_POI_MEDIA");
    expect(JSON.parse(audit.before_state)).toEqual({ state: photo.state });
    expect(JSON.parse(audit.after_state)).toEqual({
      state: "WITHDRAWN", cause: "PLACE_IDENTITY_CHANGED", nameChanged, addressChanged,
    });
    expect(new Date(audit.created_at).toISOString()).toEqual(audit.created_at);
  }
  expect(await readPhotos(placeId)).toEqual(before.map((row) => ({ ...row, state: "WITHDRAWN" })));
});

it("preserves staged and published assets on same-value and unrelated edits", async () => {
  const { placeId, photos } = await seedPlace(["STAGED", "PUBLISHED"]);
  const before = await readPhotos(placeId);
  await env.DB.prepare("UPDATE places SET name = name, address = address, phone = ? WHERE id = ?")
    .bind("062-000-0000", placeId).run();
  await env.DB.prepare("UPDATE places SET updated_at = ? WHERE id = ?")
    .bind("2026-11-26T03:00:00.000Z", placeId).run();
  expect(await readPhotos(placeId)).toEqual(before);
  for (const { id } of photos) expect(await readAudit(id)).toEqual([]);
});

it("rolls back the place identity and photo state together when audit insertion fails", async () => {
  const { placeId } = await seedPlace(["STAGED", "PUBLISHED"]);
  const before = await readPhotos(placeId);
  await env.DB.prepare(`CREATE TRIGGER test_poi_identity_audit_failure BEFORE INSERT ON admin_audit_logs
    WHEN NEW.action = 'POI_MEDIA_IDENTITY_WITHDRAWN'
    BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_AUDIT_FAILURE'); END`).run();
  try {
    await expect(env.DB.prepare("UPDATE places SET address = ? WHERE id = ?")
      .bind("광주 동구 합성길 2", placeId).run()).rejects.toThrow("SYNTHETIC_AUDIT_FAILURE");
    expect(await env.DB.prepare("SELECT address FROM places WHERE id = ?").bind(placeId).first("address")).toBe(address);
    expect(await readPhotos(placeId)).toEqual(before);
    for (const { id } of before) expect(await readAudit(id)).toEqual([]);
  } finally {
    await env.DB.prepare("DROP TRIGGER test_poi_identity_audit_failure").run();
  }
});
