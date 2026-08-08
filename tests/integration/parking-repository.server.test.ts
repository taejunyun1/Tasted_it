import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { getActiveParkingSnapshot, listEligibleParking } from "../../app/features/parking/parking-repository.server";

describe("parking repository", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM parking_ev_links").run();
    await env.DB.prepare("DELETE FROM ev_charging_stations").run();
    await env.DB.prepare("DELETE FROM parking_facilities").run();
    await env.DB.prepare("DELETE FROM parking_data_snapshots").run();
    await env.DB.prepare(`INSERT INTO parking_data_snapshots (id, source, status, row_count, source_reference_date_min, source_reference_date_max, activated_at, created_at, updated_at) VALUES
      ('old', 'PARKING', 'RETIRED', 1, '2025-01-01', '2025-01-01', '2025-01-02', '2025-01-01', '2025-01-02'),
      ('active', 'PARKING', 'ACTIVE', 1, '2026-07-01', '2026-07-01', '2026-07-02', '2026-07-01', '2026-07-02')`).run();
    const insert = `INSERT INTO parking_facilities
      (id, snapshot_id, source_management_no, name, ownership_type, facility_type, road_address, lot_address, region_code, latitude, longitude, capacity, fee_status, public_access_status, reliability_grade, reference_date, raw_payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'PUBLIC', 'OFF_STREET', '광주광역시 동구', NULL, 'GWANGJU', 35.15, 126.85, 100, 'PAID', 'PUBLIC', ?, '2026-07-01', '{}', '2026-07-01', '2026-07-01')`;
    await env.DB.prepare(insert).bind("old-lot", "old", "old-no", "옛 주차장", "A").run();
    await env.DB.prepare(insert).bind("active-lot", "active", "active-no", "활성 주차장", "B").run();
  });

  it("returns active A/B facilities inside the bounding box", async () => {
    const db = createDb(env.DB);
    expect(await getActiveParkingSnapshot(db, "PARKING")).toMatchObject({ id: "active" });
    const rows = await listEligibleParking(db, { west: 126.8, south: 35.1, east: 126.9, north: 35.2 });
    expect(rows.map((row) => row.id)).toEqual(["active-lot"]);
    expect(rows[0]?.reliabilityGrade).toBe("B");
    expect(rows[0]?.hasOnsiteEv).toBe(false);
  });

  it("uses onsite EV only from the active EV snapshot", async () => {
    await env.DB.prepare(`INSERT INTO parking_data_snapshots (id, source, status, row_count, created_at, updated_at) VALUES
      ('ev-retired', 'EV', 'RETIRED', 1, '2026-07-01', '2026-07-01'),
      ('ev-active', 'EV', 'ACTIVE', 1, '2026-08-01', '2026-08-01')`).run();
    await env.DB.prepare(`INSERT INTO ev_charging_stations (id, snapshot_id, source_station_id, name, latitude, longitude, fast_charger_count, slow_charger_count, is_deleted, reference_date, raw_payload, created_at, updated_at) VALUES
      ('old-ev', 'ev-retired', 'old', '이전 충전소', 35.15, 126.85, 1, 0, 0, '2026-07-01', '{}', '2026-07-01', '2026-07-01'),
      ('new-ev', 'ev-active', 'new', '현재 충전소', 35.15, 126.85, 1, 0, 0, '2026-08-01', '{}', '2026-08-01', '2026-08-01')`).run();
    await env.DB.prepare("INSERT INTO parking_ev_links (parking_facility_id, ev_station_id, relationship, match_method, confidence, created_at) VALUES ('active-lot', 'old-ev', 'ONSITE_CONFIRMED', 'test', 1, '2026-07-01'), ('active-lot', 'new-ev', 'ONSITE_CONFIRMED', 'test', 1, '2026-08-01')").run();

    const rows = await listEligibleParking(createDb(env.DB), { west: 126.8, south: 35.1, east: 126.9, north: 35.2 });
    expect(rows[0]?.hasOnsiteEv).toBe(true);
  });
});
