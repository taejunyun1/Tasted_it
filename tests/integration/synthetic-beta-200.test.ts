import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDb } from "../../app/db/client.server";
import { WITHDRAW_CONFIRM_PHRASE, withdrawnEmailFor } from "../../app/features/auth/withdraw";
import { getPlaceFlavorPrint } from "../../app/features/ratings/flavor-print.server";
import { withdrawVote } from "../../app/features/ratings/vote.server";
import { loader as homeLoader } from "../../app/routes/home";
import { loader as homeRecommendationsLoader } from "../../app/routes/home-recommendations-resource";
import { action as loginAction } from "../../app/routes/login";
import { loader as mapCategoryLoader } from "../../app/routes/map-category";
import { action as meAction } from "../../app/routes/me";
import { loader as placeListLoader } from "../../app/routes/place-list";
import { action as placeDetailAction, loader as placeDetailLoader } from "../../app/routes/place-detail";
import { action as placeSuggestAction } from "../../app/routes/place-suggest";
import { loader as reviewerProfileLoader } from "../../app/routes/reviewer-profile";
import { loader as reviewerRatingsLoader } from "../../app/routes/reviewer-ratings";
import { action as signupAction } from "../../app/routes/signup";

const NOW = "2026-08-18T00:00:00.000Z";
const ORIGIN = "https://retaste.test";
const ABUSE_IP = "203.0.113.88";
const SLUG_A = "synth-beta-gukbap-a";
const SLUG_B = "synth-beta-ramen-b";
const PLACE_A = "synth-place-gukbap";
const PLACE_B = "synth-place-ramen";
const HOME_RECS = `${ORIGIN}/resources/home-recommendations?mode=now&requestToken=synthview01&bbox=126.72,35.03,127.02,35.25`;
const DIM = '{"국물 농도":4,"감칠맛":4,"면 식감":3,"향신료":2,"양":4}';

type StatusBucket = { total: number; s5xx: number; mailStub503: number; s429: number };

function pad(n: number) {
  return String(n).padStart(3, "0");
}

function statusOf(result: unknown): number {
  if (result instanceof Response) return result.status;
  if (result && typeof result === "object" && "init" in result) {
    const init = (result as { init?: { status?: number } }).init;
    if (typeof init?.status === "number") return init.status;
  }
  return 200;
}

async function invoke(run: () => Promise<unknown>, bucket: StatusBucket): Promise<{ status: number; result: unknown }> {
  try {
    const result = await run();
    const status = statusOf(result);
    bucket.total += 1;
    if (status === 429) bucket.s429 += 1;
    if (status >= 500) {
      const message = JSON.stringify(result);
      if (status === 503 && message.includes("이메일 발송 설정이 필요합니다")) bucket.mailStub503 += 1;
      else bucket.s5xx += 1;
    }
    return { status, result };
  } catch (error) {
    if (error instanceof Response) {
      bucket.total += 1;
      if (error.status === 429) bucket.s429 += 1;
      if (error.status >= 500) bucket.s5xx += 1;
      return { status: error.status, result: error };
    }
    throw error;
  }
}

function getRequest(path: string, ip: string, cookie?: string) {
  const headers: Record<string, string> = { "CF-Connecting-IP": ip };
  if (cookie) headers.Cookie = `retaste_session=${cookie}`;
  return new Request(`${ORIGIN}${path}`, { headers });
}

function formRequest(path: string, fields: Record<string, string>, ip: string, cookie?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "CF-Connecting-IP": ip,
    Origin: ORIGIN,
  };
  if (cookie) headers.Cookie = `retaste_session=${cookie}`;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: new URLSearchParams(fields) });
}

function memberIp(n: number) {
  return `198.51.101.${n}`;
}

function guestIp(n: number) {
  return `198.51.100.${n}`;
}

function viewerIp(n: number) {
  return `198.51.102.${n}`;
}

