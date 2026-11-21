import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import {
  parsePlaceIntake,
  placeIntakeRegion,
  planPrivatePlaceDrafts,
  stagePrivatePlaceIntake,
} from "../../scripts/place-intake.mjs";

const candidate = {
  name: "합성 식당",
  address: "전북특별자치도 전주시 완산구 합성로 1",
  neighborhood: "완산구",
  latitude: 35.8,
  longitude: 127.1,
  categoryLabel: "한식",
  categorySlug: "korean-general",
  kind: "DINING",
  source: "SHARED_MAP",
  selection: "CANDIDATE",
  reason: null,
  note: null,
  photo: "NOT_SUPPLIED",
};

const intake = (...rows: object[]) => JSON.stringify({
  format: "retaste-place-intake-v1",
  label: "합성 반입",
  rows: rows.map((row, index) => ({ ...candidate, ...row, position: index + 1 })),
});

it("archives the whole collection but plans DRAFT only for Jeolla dining and cafés", async () => {
  const input = intake(
    {},
    { name: "경기 주소", address: "경기도 광주시 합성로 1" },
    { name: "광주 카페", address: "전남광주통합특별시 동구 합성로 1", kind: "CAFE", categorySlug: "cafe" },
    { name: "전남 시설", address: "전남광주통합특별시 영암군 군서면 합성로 1", kind: "OTHER" },
    { name: "주소 미확인", address: null, latitude: null, longitude: null, kind: "UNKNOWN" },
    { name: "전북 대조", address: "전라북도 전주시 완산구 합성로 1", kind: "BAR" },
  );
  expect(placeIntakeRegion("전남광주통합특별시")).toBe("UNKNOWN");
  expect(parsePlaceIntake(input).counts).toEqual({ candidate: 2, review: 2, hidden: 2 });
  expect(planPrivatePlaceDrafts(input).map(row => [row.name, row.status]))
    .toEqual([["합성 식당", "DRAFT"], ["광주 카페", "DRAFT"]]);
  const originalPlaces = await env.DB.prepare("SELECT count(*) AS count FROM places").first<number>("count");
  const first = await stagePrivatePlaceIntake(env.DB, input);
  expect(first).toMatchObject({ total: 6, candidate: 2, review: 2, hidden: 2, state: "STAGED_PRIVATE" });
  expect(await stagePrivatePlaceIntake(env.DB, input)).toMatchObject({ batchId: first.batchId, state: "EXISTING" });
  const stored = await env.DB.prepare(
    "SELECT count(*) AS count FROM place_intake_entries WHERE batch_id=? AND region_code='OUTSIDE' AND selection='HIDDEN'",
  ).bind(first.batchId).first<number>("count");
  expect(stored).toBe(1);
  expect(await env.DB.prepare("SELECT count(*) AS count FROM places").first<number>("count")).toBe(originalPlaces);
  await expect(env.DB.prepare("UPDATE place_intake_entries SET selection='CANDIDATE' WHERE batch_id=? AND position=2")
    .bind(first.batchId).run()).rejects.toThrow(/PLACE_INTAKE_ENTRY_IMMUTABLE/);
});

it("blocks incomplete archives and holds duplicate place identities", async () => {
  const id = "a".repeat(64);
  await env.DB.prepare("INSERT INTO place_intake_batches VALUES (?,'합성 누락',2,'STAGING','2026-11-21T00:00:00Z')")
    .bind(id).run();
  await expect(env.DB.prepare("UPDATE place_intake_batches SET state='READY' WHERE id=?")
    .bind(id).run()).rejects.toThrow(/PLACE_INTAKE_BATCH_INCOMPLETE/);
  expect(parsePlaceIntake(intake({}, { name: "합성식당" })).counts)
    .toEqual({ candidate: 0, review: 2, hidden: 0 });
  await expect(stagePrivatePlaceIntake(env.DB, intake({ categorySlug: "missing-category" })))
    .rejects.toThrow(/PLACE_INTAKE_CATEGORY_UNKNOWN/);

  const mismatched = intake({ name: "기대 내용" });
  const batch = parsePlaceIntake(mismatched);
  const now = "2026-11-21T00:00:00Z";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO place_intake_batches VALUES (?,?,1,'STAGING',?)").bind(batch.id, batch.label, now),
    env.DB.prepare(`INSERT INTO place_intake_entries
      (batch_id,position,name,kind,source,region_code,selection,photo)
      VALUES (?,1,'잘못 저장된 내용','OTHER','SHARED_MAP','UNKNOWN','HIDDEN','NOT_SUPPLIED')`).bind(batch.id),
    env.DB.prepare("UPDATE place_intake_batches SET state='READY' WHERE id=?").bind(batch.id),
  ]);
  await expect(stagePrivatePlaceIntake(env.DB, mismatched)).rejects.toThrow(/PLACE_INTAKE_CONTENT_MISMATCH/);
});
