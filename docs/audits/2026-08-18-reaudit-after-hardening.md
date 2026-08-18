# 2026-08-18 재오딧 — 하드닝 이후 코드 vs 라이브

작성일 2026-08-18 12:30 KST · Issue [#197](https://github.com/taejunyun1/Tasted_it/issues/197) · 담당 Jay (`jay_reaudit_20260818`)
선행: [08-18 8각도 풀 오딧](./2026-08-18-eight-angle-full-audit.md) (`#187`/`#188`) · 후속 `#190` `#192` `#194` `#196`

이 문서는 제품 코드를 바꾸지 않는다. 비밀값, 이메일, 세션 ID, 상호·주소는 기록하지 않는다.

---

## 1. 두 기준선 (같다고 가정하지 않는다)

| 기준선 | 대상 | 무엇을 판정하는가 |
|---|---|---|
| **원 오딧 코드** | `origin/main` [`81a73e8`](https://github.com/taejunyun1/Tasted_it/commit/81a73e8) (`#186`) | 08-18 오전 P0/P1 라벨 |
| **지금 코드** | `origin/main` [`dcafa14`](https://github.com/taejunyun1/Tasted_it/commit/dcafa14) (`#196`) | 파일 재오픈 |
| **라이브** | Worker `retaste-beta` version `5f031bd2-c34e-4191-8d1f-656fdc4d46a0` (2026-08-18 00:15 UTC, `#186`) | 익명 HTTP·헤더·D1 집계 |

확인 시각: **2026-08-18 12:29–12:33 KST**. 단위 테스트는 이 오딧에서 재실행했다.

`#188` 이후 코드에만 들어온 squash: `#190` `6fa3eff` · `#192` `d40dd61` · `#194` `0cab447` · `#196` `dcafa14`. 라이브 배포 목록의 최신 100% 버전은 여전히 `5f031bd2…`다. `#190` 이후는 배포되지 않았다. [확인]

---

## 2. Executive verdict

# 코드는 초대 HOLD를 해제했다. 라이브와 공개 베타는 그대로다.

| 경계 | 08-18 오전 | 지금 코드 `dcafa14` | 지금 라이브 |
|---|---|---|---|
| 내부 개발·단위 품질 | GO (805) | **GO** (135 files / **818** PASS) | CI unit+integration은 GitHub에서 돈다 |
| 관리자 일상 검수 | 조건부 GO | 조건부 GO | 같은 Worker. Paid·파이프라인은 유지 |
| 초대 비공개 베타 | **HOLD** | **코드 해제** | **HOLD 유지** — 한도·토큰·탈퇴·방침이 라이브에 없음 |
| **공개 베타** | **NO-GO** | **NO-GO** | **NO-GO** |
| 정식 출시 | **NO-GO** | **NO-GO** | **NO-GO** |

세 줄:

1. **코드 P0 8건 중 6건은 파일에서 풀렸다.** 로그인 한도, 토큰 `#` 링크, 탈퇴 익명화, 방침·인벤토리, E2E D1 placeholder, SEO/헤더( CSP 제외). [확인]
2. **라이브 HTTP는 원 오딧과 같다.** `/places` 302 온보딩, 보안 헤더 0, sitemap 404, 홈 OG 0. 카탈로그도 PUBLISHED **2**. [확인]
3. **공개 베타를 막는 남은 축은 카탈로그 2곳, 운영자 연락처, `#182` 보호, 미배포다.** 처리량 숫자는 `#196`으로 고정됐고 GO가 아니다. [확인]

테스트 PASS는 공개 승인이 아니다.

---

## 3. 라이브 재실측 [확인]

익명 GET. `/robots.txt`는 HEAD가 404, GET은 200(Cloudflare content-signal, 앱 규칙 없음).

| 경로 | 상태 | 원 오딧 | 지금 |
|---|---|---|---|
| `/` | 200 | HTML 12,400 B, h1×2, OG 0, 보안 헤더 0 | HTML **12,396 B**, h1×2, OG/Twitter/canonical 0, skip-link+#main, 보안 헤더 0 |
| `/places` | 302 | `/onboarding/taste?returnTo=%2Fplaces` | **동일** |
| `/robots.txt` | GET 200 | CF content-signal | **동일**. 앱 `User-agent`/`Disallow`/`Sitemap` 없음 |
| `/sitemap.xml` | 404 | 404 | **동일** |
| `/privacy` `/terms` `/login` `/signup` `/courses` `/onboarding/taste` `/corrections/new` | 200 | 200 | **동일** |
| `/admin` | 404 | 404 | **동일** |
| `/admin/operations` `/me` | 302 | 로그인 | **동일** |

홈 응답 헤더: `server: cloudflare`, `cf-ray`, `nel`, `report-to`, `alt-svc`. `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` / `Permissions-Policy` / CSP / HSTS **없음**.

`gh api …/branches/main/protection` **404**. `rulesets` `[]`. [확인]

### 3.1 라이브 D1 집계 [확인]

원 오딧 표와 **같은 숫자**다. 카탈로그는 움직이지 않았다.

| 항목 | n |
|---|---:|
| places PUBLISHED / HIDDEN / DRAFT | **2** / 646 / 2 |
| SOURCE_REVIEW ACTIVE | 708 |
| NAVER_VERIFICATION ACTIVE | 35 |
| CATEGORY_CONFIRMATION ACTIVE | 12 |
| FINAL_APPROVAL COMPLETED / ACTIVE | 2 / 0 |
| users (ADMIN / REVIEWER / USER) | 70 (2 / 3 / 65) |
| vote_events / current_votes / saved_places | 119 / 114 / 0 |
| business_licenses | 1243 |
| admin_audit_logs | 1648 |
| rate_limit_windows | 0 |
| naver_local_category_verifications | 144 |

`rate_limit_windows = 0`은 로그인 한도 코드가 라이브에 없다는 것과 맞는다. [추론]

처리량 표본(`#196`, 같은 날 읽기): 14일 공개 2 · 7일 공개/일 0.29 · ACTIVE 755.

---

## 4. P0 — 원 오딧 공개 베타 차단 8건

| ID | 08-18 오전 | 지금 코드 | 지금 라이브 | 근거 |
|---|---|---|---|---|
| PROD-18-01 공개 2곳 | OPEN | **운영 잔여** | **OPEN** | D1 2곳. D-13으로 보안 블락커와 분리. 일괄 공개 없음 |
| SEC-01 로그인 한도 | PARTIAL | **코드 해제** | OPEN | `consumeLoginRateLimit` 이메일 8 / IP 20 / 15분. dummy KDF. PBKDF2 **99,999 유지** |
| SEC-03 토큰 URL·샘플링 1 | OPEN | **코드 해제** | OPEN | `accountActionUrl`이 `#token`. GET 미소비. `head_sampling_rate: 0.1` |
| SEC-04 위치 고지 | PARTIAL | **코드 해제** | OPEN | 방침 §4가 URL/로그를 인정 |
| SEC-05 탈퇴 없음 | OPEN | **코드 해제** | OPEN | `/me` `withdrawAccount` 익명화. 하드 삭제 아님. ADMIN 금지 |
| SEC-06 위탁 누락 | PARTIAL | **코드 해제** | OPEN | 방침·인벤토리에 Resend/OAuth/NAVER |
| QLT-18-01 E2E 운영 D1 | OPEN | **코드 해제** | 해당 없음 | `wrangler.e2e.jsonc` id `00000000-0000-4000-8000-000000000e2e`. 새 D1 없음 |
| QLT-02 CI unit만 | PARTIAL | **부분 해제** | **부분 해제** | `.github/workflows/ci.yml`에 integration 잡. Playwright CI 0 |

코드에서 풀린 P0: **6**. 부분: **1**(Playwright). 운영 잔여: **1**(카탈로그). 라이브에서 풀린 P0: **0**(CI만 GitHub에서 개선).

---

## 5. P1 — 원 오딧 14건

| ID | 08-18 오전 | 지금 코드 | 라이브 | 근거 |
|---|---|---|---|---|
| ARC-01 목록 vs 스냅샷 | OPEN | **OPEN** | 미배포 | 목록은 여전히 `currentVotes` 합. `getLatestRatingSnapshot`만 `isStale=false` |
| SEC-07 재설정 세션 | OPEN | **코드 해제** | OPEN | `resetPassword`가 `sessions` 삭제 |
| SEC-08 토큰 TOCTOU | OPEN | **코드 해제** | OPEN | `consumeToken` `.returning()` 검사 |
| SEC-09 보안 헤더 | OPEN | **부분** | OPEN | nosniff/DENY/Referrer/Permissions. **CSP·HSTS 없음** |
| SEC-11 GET 상세 지표 | OPEN | **코드 해제** | OPEN | `place-detail` loader가 `recordPlaceDetailView`를 안 부름 |
| UX-01 returnTo | PARTIAL | **코드 해제** | OPEN | `/me` `/courses` `/maps` `/onboarding` `/suggestions` `/reviewer` `/corrections` |
| UX-02 가입 오류 폼 | OPEN | **코드 해제** | OPEN | `actionData?.ok`일 때만 Form 제거 |
| UX-03 OG/sitemap | OPEN | **부분** | OPEN | 코드에 `robots.ts`·`sitemap.ts`·홈/상세 OG. 라이브 홈 OG 0, sitemap 404 |
| QLT-04 외부 알림 | OPEN | **OPEN** | OPEN | D1 알림만. 운영 문의 주소 미확정 |
| QLT-18-03 `main` 보호 | OPEN | **OPEN** | OPEN | API 404 / rulesets `[]` |
| ADM-IA-03 `/admin` 404 | OPEN | **OPEN** | OPEN | 라우트 없음. 라이브 404 |
| ADM-SEC-01 same-origin 1곳 | OPEN | **부분** | OPEN | 검수·운영·평가·리뷰어·동기화·import·`/me` 탈퇴 |
| PROD-18-02 `/places` 강제 온보딩 | OPEN | **코드 해제** | **OPEN** | `place-list.tsx` loader에 redirect 없음. 라이브 302 |
| SEC-18-26 Google 미인증 연결 | OPEN | **코드 해제** | OPEN | 미인증 기존 이메일은 `GOOGLE_EXISTING_ACCOUNT_LOGIN_REQUIRED` |

추가 코드 해제(원 P0/P1 밖, 같은 파도): 만 14세 가입 확인(D-04, 생년 미수집). 검수 처리량 화면(`#196`).

---

## 6. `#183` 슬라이스

| 슬라이스 | 원 오딧 | 지금 |
|---|---|---|
| 1 E2E 운영 id 분리 | 미착수 | **코드 해제** `#190` |
| 2 검수 처리량 숫자 | 미착수 | **측정됨** `#196`. 카탈로그는 2곳 |
| 3 지역별 NAVER 예산 | 미착수 | 미착수. 전역 20000 |
| 4 큐레이션 품질 기록 | 미착수 | 미착수 |
| 5 geo 인덱스 | 측정 전 | 하지 말 것. 병목 증거 없음 |
| 6 slugPrefix 테스트 | 부분 | 부분 |

---

## 7. 재실행한 검증

- `vitest run` — **135 files / 818 tests PASS** (원 오딧 128 / 805)
- `app/` `dangerouslySetInnerHTML` / `innerHTML=` / `document.write` **0**
- `main` protection 404, rulesets `[]`
- 대비 쌍 `#78827b` / `#6d786f`는 `app.css`에 잔존. UX-08 **OPEN**
- `pnpm audit`는 이번 실행에서 다시 돌리지 않음. [확인(명령 미실행)]
- Playwright·E2E는 이번 실행에서 돌리지 않음

---

## 8. 개선 폭 — 한 장

| 층 | 개선 | 안 변한 것 |
|---|---|---|
| 코드 보안·권한 | 로그인 한도, dummy KDF, 토큰 `#`, GET 미소비, 세션 삭제, TOCTOU, Google 미인증 거절, 탈퇴 익명화, same-origin 확대 | PBKDF2 99,999, CSP, `/admin` 셸 |
| 코드 고지·품질 | 방침·인벤토리, 14세, E2E placeholder, CI integration, robots/sitemap/OG 라우트, 처리량 칸 | 운영자 연락처, Playwright CI, 외부 알림 |
| 라이브 Worker | 없음 (`5f031bd2` = `#186`) | `/places` 302, 헤더 0, sitemap 404, 카탈로그 2 |
| 카탈로그 | 처리량 측정 | PUBLISHED 2, ACTIVE 755, 최종 대기 0 |
| 소유자 | 없음 | `#182` Private / branch protection, 법적 명칭·연락처 |

**초대 베타:** 오딧 당시 HOLD 근거는 **코드에서 사라졌다.** 라이브에 올리기 전에는 사용자에게 보이지 않는다.
**공개 베타:** 코드가 헤더·온보딩·SEO를 넣어도 장소 2곳과 연락처가 남으면 **NO-GO**다.

이 문서는 배포 승인이 아니다.

---

# Re-audit after hardening (English)

**Date:** 2026-08-18 12:30 KST · **Code:** `dcafa14` · **Live Worker:** `5f031bd2-c34e-4191-8d1f-656fdc4d46a0` (`#186`)
**Issue:** #197 · No product-code changes. No secrets/PII.

**Verdict:** Code cleared the invite-HOLD reasons. Live is unchanged. Public beta remains **NO-GO**.

**What improved in code:** login rate limit (8/email, 20/IP, 15 min) + dummy KDF; hash-fragment tokens; GET no longer consumes; password reset deletes sessions; token consume checks `.returning()`; Google refuses unverified existing email; `/me` anonymizing withdraw; privacy/inventory match location logs and vendors; E2E D1 placeholder; CI integration job; security headers without CSP; `/places` no longer 302s unfinished guests; age-14 checkbox; throughput panel with a 2-week sample (2 publishes / 0.29 per day / ACTIVE 755).

**What did not move on live:** `/places` still 302 to onboarding; no app security headers; sitemap 404; home OG 0; PUBLISHED 2; `rate_limit_windows` 0; `main` protection 404.

**Still NO-GO for public beta:** catalog size, operator legal contact, `#182`, undeployed `#190`–`#196`. Measurement is not GO.
