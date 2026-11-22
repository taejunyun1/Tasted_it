import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../app/db/client.server";
import { recommendParkingForCourse } from "../../app/features/parking/parking-recommendation.server";

describe("parking recommendation service", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM parking_ev_links").run();
    await env.DB.prepare("DELETE FROM parking_facilities").run();
    await env.DB.prepare("DELETE FROM parking_data_snapshots").run();
  });

  it("returns a safe unavailable result without an active snapshot", async () => {
    const result = await recommendParkingForCourse(createDb(env.DB), {
      first: { id: "a", latitude: 35.15, longitude: 126.85 }, second: { id: "b", latitude: 35.155, longitude: 126.85 },
      startsAt: "2026-08-10T12:00:00+09:00", firstStayMinutes: 60, secondStayMinutes: 60,
      weather: "NORMAL", childAccompanied: false, evRequirement: "NONE", parkingMode: "auto",
    });
    expect(result).toMatchObject({ algorithmVersion: "parking-course-v1", status: "PARKING_DATA_UNAVAILABLE" });
  });

  it("ranks an eligible active facility and returns snapshot metadata", async () => {
    await env.DB.prepare("INSERT INTO parking_data_snapshots (id, source, status, row_count, source_reference_date_min, source_reference_date_max, activated_at, created_at, updated_at) VALUES ('active-rec', 'PARKING', 'ACTIVE', 1, '2026-07-01', '2026-07-01', '2026-07-02', '2026-07-01', '2026-07-02')").run();
    await env.DB.prepare(`INSERT INTO parking_facilities
      (id, snapshot_id, source_management_no, name, ownership_type, facility_type, road_address, region_code, latitude, longitude, capacity,
       weekday_open, weekday_close, saturday_open, saturday_close, holiday_open, holiday_close, fee_status, base_minutes, base_fee, additional_minutes, additional_fee,
       public_access_status, reliability_grade, reference_date, raw_payload, created_at, updated_at)
       VALUES ('lot-rec', 'active-rec', 'lot-rec', '테스트 공영주차장', 'PUBLIC', 'OFF_STREET', '광주광역시 동구', 'GWANGJU', 35.152, 126.85, 100,
       '00:00', '23:59', '00:00', '23:59', '00:00', '23:59', 'PAID', 30, 1000, 10, 500,
       'PUBLIC', 'A', '2026-07-01', '{}', '2026-07-01', '2026-07-01')`).run();
    const result = await recommendParkingForCourse(createDb(env.DB), {
      first: { id: "a", latitude: 35.15, longitude: 126.85 }, second: { id: "b", latitude: 35.154, longitude: 126.85 },
      startsAt: "2026-08-10T12:00:00+09:00", firstStayMinutes: 60, secondStayMinutes: 60,
      weather: "NORMAL", childAccompanied: false, evRequirement: "NONE", parkingMode: "auto",
    });
    expect(result.status).toBe("READY");
    expect(result.snapshot).toMatchObject({ id: "active-rec" });
    expect(result.shared?.parking.id).toBe("lot-rec");
  });

  it("honors a user-selected separate-parking preference when a plan exists", async () => {
    await env.DB.prepare("INSERT INTO parking_data_snapshots (id, source, status, row_count, activated_at, created_at, updated_at) VALUES ('active-mode', 'PARKING', 'ACTIVE', 1, '2026-08-01', '2026-08-01', '2026-08-01')").run();
    await env.DB.prepare(`INSERT INTO parking_facilities
      (id, snapshot_id, source_management_no, name, ownership_type, facility_type, region_code, latitude, longitude, weekday_open, weekday_close, saturday_open, saturday_close, holiday_open, holiday_close, fee_status, public_access_status, reliability_grade, reference_date, raw_payload, created_at, updated_at)
      VALUES ('lot-mode', 'active-mode', 'lot-mode', '조건 주차장', 'PUBLIC', 'OFF_STREET', 'GWANGJU', 35.152, 126.85, '00:00', '23:59', '00:00', '23:59', '00:00', '23:59', 'FREE', 'PUBLIC', 'A', '2026-08-01', '{}', '2026-08-01', '2026-08-01')`).run();
    const result = await recommendParkingForCourse(createDb(env.DB), {
      first: { id: "a", latitude: 35.15, longitude: 126.85 }, second: { id: "b", latitude: 35.154, longitude: 126.85 },
      startsAt: "2026-08-10T12:00:00+09:00", firstStayMinutes: 60, secondStayMinutes: 60,
      weather: "NORMAL", childAccompanied: false, evRequirement: "NONE", parkingMode: "separate",
    });
    expect(result.recommendedMode).toBe("SEPARATE");
  });

  it("requires source evidence for legacy all-midnight schedules and rejects unconfirmed endpoints", async () => {
    const timestamp = "2026-11-01T00:00:00.000Z";
    await env.DB.prepare(`INSERT INTO parking_data_snapshots
      (id, source, status, row_count, activated_at, created_at, updated_at)
      VALUES ('hours-active', 'PARKING', 'ACTIVE', 3, ?, ?, ?)`).bind(timestamp, timestamp, timestamp).run();
    const insert = env.DB.prepare(`INSERT INTO parking_facilities
      (id, snapshot_id, source_management_no, name, ownership_type, facility_type, region_code, latitude, longitude,
       weekday_open, weekday_close, fee_status, public_access_status, reliability_grade, reference_date, raw_payload, created_at, updated_at)
      VALUES (?, 'hours-active', ?, '합성 주차장', 'PUBLIC', 'OFF_STREET', 'GWANGJU', 35.15, 126.85,
       '00:00', ?, 'FREE', 'PUBLIC', 'A', '2026-11-01', ?, ?, ?)`);
    for (const [id, close, source] of [
      ["missing-hours", "00:00", { prkplceNo: "missing-hours", weekdayOperColseHhmm: "미확인" }],
      ["without-source", "00:00", {}],
      ["missing-opening", "22:00", { prkplceNo: "missing-opening", weekdayOperColseHhmm: "2200" }],
    ] as const) {
      await insert.bind(id, id, close, JSON.stringify(source), timestamp, timestamp).run();
    }
    const db = createDb(env.DB);
    const input = {
      first: { id: "meal", latitude: 35.15, longitude: 126.85 },
      second: { id: "cafe", latitude: 35.151, longitude: 126.85 },
      startsAt: "2026-11-23T12:00:00+09:00", firstStayMinutes: 60, secondStayMinutes: 60,
      weather: "NORMAL", childAccompanied: false, evRequirement: "NONE", parkingMode: "auto",
    } satisfies Parameters<typeof recommendParkingForCourse>[1];
    expect(await recommendParkingForCourse(db, input)).toMatchObject({
      status: "NO_ELIGIBLE_PARKING", shared: null, separate: null,
    });

    const proven = { prkplceNo: "without-source", weekdayOperOpenHhmm: 0, weekdayOperColseHhmm: "0000" };
    await env.DB.prepare("UPDATE parking_facilities SET raw_payload=? WHERE id='without-source'").bind(JSON.stringify(proven)).run();
    expect(await recommendParkingForCourse(db, input)).toMatchObject({
      status: "READY", shared: { parking: { id: "without-source" } },
    });
  });
});