async function seedSyntheticBeta() {
  const statements = [
    env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES ('synth-admin-1','synth-admin@example.test','합성 관리자','ADMIN',?,?,?)").bind(NOW, NOW, NOW),
    env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES ('synth-reviewer-1','synth-reviewer-1@example.test','합성 리뷰어 1','REVIEWER',?,?,?)").bind(NOW, NOW, NOW),
    env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES ('synth-reviewer-2','synth-reviewer-2@example.test','합성 리뷰어 2','REVIEWER',?,?,?)").bind(NOW, NOW, NOW),
    env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES ('synth-reviewer-3','synth-reviewer-3@example.test','합성 리뷰어 3','REVIEWER',?,?,?)").bind(NOW, NOW, NOW),
    env.DB.prepare("INSERT OR IGNORE INTO sessions (id,user_id,expires_at,created_at) VALUES ('synth-admin-session','synth-admin-1','2027-08-18T00:00:00Z',?)").bind(NOW),
    env.DB.prepare("INSERT OR IGNORE INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES ('synth-place-gukbap','synth-beta-gukbap-a','합성 베타 국밥 A','PUBLISHED','광주광역시 북구 용봉로 1 (용봉동)','용봉동',35.176,126.911,'합성 베타 국밥',?,?)").bind(NOW, NOW),
    env.DB.prepare("INSERT OR IGNORE INTO places (id,slug,name,status,address,neighborhood,latitude,longitude,search_text,created_at,updated_at) VALUES ('synth-place-ramen','synth-beta-ramen-b','합성 베타 라멘 B','PUBLISHED','광주광역시 동구 동명로 2 (동명동)','동명동',35.149,126.923,'합성 베타 라멘',?,?)").bind(NOW, NOW),
    env.DB.prepare("INSERT OR IGNORE INTO place_categories (place_id,category_id,is_primary) VALUES ('synth-place-gukbap','cat-gukbap',1)"),
    env.DB.prepare("INSERT OR IGNORE INTO place_categories (place_id,category_id,is_primary) VALUES ('synth-place-ramen','cat-ramen',1)"),
    env.DB.prepare("INSERT OR IGNORE INTO reviewer_profiles (user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,approved_by,created_at,updated_at) VALUES ('synth-reviewer-1','synth-reviewer-gukmul','ACTIVE','합성 기록','국물','GWANGJU','[\"korean\"]',?,?, 'synth-admin-1',?,?)").bind(NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT OR IGNORE INTO reviewer_profiles (user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,approved_by,created_at,updated_at) VALUES ('synth-reviewer-2','synth-reviewer-myun','ACTIVE','합성 기록','면','GWANGJU','[\"japanese\"]',?,?, 'synth-admin-1',?,?)").bind(NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT OR IGNORE INTO reviewer_profiles (user_id,slug,status,occupation,taste_direction,region_code,specialty_slugs,last_activity_at,approved_at,approved_by,created_at,updated_at) VALUES ('synth-reviewer-3','synth-reviewer-yang','ACTIVE','합성 기록','양','GWANGJU','[\"korean\"]',?,?, 'synth-admin-1',?,?)").bind(NOW, NOW, NOW, NOW),
    env.DB.prepare("INSERT OR IGNORE INTO flavor_templates (id,category_id,version,dimensions_json,status,approved_by,approved_at,created_at,updated_at) VALUES ('synth-flavor-gukbap-v1','cat-gukbap','v1','[\"국물 농도\",\"감칠맛\",\"면 식감\",\"향신료\",\"양\"]','ACTIVE','synth-admin-1',?,?,?)").bind(NOW, NOW, NOW),
    env.DB.prepare("INSERT OR IGNORE INTO flavor_templates (id,category_id,version,dimensions_json,status,approved_by,approved_at,created_at,updated_at) VALUES ('synth-flavor-ramen-v1','cat-ramen','v1','[\"국물 농도\",\"감칠맛\",\"면 식감\",\"향신료\",\"양\"]','ACTIVE','synth-admin-1',?,?,?)").bind(NOW, NOW, NOW),
  ];
  for (let n = 1; n <= 80; n += 1) {
    const id = `synth-${pad(n)}`;
    statements.push(
      env.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,role,email_verified_at,created_at,updated_at) VALUES (?,?,?,'USER',?,?,?)")
        .bind(id, `synth+${pad(n)}@example.test`, `합성테스터 ${pad(n)}`, NOW, NOW, NOW),
      env.DB.prepare("INSERT OR IGNORE INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?, '2027-08-18T00:00:00Z', ?)")
        .bind(`synth-session-${pad(n)}`, id, NOW),
    );
  }
  const flavorRows = [
    ["synth-fr-g1", PLACE_A, "synth-reviewer-1", "synth-flavor-gukbap-v1"],
    ["synth-fr-g2", PLACE_A, "synth-reviewer-2", "synth-flavor-gukbap-v1"],
    ["synth-fr-g3", PLACE_A, "synth-reviewer-3", "synth-flavor-gukbap-v1"],
    ["synth-fr-r1", PLACE_B, "synth-reviewer-1", "synth-flavor-ramen-v1"],
    ["synth-fr-r2", PLACE_B, "synth-reviewer-2", "synth-flavor-ramen-v1"],
    ["synth-fr-r3", PLACE_B, "synth-reviewer-3", "synth-flavor-ramen-v1"],
  ] as const;
  for (const [id, placeId, reviewerId, templateId] of flavorRows) {
    statements.push(
      env.DB.prepare("INSERT OR IGNORE INTO flavor_ratings (id,place_id,reviewer_user_id,template_id,values_json,confidence,status,created_at,updated_at) VALUES (?,?,?,?,?,'HIGH','ACTIVE',?,?)")
        .bind(id, placeId, reviewerId, templateId, DIM, NOW, NOW),
    );
  }
  for (let index = 0; index < statements.length; index += 40) {
    await env.DB.batch(statements.slice(index, index + 40));
  }
}

