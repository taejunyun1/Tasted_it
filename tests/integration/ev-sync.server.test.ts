import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../../app/db/client.server";
import { syncEvDataSnapshot } from "../../app/features/parking/ev-sync.server";

describe("EV public-data snapshot sync", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM parking_ev_links").run();
    await env.DB.prepare("DELETE FROM ev_charging_stations").run();
    await env.DB.prepare("DELETE FROM parking_facilities").run();
    await env.DB.prepare("DELETE FROM parking_sync_runs").run();
    await env.DB.prepare("DELETE FROM parking_data_snapshots").run();
    const now = "2026-08-08T00:00:00.000Z";
    await env.DB.prepare("INSERT INTO parking_data_snapshots (id, source, status, row_count, activated_at, created_at, updated_at) VALUES ('parking-active', 'PARKING', 'ACTIVE', 1, ?, ?, ?)").bind(now, now, now).run();
    await env.DB.prepare(`INSERT INTO parking_facilities
      (id, snapshot_id, source_management_no, name, ownership_type, facility_type, road_address, region_code, latitude, longitude, capacity, fee_status, public_access_status, reliability_grade, reference_date, raw_payload, created_at, updated_at)
      VALUES ('parking-lot', 'parking-active', 'lot-1', '동명동 공영주차장', 'PUBLIC', 'OFF_STREET', '광주광역시 동구 동명로 12', 'GWANGJU', 35.15, 126.85, 80, 'PAID', 'PUBLIC', 'A', '2026-07-01', '{}', ?, ?)`).bind(now, now).run();
  });

  it("activates a complete EV snapshot and confirms only evidence-backed onsite links", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const region = new URL(String(input)).searchParams.get("zcode");
      const item = region === "29" ? [{ statId: "EV-1", statNm: "동명동 공영주차장 충전소", addr: "광주광역시 동구 동명로 12", lat: "35.1501", lng: "126.8501", chgerType: "04", delYn: "N", statUpdDt: "20260701" }] : [];
      return new Response(JSON.stringify({ items: { item }, totalCount: item.length }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await syncEvDataSnapshot(createDb(env.DB), { serviceKey: "test-key", fetcher: fetcher as typeof fetch, now: "2026-08-08T00:00:00.000Z" });

    expect(result).toMatchObject({ completed: true, accepted: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await env.DB.prepare("SELECT status, row_count FROM parking_data_snapshots WHERE source='EV'").first())).toMatchObject({ status: "ACTIVE", row_count: 1 });
    expect((await env.DB.prepare("SELECT relationship FROM parking_ev_links").first())).toMatchObject({ relationship: "ONSITE_CONFIRMED" });
  });
});