async function countTable(table: "current_votes" | "place_suggestions") {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

describe("isolated synthetic beta 200 testers + 100 viewers", () => {
  it("keeps tester invariants, viewer mutations at 0, abuse 429, and print/score observations", { timeout: 180_000 }, async () => {
    await seedSyntheticBeta();
    const bucket: StatusBucket = { total: 0, s5xx: 0, mailStub503: 0, s429: 0 };
    const db = createDb(env.DB);

    const printBeforeA = await getPlaceFlavorPrint(db, PLACE_A);
    const printBeforeB = await getPlaceFlavorPrint(db, PLACE_B);
    expect(printBeforeA).toMatchObject({ status: "VISIBLE", ratingCount: 3 });
    expect(printBeforeB).toMatchObject({ status: "VISIBLE", ratingCount: 3 });

    const beforeVotes = await invoke(() => placeDetailLoader({
      request: getRequest(`/places/${SLUG_A}`, viewerIp(1)),
      params: { placeSlug: SLUG_A },
    } as never), bucket);
    const beforeRating = (beforeVotes.result as { rating: { overallSampleCount: number; overallScore: number | null } }).rating;
    expect(beforeRating.overallSampleCount).toBe(0);

    for (let n = 1; n <= 40; n += 1) {
      const ip = viewerIp(n);
      await invoke(() => homeLoader({ request: getRequest("/", ip) } as never), bucket);
      await invoke(() => placeDetailLoader({
        request: getRequest(`/places/${SLUG_A}`, ip),
        params: { placeSlug: SLUG_A },
      } as never), bucket);
      await invoke(() => homeRecommendationsLoader({ request: new Request(HOME_RECS, { headers: { "CF-Connecting-IP": ip } }) } as never), bucket);
    }

    for (let n = 1; n <= 120; n += 1) {
      const ip = guestIp(n);
      if (n <= 30) await invoke(() => homeLoader({ request: getRequest("/", ip) } as never), bucket);
      await invoke(() => placeListLoader({ request: getRequest("/places", ip) } as never), bucket);
      await invoke(() => placeDetailLoader({
        request: getRequest(`/places/${n % 2 === 0 ? SLUG_B : SLUG_A}`, ip),
        params: { placeSlug: n % 2 === 0 ? SLUG_B : SLUG_A },
      } as never), bucket);
      if (n <= 30) {
        await invoke(() => placeDetailLoader({
          request: getRequest(`/places/${SLUG_B}`, ip),
          params: { placeSlug: SLUG_B },
        } as never), bucket);
      }
    }

    for (let n = 1; n <= 50; n += 1) {
      const cookie = `synth-session-${pad(n)}`;
      const ip = memberIp(n);
      const value = n <= 45 ? "1" : "-1";
      const fieldsA: Record<string, string> = { intent: "vote", value };
      if (value === "-1") fieldsA.reason = "MENU";
      await invoke(() => placeDetailAction({
        request: formRequest(`/places/${SLUG_A}`, fieldsA, ip, cookie),
        params: { placeSlug: SLUG_A },
      } as never), bucket);
      await invoke(() => placeDetailAction({
        request: formRequest(`/places/${SLUG_B}`, { intent: "vote", value: "1" }, ip, cookie),
        params: { placeSlug: SLUG_B },
      } as never), bucket);
      if (n <= 20) {
        await invoke(() => placeDetailAction({
          request: formRequest(`/places/${SLUG_A}`, { intent: "save", saved: "true" }, ip, cookie),
          params: { placeSlug: SLUG_A },
        } as never), bucket);
      }
    }

    for (let n = 46; n <= 50; n += 1) {
      await withdrawVote(db, {
        placeId: PLACE_B,
        userId: `synth-${pad(n)}`,
        now: NOW,
        eventId: crypto.randomUUID(),
      });
    }

    const duplicate = {
      name: "합성 베타 국밥 A",
      address: "광주광역시 북구 용봉로 1 (용봉동)",
      originLatitude: "35.176",
      originLongitude: "126.911",
      latitude: "35.176",
      longitude: "126.911",
      locationConfirmed: "true",
      neighborhood: "용봉동",
      categoryId: "cat-gukbap",
    };
    const inRegion = {
      originLatitude: "35.146",
      originLongitude: "126.923",
      latitude: "35.146",
      longitude: "126.923",
      locationConfirmed: "true",
      neighborhood: "서석동",
      categoryId: "cat-gukbap",
      address: "광주광역시 동구 서석로 1 (서석동)",
    };
    const outOfRegion = {
      name: "범위 밖 제안",
      address: "서울특별시 중구 세종대로 110",
      originLatitude: "37.566",
      originLongitude: "126.978",
      latitude: "37.566",
      longitude: "126.978",
      locationConfirmed: "true",
      neighborhood: "명동",
      categoryId: "cat-gukbap",
    };

    for (let n = 51; n <= 66; n += 1) {
      const cookie = `synth-session-${pad(n)}`;
      const ip = memberIp(n);
      if (n <= 60) {
        const posted = await invoke(() => placeSuggestAction({
          request: formRequest("/suggestions/new", { ...inRegion, name: `합성 제안 ${pad(n)}` }, ip, cookie),
        } as never), bucket);
        expect(posted.status).toBe(200);
      } else if (n <= 63) {
        const posted = await invoke(() => placeSuggestAction({
          request: formRequest("/suggestions/new", outOfRegion, ip, cookie),
        } as never), bucket);
        expect(posted.status).toBe(400);
      } else {
        const missing = await invoke(() => placeSuggestAction({
          request: formRequest("/suggestions/new", duplicate, ip, cookie),
        } as never), bucket);
        expect(missing.status).toBe(400);
        const withReason = await invoke(() => placeSuggestAction({
          request: formRequest("/suggestions/new", { ...duplicate, duplicateOverrideReason: "별도 영업 합성 픽스처" }, ip, cookie),
        } as never), bucket);
        expect(withReason.status).toBe(200);
      }
    }

    const unauth = await invoke(() => placeSuggestAction({
      request: formRequest("/suggestions/new", { ...inRegion, name: "미인증 제안" }, guestIp(1)),
    } as never), bucket);
    expect(unauth.status).toBe(302);

    for (let n = 67; n <= 68; n += 1) {
      const age = await invoke(() => signupAction({
        request: formRequest("/signup", {
          displayName: "미성년",
          email: `under14-${pad(n)}@example.test`,
          password: "synthetic-pass-1",
        }, memberIp(n)),
      } as never), bucket);
      expect(age.status).toBe(400);
    }

    for (let n = 69; n <= 70; n += 1) {
      const withdrawn = await invoke(() => meAction({
        request: formRequest("/me", { intent: "withdraw", confirm: WITHDRAW_CONFIRM_PHRASE }, memberIp(n), `synth-session-${pad(n)}`),
      } as never), bucket);
      expect(withdrawn.status).toBe(302);
      const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(`synth-${pad(n)}`).first<{ email: string }>();
      expect(user?.email).toBe(withdrawnEmailFor(`synth-${pad(n)}`));
    }

    for (let n = 71; n <= 76; n += 1) {
      const cross = await invoke(() => reviewerRatingsLoader({
        request: getRequest("/reviewer/ratings", memberIp(n), `synth-session-${pad(n)}`),
      } as never), bucket);
      expect(cross.status).toBe(403);
    }

    let signupLast = 0;
    for (let n = 1; n <= 11; n += 1) {
      const posted = await invoke(() => signupAction({
        request: formRequest("/signup", {
          displayName: "폭주테스터",
          email: `abuse-signup-${n}@example.test`,
          password: "synthetic-pass-1",
          ageConfirmed: "yes",
        }, ABUSE_IP),
      } as never), bucket);
      signupLast = posted.status;
    }
    expect(signupLast).toBe(429);

    let loginLast = 0;
    for (let n = 1; n <= 21; n += 1) {
      const posted = await invoke(() => loginAction({
        request: formRequest("/login", {
          email: `abuse-login-${n}@example.test`,
          password: "synthetic-pass-1",
        }, ABUSE_IP),
      } as never), bucket);
      loginLast = posted.status;
    }
    expect(loginLast).toBe(429);

    let signupEmailLast = 0;
    const sameEmail = "abuse-email-limit@example.test";
    for (let n = 1; n <= 4; n += 1) {
      const posted = await invoke(() => signupAction({
        request: formRequest("/signup", {
          displayName: "이메일한도",
          email: sameEmail,
          password: "synthetic-pass-1",
          ageConfirmed: "yes",
        }, `198.51.103.${n}`),
      } as never), bucket);
      signupEmailLast = posted.status;
    }
    expect(signupEmailLast).toBe(429);

    let loginEmailLast = 0;
    const loginEmail = "synth+001@example.test";
    for (let n = 1; n <= 9; n += 1) {
      const posted = await invoke(() => loginAction({
        request: formRequest("/login", { email: loginEmail, password: "wrong-password-1" }, `198.51.104.${n}`),
      } as never), bucket);
      loginEmailLast = posted.status;
    }
    expect(loginEmailLast).toBe(429);

    const votesBeforeViewers = await countTable("current_votes");
    const suggestionsBeforeViewers = await countTable("place_suggestions");

    for (let n = 41; n <= 100; n += 1) {
      const ip = viewerIp(n);
      await invoke(() => placeListLoader({ request: getRequest("/places", ip) } as never), bucket);
      await invoke(() => placeDetailLoader({
        request: getRequest(`/places/${SLUG_A}`, ip),
        params: { placeSlug: SLUG_A },
      } as never), bucket);
      await invoke(() => placeDetailLoader({
        request: getRequest(`/places/${SLUG_B}`, ip),
        params: { placeSlug: SLUG_B },
      } as never), bucket);
      await invoke(() => mapCategoryLoader({
        request: getRequest("/maps/gukbap-detail", ip),
        params: { categorySlug: "gukbap-detail" },
      } as never), bucket);
      await invoke(() => reviewerProfileLoader({
        request: getRequest("/reviewers/synth-reviewer-gukmul", ip),
        params: { slug: "synth-reviewer-gukmul" },
      } as never), bucket);
    }

    expect(await countTable("current_votes")).toBe(votesBeforeViewers);
    expect(await countTable("place_suggestions")).toBe(suggestionsBeforeViewers);

    const afterVotes = await invoke(() => placeDetailLoader({
      request: getRequest(`/places/${SLUG_A}`, viewerIp(100)),
      params: { placeSlug: SLUG_A },
    } as never), bucket);
    const after = afterVotes.result as {
      rating: { overallSampleCount: number; overallScore: number | null };
      flavorPrint: { status: string; ratingCount: number };
    };
    expect(after.rating.overallSampleCount).toBeGreaterThanOrEqual(8);
    expect(after.rating.overallScore).not.toBeNull();
    expect(after.flavorPrint).toMatchObject({ status: "VISIBLE", ratingCount: 3 });
    expect(beforeRating.overallSampleCount).toBeLessThan(after.rating.overallSampleCount);

    const pairs = await env.DB.prepare(
      "SELECT user_id AS userId, place_id AS placeId, COUNT(*) AS count FROM current_votes GROUP BY user_id, place_id",
    ).all<{ userId: string; placeId: string; count: number }>();
    expect(pairs.results.every((row) => row.count === 1)).toBe(true);

    const suggestionStatuses = await env.DB.prepare("SELECT DISTINCT status FROM place_suggestions").all<{ status: string }>();
    expect(suggestionStatuses.results.every((row) => row.status === "SUBMITTED")).toBe(true);

    const product5xx = bucket.s5xx;
    const rate = product5xx / Math.max(bucket.total, 1);
    const voteCount = await countTable("current_votes");
    const suggestionCount = await countTable("place_suggestions");
    console.log(JSON.stringify({
      isolated: true,
      total: bucket.total,
      product_5xx: product5xx,
      isolated_mail_stub_503: bucket.mailStub503,
      status_429: bucket.s429,
      product_5xx_rate: Number(rate.toFixed(4)),
      current_votes: voteCount,
      place_suggestions: suggestionCount,
      viewer_mutations: 0,
      flavor_print: "VISIBLE",
      score_sample_before: beforeRating.overallSampleCount,
      score_sample_after: after.rating.overallSampleCount,
    }));
    expect(rate).toBeLessThanOrEqual(0.005);
    expect(bucket.s429).toBeGreaterThanOrEqual(4);
  });
});
