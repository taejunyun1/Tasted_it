# 2026-08-18 8각도 풀 오딧

작성일 2026-08-18 · Issue [#187](https://github.com/taejunyun1/Tasted_it/issues/187) · 담당 Jay (`jay_full_audit_20260818`)  
선행: [2026-08-07 풀 오딧](./2026-08-07-full-product-design-technical-audit.md) 55건 · [2026-08-17 관리자 오딧](./2026-08-17-admin-audit.md)

이 문서는 제품 코드를 바꾸지 않는다. 비밀값, 이메일, 세션 ID, 상호·주소는 기록하지 않는다.

---

## 1. 감사 기준선, 범위, 제외

### 1.1 두 기준선 (같다고 가정하지 않는다)

| 기준선 | 대상 | 무엇을 판정하는가 |
|---|---|---|
| **코드 SSOT** | `origin/main` [`81a73e8`](https://github.com/taejunyun1/Tasted_it/commit/81a73e8) (`#186`) | 파일:라인, 스키마, 테스트, 문서 |
| **라이브** | Worker `retaste-beta` version `5f031bd2-c34e-4191-8d1f-656fdc4d46a0` (배포 SHA `81a73e8`) | 익명 HTTP, 응답 헤더, D1 행 수(집계만) |

확인 시각: **2026-08-18 09:20–09:40 KST**(1차 집계) · **09:29–09:30 KST / 00:29–00:30 UTC**(2차 헤더·홈 HTML 재실측). 단위 테스트는 이 오딧에서 재실행했다.

### 1.2 라이브 실측 [확인]

익명 GET, 리다이렉트 비추적:

| 경로 | 상태 | 비고 |
|---|---|---|
| `/` | 200 | HTML **12,400 bytes**. title `Re:Taste — 내 주변 맛 지도`, description 있음, `h1` 「지금 갈 만한 5곳」 **2회**(패널+시트), OG/Twitter/canonical/JSON-LD 0, skip-link+#main 있음. 응답 헤더: `content-type`, `server: cloudflare`, `cf-ray`, `nel`, `report-to`, `alt-svc`. **CSP/HSTS/XFO/nosniff/Referrer-Policy/Permissions-Policy 없음** |
| `/places` | 302 | `/onboarding/taste?returnTo=%2Fplaces` |
| `/privacy` `/terms` `/login` `/signup` `/courses` `/onboarding/taste` `/corrections/new` | 200 | |
| `/robots.txt` | 200 | Cloudflare 기본 content-signal 문구. 앱 라우트 0건 |
| `/sitemap.xml` | 404 | |
| `/admin` | 404 | |
| `/admin/place-operations` `/admin/audit` `/admin/operations` `/admin/places` `/admin/data-sync` `/me` `/reviewer/ratings` | 302 | `/login?returnTo=…` |

로그인 검수 GET 200·2단계 이동은 같은 날 오전 배포 후 QA에서 확인했다. 이 오딧 본편은 그 QA 세션을 다시 만들지 않았다.

### 1.3 라이브 D1 집계 [확인]

원격 migration은 `0000`–`0034` 적용됨(파일명 `0031`이 2개). 마지막 기록명 `0034_place_review_pipeline.sql`.

| 항목 | n |
|---|---:|
| places 전체 / PUBLISHED / DRAFT / HIDDEN | 650 / **2** / 2 / 646 |
| business_licenses | 1243 |
| place_review_work_items 전체 / ACTIVE | 908 / 755 |
| SOURCE_REVIEW ACTIVE / EXCLUDED | 708 / 145 |
| NAVER_VERIFICATION ACTIVE / EXCLUDED | 35 / 5 |
| CATEGORY_CONFIRMATION ACTIVE | 12 |
| FINAL_APPROVAL COMPLETED | 2 |
| users (ADMIN / REVIEWER / USER) | 70 (2 / 3 / 65) |
| vote_events / current_votes / snapshots | 119 / 114 / 9 |
| saved_places / suggestions / corrections | 0 / 12 / 0 |
| admin_audit_logs | 1648 |
| rate_limit_windows | 0 |
| naver_local_category_verifications | 144 |

`FINAL_APPROVAL COMPLETED 2` = `places PUBLISHED 2`. 공개 카탈로그와 검수 완료가 일치한다.

### 1.4 범위와 제외

**포함:** 08-07 8각도 55건 전수 재검증(파일 재오픈), 08-17 ADM 재검증, 현행 라우트 권한, 라이브 HTTP·헤더, D1 집계, 단위 테스트, CI, branch protection, 의존성 high 감사, 대비 재계산, `innerHTML`/`dangerouslySetInnerHTML` grep.

**제외:** 제품 코드 수정, 배포, 원격 D1 쓰기, secret 값 열람, NAVER 일괄, 615곳 지오코딩, 두 번째 도시, 통합/E2E 재실행, CDP 27폭 재실측.

### 1.5 이 오딧에서 재실행한 검증

- `pnpm test` — **128 files / 805 tests PASS** (2026-08-18)
- `pnpm audit --audit-level=high` — high 2 (undici, nanoid), moderate 5. 둘 다 dev 경로
- `gh api …/branches/main/protection` — **404** (보호 없음)
- `gh api …/rulesets` — `[]`
- `app/` `dangerouslySetInnerHTML`·`innerHTML`·`document.write` **0건**
- `var(--s1)`–`var(--s12)` 사용 **0건**. `app.css` 128,485 bytes + `design-system.css` 29,639 bytes. 고유 hex **313**
- 대비 재계산: `.map-place-index` `#78827b`/`#fff` **3.98:1**, `.place-image__fallback` `#6d786f`/`#e8eee7` **3.90:1** (둘 다 AA 실패)
- 라이브 헤더 재실측 2026-08-18 00:29 UTC (보안 헤더 0)

`pnpm test:integration` / `test:e2e` / `typecheck`는 이번 실행에서 돌리지 않았다. [확인(명령 미실행)]

### 1.6 증거 등급

- **[확인]** 파일을 열거나 라이브/D1/테스트를 직접 측정
- **[추론]** 확인된 사실에서 문서화된 규칙으로 도출
- **[가설]** 판단 근거로 쓰지 않음
- **[미재검증]** 08-07 인용은 남기되 이번 실행에서 파일을 다시 열지 않음

테스트 PASS·HTTP 200은 공개 승인가 아니다.

---

## 2. Executive verdict

# HOLD

| 경계 | 판정 | 근거 |
|---|---|---|
| 내부 개발·단위 품질 | **GO** | 805 unit PASS, 타입/빌드 게이트가 CI에 존재 |
| 관리자 일상 검수(로그인) | **조건부 GO** | `#184`/`#185` 해소, Paid, 2단계 이동 라이브 확인. 셸 없음·CSRF 부분·좌표 708곳 잔여 |
| 초대 비공개 베타 | **HOLD** | 로그인 rate limit 없음, 토큰 URL, 탈퇴 없음, 처리방침 불일치 |
| **공개 베타** | **NO-GO** | 공개 장소 **2곳**, SEO/헤더 부재, `/places` 강제 온보딩, CI가 E2E를 안 돌림, `main` 보호 0 |
| 정식 출시 | **NO-GO** | 위 전부 + 인벤토리/운영자 연락처/14세 정책 미확정 |

HOLD는 “도메인이 나쁘다”가 아니다. 투표 이벤트 소싱, 지역 팩 강제, 검수 파이프라인, 메일 rate limit, Paid 이후 검수 GET은 08-07·08-17 대비 나아졌다. 막힌 층은 **공개 카탈로그 규모, 남용 방어의 로그인 문, 법적 고지, 출시 게이트**다.

세 줄:

1. **공개할 장소가 거의 없다.** PUBLISHED 2 · HIDDEN 646 · 1단계 ACTIVE 708. 게이트 “검수된 광주 300곳”과 두 자릿수 이상 차이. [확인]
2. **인증 전 PBKDF2 99,999회는 그대로이고 로그인에는 rate limit이 없다.** 메일 3종만 `consumeMailRateLimit`. [확인]
3. **처리방침은 여전히 출시 전 초안이며 탈퇴 라우트가 0건**이다. 위치는 “서버에 저장하지 않음”인데 bbox는 서버 loader로 들어가고 observability `head_sampling_rate: 1`이다. [확인]

---

## 3. 결함 요약

우선순위와 심각도는 별개다. 직접 인증 우회·대량 유출 증거가 없으면 Critical을 쓰지 않는다.

### 3.1 이번 기준의 P0 — 공개 베타 차단

| ID | 결함 | 심각도 | 08-07 | 2026-08-18 | 근거 |
|---|---|---|---|---|---|
| PROD-18-01 | 공개 장소 2곳. 론칭 게이트 300과 불일치 | High | 신규 | **OPEN** | D1 `places` PUBLISHED=2, FINAL_APPROVAL COMPLETED=2 |
| SEC-01 | 로그인 rate limit 없음 + PBKDF2 99,999 | High | OPEN | **PARTIAL** | 메일은 `0028`+`consumeMailRateLimit`. `login.tsx` action은 한도 없음. `password.server.ts:1` |
| SEC-03 | 인증 토큰이 URL 쿼리 + 전 요청 샘플링 1 | High | OPEN | **OPEN** | `signup.tsx:34`, `forgot-password.tsx:27`, `place-correction.tsx:26`, `wrangler.jsonc` observability |
| SEC-04 | 위치 bbox 서버 전송·로깅 vs “저장 안 함” 단언 | High | OPEN | **OPEN** | `privacy.tsx:12` vs `home.tsx` bbox, `head_sampling_rate: 1` |
| SEC-05 | 회원 탈퇴 라우트 0 | High | OPEN | **OPEN** | `app/` 탈퇴 함수 0. 방침·약관은 탈퇴를 약속 |
| SEC-06 | 인벤토리·방침이 Resend/OAuth/NAVER/리뷰어 직업을 빠뜨림 | High | OPEN | **PARTIAL** | 게스트 온보딩은 인벤토리에 추가됨. 처리위탁은 Cloudflare만 |
| QLT-18-01 | E2E wrangler가 운영 `database_id`를 복제 | High | (슬라이스1) | **OPEN** | `wrangler.e2e.jsonc:16` = `wrangler.jsonc` 운영 id. `--local`이 빠지면 원격 쓰기 [추론] |
| QLT-02 | CI가 단위+typecheck만. integration/E2E/audit 없음 | High | OPEN(부재) | **PARTIAL** | `.github/workflows/ci.yml` 존재. E2E 잡 0 |

### 3.2 P1 — 출시 직후·초대 베타 전

| ID | 결함 | 08-07 | 지금 | 근거 |
|---|---|---|---|---|
| ARC-01 | 목록은 `currentVotes` 원시 합, 상세는 v2 스냅샷. 무효화 미반영 | OPEN | **OPEN** | `place.server.ts:270-271` vs `place-detail.tsx:90-116` |
| SEC-07 | 비밀번호 재설정이 세션을 안 지움 | OPEN | **OPEN** | `account.server.ts:74-79` |
| SEC-08 | 토큰 소비 TOCTOU | OPEN | **OPEN** | `consumeToken`이 `changes` 미확인 |
| SEC-09 | 보안 헤더·CSP 0 | OPEN | **OPEN** | `workers/app.ts:14-16` 그대로 전달. 라이브 헤더 실측 |
| SEC-11 | GET loader가 상세 조회 지표를 씀 | OPEN | **OPEN** | `place-detail.tsx:89` `recordPlaceDetailView` |
| UX-01 | `returnTo`가 `/places*`·`/admin*`만 | OPEN | **PARTIAL** | `login.ts:18-20`. `/me` `/courses`는 `/`로 떨어짐 |
| UX-02 | 회원가입 오류 시 폼 소실 | OPEN | **OPEN** | `signup.tsx:43` `actionData?.message`면 Form 제거 |
| UX-03 | OG/canonical/sitemap 없음. 상세 title 고정 | OPEN | **OPEN** | 라이브 OG 0, sitemap 404, `place-detail.tsx:187` |
| QLT-04 | 운영 알림의 외부 통지 없음 | OPEN | **OPEN** | `alerts.server.ts` D1만. `admin-operations.tsx:12`가 자인 |
| QLT-18-03 | `main` branch protection·ruleset 없음 | 신규 | **OPEN** | GitHub API 404 / `[]` |
| ADM-IA-03 | `/admin` 404, 관리자 셸 없음 | OPEN | **OPEN** | 라이브 404, `root.tsx:34` 검수 한 링크 |
| ADM-SEC-01 | same-origin은 검수 POST만 | OPEN | **OPEN** | `isSameOriginMutation` 사용처 1곳 |
| PROD-18-02 | `/places`가 온보딩으로 강제 리다이렉트 | 신규 | **OPEN** | 라이브 302. `place-list.tsx:32` |

### 3.3 P2

| ID | 상태 | 한 줄 |
|---|---|---|
| SEC-02 | **PARTIAL** | 정정·가입·재설정 메일 한도 있음. 남용 표면은 줄었으나 한도 우회·로그인 문은 남음 |
| SEC-10 | **OPEN** | 미인증 vs 미인증 메일의 문구가 `EMAIL_NOT_VERIFIED`로 갈림 (`login.tsx:48`) |
| ARC-02 | **FIXED** | `PlaceDetailSheet`가 load/save fetcher 분리 (`:13-14`) |
| ARC-03 | **OPEN** | re-import가 새 primary만 `true`. 기존 primary unset 없음 (`place.server.ts:116-120`) |
| ARC-06 | **OPEN** | `mergePlaces`가 rating 재계산·flavor/golden 미이관 |
| ARC-07 | **PARTIAL** | 검수 action은 일괄 try/catch (`admin-place-operations.tsx:291-326`). 다른 admin은 그대로 |
| ARC-11 | **OPEN** | `verify-email.tsx:6`·`verify-correction.tsx:2` GET에서 토큰 소비 |
| QLT-01 | **PARTIAL** | 로컬 E2E는 `--local --persist-to` + QA 시드. 운영 id 복제는 QLT-18-01 |
| QLT-03 | **PARTIAL** | 정정은 try/catch+한도. 실패 시 내부 코드 노출 가능 (`place-correction.tsx:29`) |
| QLT-05 | **PARTIAL** | 통합 테스트는 `test-worker.ts` + `remoteBindings: false` |
| QLT-10 | **PARTIAL** | `package.json`에 `packageManager` 고정 |
| UX-04 | **OPEN** | dialog `aria-modal`만, 포커스 트랩 없음 |
| UX-05 | **PARTIAL** | OAuth 오류만 `role=alert`. 로그인 비밀번호 오류는 없음 |
| UX-06 | **OPEN** | 403 → `root.tsx` “길을 잃었습니다” |
| UX-07 | **OPEN** | `/maps/:slug` 내 주변 `getCurrentPosition(() => undefined)` |
| UX-09 | **FIXED** | 홈 `h1` 라이브 확인 |
| UX-10 | **PARTIAL** | `admin-places`·`admin-data-sync`·`admin-import`에 `#main` 없음. `admin-candidates`는 redirect만 |
| DOC-02 | **FIXED** | `/admin/audit` 존재 |
| ADM-IA-01/02 | **FIXED** | `#173`/`#175` |
| ADM-OPS-02 | **SUPERSEDED** | Paid 실측(홈 CPU 98–113ms, 검수 GET 200) |
| ADM-OPS-03 | **FIXED** | 운영 계정 SSOT |
| ADM-AUTH-01 | **FIXED** | `safeReturnTo`가 `/admin*` 허용 |
| ADM-ERR-01 | **FIXED** | 검수 mutation 화면 400 |
| ADM-OBS-01 | **PARTIAL** | `PLACE_REVIEW_*` 집계 추가. 레거시 APPROVE/REJECT 칸 유지 |
| ADM-ERR-02 | **OPEN** | 비관리자 403은 E2E가 상태만 확인. 화면은 여전히 “길을 잃었습니다” |
| ADM-TEST-01 | **PARTIAL** | E2E가 현 IA 탭·제안 승인·재검증 필터를 단언. 공개 happy path·운영 D1 격리는 없음 |
| ADM-UX-01 | **OPEN** | `/admin/places` 페이지네이션·empty·`#main` 없음 |
| ADM-UX-02 | **OPEN** | data-sync zod/오류 UI 없음, 성공 시 검수 redirect |
| ADM-AUD-01 | **OPEN** | `sourceCommit: "runtime-unversioned"` |
| ADM-OPS-04 | **OPEN** | cron 5작업 `Promise.all` (`workers/app.ts:18-24`) |
| MIG-18-01 | **OPEN** | `0031_place_category_v5_profiles.sql`와 `0031_remove_workers_ai.sql` 동명 순번 |
| SEC-13 | **PARTIAL** | `upsertBetaUser`는 더 이상 무조건 ADMIN이 아님. 라우트 참조 0 |
| SEC-18-03 | **OPEN** | `admin-places.tsx:20`이 로그인 이메일을 화면에 렌더 |

### 3.4 P3 / 공급망

| ID | 상태 | 근거 |
|---|---|---|
| SEC-12 | **OPEN** | `pnpm audit` undici GHSA-4cwx-7wf7-3272 — miniflare 경로, **dev** |
| SEC-18-04 | **OPEN** | nanoid GHSA-2v37-7h3g-55p8 — vite>postcss, **dev** |
| SEC-14 | **OPEN** | `scripts/seed-admin-qa.sql` + playwright 로컬만 |
| QLT-09 | **OPEN** | coverage 임계 없음 [확인(설정 파일)] |
| UX-08 | **OPEN** | 쌍은 바뀜. `.map-place-index` 3.98:1, `.place-image__fallback` 3.90:1. 08-07 3.64/3.26 쌍은 코드에서 사라짐 |
| UX-11 | **OPEN** | `--s1`–`--s12` 정의만, `var(--s*)` 0. 고유 hex 66→**313** (`design-system.css` 추가) |
| UX-12 | **OPEN** | Tailwind + `app.css` + `design-system.css` **3중** |
| UX-13 | **OPEN** | 8px 1 · 9px 11 · 10px 31 · 11px 61 규칙 |
| UX-14 | **OPEN** | `prefers-reduced-motion` 여러 곳. `.place-detail-sheet` `animation`은 예외 |
| UX-15 | **OPEN** | `app/welcome/welcome.tsx` 라우트 참조 0. `.hero`/`.category-grid` CSS 잔존 |
| UX-18-01 | **OPEN** | 큐레이션 시 `HomeCurationPanel`+`HomeCurationSheet`가 둘 다 `h1`을 렌더. 라이브 HTML 동일 h1 2개 |
| ARC-04 | **OPEN** | `getLatestRatingSnapshot`이 `isStale`을 필터하지 않음 (`recompute.server.ts:148-152`) |
| ARC-05 | **PARTIAL** | 후보 목록 `limit(300)` 유지. 일괄 승인 `BULK_LIMIT=25` |
| ARC-08 | **OPEN** | 같은 값 재투표도 `CHANGE` (`vote.server.ts:43-52`). 임계 5회 (`integrity.server.ts:44-45`) |
| ARC-09 | **OPEN** | `listPublicCategoryGroups`는 bbox 없음. `home.tsx:193-194`는 목록만 bbox |
| ARC-10 | **FIXED** | 실패 시 `sdkPromise` 해제 (`naver-map-sdk.ts:51-54`) |
| QLT-06 | **OPEN** | `week1-data-runbook.md:54-55`가 운영 D1 `--remote` 시드 지시 |
| QLT-07 | **PARTIAL** | `ai-operations-runbook.md` 삭제. `week1`은 여전히 `npm`·`retaste-local` |
| QLT-08 | **OPEN** | 런북이 `SESSION_SECRET`을 요구. 세션은 D1 opaque UUID, `cloudflare-env.d.ts`에 해당 키 없음. `81a73e8` 배포 칸 미기록 |
| DOC-01 | **OPEN** | `docs/superpowers/specs/2026-08-05-tastedit-product-direction-v2-design.md:1·:19` `Tasted : IT` |
| DOC-03 | **OPEN** | master Better Auth · decisions 매직링크 · 코드 이메일+비밀번호 |
| SEC-15 | **OPEN** | `submitFlavorRating`이 장소 primary 카테고리와 템플릿 `categoryId`를 대조하지 않음 |
| XSS | **확인 0** | `app/` `dangerouslySetInnerHTML`/`innerHTML`/`document.write` 0 |

**집계:** 08-07 55건 전수 재오픈. 공개 P0 8 · P1 13 · 그 외 OPEN/PARTIAL/FIXED는 §15. 이번 실행 신규 `UX-18-01`, `QLT-18-01`, `QLT-18-03`, `PROD-18-01/02`, `MIG-18-01`, `SEC-18-03/04`. FIXED(완전): ARC-02, ARC-10, UX-09, DOC-02, ADM-IA-01/02, ADM-OPS-03, ADM-AUTH-01, ADM-ERR-01. SUPERSEDED: ADM-OPS-02.

---

## 4. 각도 1 — 기준선·SSOT·구현 phase

### 4.1 지금 위치 [확인]·[추론]

코드는 v2의 “단계 2 광주 공개 베타 진입 전”보다 **운영 파이프라인은 들어왔고 공개 카탈로그는 없다.** 검수 5단계·제안 UI·재검증 탭·지역 팩·Paid는 있다. 공개 장소는 2곳이다.

`#183` 고도화 슬라이스:

| 슬라이스 | 상태 |
|---|---|
| 1 E2E에서 운영 `database_id` 분리 | **미착수** — `wrangler.e2e.jsonc` 동일 id |
| 2 검수 처리량 숫자 | **미착수** — 대시보드는 코드, 2주 표본 PR 없음 |
| 3 지역별 NAVER 예산 | **미착수** — 전역 20000만 |
| 4 큐레이션 품질 기록 | **미착수** |
| 5 geo 인덱스 | 측정 전, 하지 말 것 |
| 6 slugPrefix 테스트 | **부분** — `tests/unit/region-pack.test.ts:84`가 `GWANGJU.slugPrefix === ""`만 단언. 접두 적용 분기는 유닛 1개 |

`#182` Private은 소유자 결정 대기. 이 오딧은 전환하지 않는다.

### 4.2 SSOT 판정 (갱신)

| 문서 | SSOT | 사유 |
|---|---|---|
| `drizzle/*.sql` + 원격 `d1_migrations` | 사용 가능 | 36개 적용. `0031` 파일명 충돌만 기록 |
| `AGENTS.md` / `COWORK.md` | 사용 가능 | CI가 typecheck+unit만 강제 |
| `region-pack.ts` | 지역 상수의 코드 SSOT | 두 번째 도시 없음 |
| 병합 PR | 승인 SSOT | 유지 |
| `docs/main-change-history.md` | 인덱스 | 상단 “마지막 확인”이 `562d5f4`로 오래됨 |
| `privacy.tsx` | 불가 | DRAFT 2026-08-05, 사실과 불일치 |
| plans 체크박스 | 불가 | 08-07과 동일 유형 |

### 4.3 잘 지켜진 규율 [확인]

- 기존 migration 수정 없음, 새 순번 추가
- `pnpm` only, `packageManager` 고정
- 신규 작업 `origin/main` → `jay_*` → PR
- Workers AI 제거 migration이 원격에 적용됨

---

## 5. 각도 2 — 제품 경계·정의·론칭 게이트

### 5.1 경계는 코드로 강제된다 [확인]

`REGION_CODES = GWANGJU | JEONNAM`, `LAUNCH_PUBLIC_DATA_ADDRESS_PREFIX = 전남광주통합특별시`. 라이브 주소 접두가 이렇게 보이는 것은 버그가 아니라 팩 값이다.

두 번째 도시 구현은 `#179`/`#180`으로 금지. 이 오딧도 확장하지 않는다.

### 5.2 론칭 게이트 vs 숫자 [확인]

| 게이트 | 요구 | 라이브 |
|---|---|---|
| 검수된 공개 장소 | (구) 300곳 / (현) 측정된 처리량 | **PUBLISHED 2** |
| 파이프라인 동작 | 관리자가 큐를 처리 | 2단계 이동 8·NAVER 3 표본은 됨. 1단계 708 잔여 |
| 큐레이션 “이 정도면 된다” | PR 기록 | 없음. 홈 알고리즘은 있으나 후보가 PUBLISHED만 |
| 지역별 NAVER 예산 | 팩 필드 | 전역 20000 |
| E2E ≠ 운영 D1 | placeholder | **같은 id** |

홈 `h1` 「지금 갈 만한 5곳」은 **섹션 제목**이다. `home-curation.server.ts`는 품질 필터 후 0이면 `EMPTY`. 공개 2곳이면 반경 안에 5곳이 채워지지 않을 수 있다. [추론]

### 5.3 온보딩이 공개 목록을 가린다 [확인]

`ONBOARDING_ENABLED=true`. `/places` 익명 302 → 온보딩. 리스트 진입 비용이 커졌다. 초대 베타에서는 의도일 수 있으나, 공개 베타 전 결정이 문서화돼 있지 않다.

`/courses`는 플래그 `COURSE_CONTEXT_V2_ENABLED=false`여도 라우트 200. 플래그와 라우트 노출이 어긋난다. [확인(라이브 200)] · [추론(빈 코스)]

### 5.4 브랜드 [확인]

UI·방침·title은 `Re:Taste`. 헤더 “광주·전남 맛 지도”. v2 스펙 제목·`:19`는 여전히 `Tasted : IT` (DOC-01 OPEN).

---

## 6. 각도 3 — UX·IA·화면 계약

### 6.1 라우트 권한 개요 [확인]

`app/routes.ts` 공개·회원·관리자 경로. 확인한 admin loader/action은 모두 `requireAdmin`. 익명 관리자·`/me`는 302. 권한 누락 라우트 **0건**(확인한 범위).

`/admin` 자체는 라우트 없음 → 404. 북마크 불가.

### 6.2 로그인 복귀 [확인]

`safeReturnTo`는 `/places`, `/places/*`, `/admin`, `/admin/*`만. 투표 복귀(`/places/:slug`)는 살았다. `/me`·`/courses`·온보딩 완료 후 임의 경로는 `/`. open redirect는 `//`·외부 origin 거절로 막힘 (`login-return-to.test.ts`).

### 6.3 폼·오류 [확인]

- 로그인 실패 폼 유지. OAuth 오류만 `role=alert`.
- 회원가입은 메시지 있으면 폼 제거. 검증 실패도 재입력 불가.
- 403과 5xx가 같은 ErrorBoundary.
- 검수 잘못된 intent는 화면 400 문구(“이 단계에서는…”) — `#185` 재현 후 `#186`으로 해소된 경로.

### 6.4 관리자 IA [확인]

헤더 「어드민」→ 검수. 제안·재검증·정정·병합은 검수 탭으로 복구됨(08-17 P0 해소). 감사·운영·리뷰어·평가·가져오기·동기화는 URL 직접 입력. 셸 없음.

`admin-places`는 상한 없는 목록 + 로그인 이메일 표시. `#main` 없음.

### 6.5 시트 [확인]

`PlaceDetailSheet` 이중 fetcher 분리 → ARC-02 해소. `role="dialog"` + `aria-modal="true"`이나 포커스 트랩·초기 포커스·복원은 없음. Escape·오버레이 클릭으로 닫힘. `document.body.style.overflow`만 잠금.

### 6.6 라우트·가드 매트릭스 [확인]

`app/routes.ts` 등록 40경로. `/admin` 자체는 없음.

| 경로 | 가드 | same-origin | `#main` | 라이브 익명 |
|---|---|---|---|---|
| `/` `/privacy` `/terms` `/login` `/signup` `/courses` `/onboarding/taste` `/corrections/new` | 공개 | — | 있음 | 200 |
| `/places` | 공개, 온보딩 강제 | — | 있음 | 302 → 온보딩 |
| `/places/:slug` `/maps/:categorySlug` | 공개 | vote/save 없음 | 있음 | (상세는 공개 2곳만 의미) |
| `/me` `/me/suggestions` `/suggestions/new` `/reviewer/apply` `/reviewer/ratings` | `requireUser` | 없음 | 있음 | 302 로그인 (`/me` 실측) |
| `/admin/place-operations` | `requireAdmin` | **있음** | 있음 | 302 |
| `/admin/operations` `/admin/audit` `/admin/reviewers` `/admin/ratings` | `requireAdmin` | 없음 | 있음 | 302 |
| `/admin/places` `/admin/data-sync` `/admin/import` | `requireAdmin` | 없음 | **없음** | 302 |
| `/admin/candidates` `/admin/candidates/bulk` | `requireAdmin` 후 1단계 redirect | — | UI 없음 | 302 |
| `/admin` | 라우트 없음 | — | — | 404 |
| `/logout` | POST | 없음 | — | — |
| `/verify-email` `/corrections/verify` | 공개 GET, 토큰 소비 | — | 있음 | 토큰 없으면 실패/400 |
| `/review-photos/:photoId` | 공개 GET, opaque id | — | — | nosniff만 |

### 6.7 지도 [확인]

권역 밖 안내는 `location-policy.ts`가 `main`에 있음(08-07 PR #41 델타 흡수). `/maps/:slug` 내 주변 버튼은 좌표를 버린다 (UX-07).

---

## 7. 각도 4 — 접근성·반응형·SEO

### 7.1 랜드마크 [확인]

루트 skip-link → `#main`. 공개 홈·로그인·방침은 `#main` 있음. `admin-places`·`admin-data-sync`·`admin-import`는 `<main>`만 있고 id 없음. skip-link가 실패한다. `admin-candidates`는 UI가 없어 해당 없음.

홈 큐레이션은 패널(`HomeCurationPanel`)과 시트(`HomeCurationSheet`)가 **동시에** `h1`을 그린다 (`home.tsx:473-509`). 라이브 HTML에 「지금 갈 만한 5곳」이 **2개**. 시각적으로 하나는 미디어쿼리로 가려질 수 있으나 문서 랜드마크는 중복이다. UX-09(h1 부재)는 해소됐고 UX-18-01(h1 중복)이 생겼다.

### 7.2 반응형 [미재검증]

08-07 CDP 27조합 오버플로 0. 이번 실행에서 폭 재실측 없음. 홈 큐레이션 시트·스냅(`peek/half/full`)은 이후 추가되어 **회귀 가능성은 있다.** 판정 근거로 쓰지 않음.

### 7.5 CSS·대비 재실측 [확인]

| 항목 | 08-07 | 2026-08-18 |
|---|---|---|
| `app.css` 크기 | 45,751 bytes | **128,485** |
| 두 번째 시트 | 없음 | `design-system.css` 29,639 |
| 고유 hex | 66 | **313** |
| `--s*` 사용 | 0 | 0 |
| 대비 실패 | 3.64, 3.26 | **3.98, 3.90** (다른 선택자) |
| 9–11px | 클러스터 | 8/9/10/11px = 1/11/31/61 |
| reduced-motion | 시트 예외 | `.place-detail-sheet` 애니메이션 예외 유지 |
| `welcome.tsx` | 미참조 | 미참조 |

### 7.3 SEO·공유 [확인]

- 홈: title+description. OG/Twitter/JSON-LD/canonical **0**
- 상세: title 고정 “장소 상세 — Re:Taste”, `h1`은 장소명(코드). 공유 카드 없음
- `robots.txt`: 앱 미구현. 라이브 200은 플랫폼 기본
- `sitemap.xml` 404

공개 베타에서 지역 검색 유입을 기대해서는 안 된다.

### 7.4 외부 폰트 [확인]

`root.tsx`가 jsDelivr SUIT + Google Fonts를 로드. CSP가 없어 그대로다. 공급망·프라이버시(폰트 CDN) 표면. [확인]

---

## 8. 각도 5 — 아키텍처·데이터 정확성·성능

### 8.1 점수 이중 출처 [확인]

목록/지도 후보: `currentVotes` +1/−1 합. 상세: `getLatestRatingSnapshot` 없으면 v1 fallback. 목록은 `invalidated_vote_events`를 조인하지 않는다. 조작 무효화가 목록 %에 안 먹을 수 있다.

스냅샷 9개 vs current_votes 114 — 대부분 장소는 목록 v1·상세 v1 fallback.

### 8.2 primary 카테고리 [확인]

공개 조건 `isPrimary = true` innerJoin. primary 없는 장소는 목록에서 사라짐. 재-import는 신규 쌍만 primary true. 이전 primary를 false로 내리는 문이 없다 → 중복 마커 가능.

공개 시 `place-review-publication.server.ts:70-72`는 기존을 false로 내린 뒤 새 primary를 넣는다. **검수 공개 경로만 안전**하고 CSV/upsert 경로는 그렇지 않다. [확인]

### 8.3 병합 [확인]

투표/저장/슬러그 리다이렉트는 옮긴다. `ratingSnapshots` / flavor / golden / daily metrics / liveness / review work items는 이관하지 않는다. 재계산 enqueue도 없다.

`getLatestRatingSnapshot`은 `computedAt` 최신 1행만 고르고 `isStale=false`를 요구하지 않는다. 되돌리기 후 재계산 전이면 상세가 stale 숫자를 보여준다 (ARC-04).

같은 값 재클릭도 `eventType: "CHANGE"`를 쌓아 24시간 5회면 `REPEATED_VOTE_CHANGE` (ARC-08).

후보 목록은 여전히 `limit(300)` (`candidate.server.ts:54`). 일괄 승인만 `BULK_LIMIT=25`로 줄었다 (ARC-05 PARTIAL).

카테고리 칩 숫자는 전역 PUBLISHED 집계, 지도/목록은 bbox (ARC-09). 공개 2곳이면 칩>0인데 현재 뷰 0곳이 재현되기 쉽다.

NAVER SDK 로드 실패는 모듈 promise를 비운다. 세션 영구 잠금은 해소 (ARC-10 FIXED).

### 8.4 검수 파이프라인 [확인]

5단계 + 탭. `#186`으로 2단계 advance 허용, ready=좌표 있음. 라이브: VERIFIED 잔여 8 이동 성공. 1단계 708. 좌표 없는 공공데이터는 지오코딩 대상이 아님(제안 카드만). 이 오딧은 615곳 지오코딩을 권고하지 않고 **게이트 전 처리량 문제**로만 기록한다.

Codex P1(직접 advance 시 fingerprint 재검사 없음)은 코드 의도와 같음. 재호출 없이 VERIFIED를 옮기는 것이 `#185` 요구였다.

### 8.5 스키마 [확인]

`schema.ts` sqliteTable 60+ · 라이브 테이블 목록과 대응. `rate_limit_windows` 존재. AI 사용 테이블은 원격 목록에 없음(`0031_remove` 적용).

`0031` 두 파일은 적용 순서가 v5 프로필 → AI 제거 → `0032`… 동작은 됐지만 순번 규율(COWORK §5)이 흐려졌다.

### 8.6 크론 [확인]

`17 18 * * *`에 후보 동기화·평가·장소·주차·온보딩 수명 5개를 `Promise.all`. Paid라도 한 작업 실패가 형제로 번진다. 외부 알림 없음.

### 8.7 성능 [확인]·[추론]

Paid 이후 검수 GET 200. 로더 비용은 남음: 검수 3단 조인, 운영 대시보드 창 3×질의 10, 감사 병렬. Liveness 탭 ~1000행은 오전에 324KB로 관측. Free로 내리면 다시 10ms에 죽음. 코드는 Free를 가정하지 않게 쪼개지지 않았다.

홈은 `home-recommendations` 리소스로 분리됨. 공개 홈 200 0.7s대(오전 배포 스모크).

### 8.8 잘 된 설계 [확인]

- 투표 append-only + 스냅샷
- 지역 팩 단일 모듈
- 메일 rate limit 해시 버킷(이메일을 테이블에 평문 저장하지 않음)
- NAVER 일일 한도 fail-closed
- 검수 intent 카탈로그 + 화면 400
- 통합 테스트가 운영 wrangler를 직접 안 읽음

---

## 9. 각도 6 — 보안·AuthN/Z·남용

### 9.1 AuthZ [확인]

관리자·회원 가드 누락 0(확인 범위). 세션은 D1 opaque id, HttpOnly, SameSite=Lax, 7일. IDOR: `my-suggestions`는 `userId` 필터. 리뷰어 평가는 `requireUser` 후 본인 프로필.

`upsertBetaUser`는 테스트/시드용. 라우트 0. ADMIN은 `ADMIN_EMAIL` 일치 시에만.

### 9.2 AuthN [확인]

이메일+비밀번호(PBKDF2 99999, 타이밍 안전 비교) + Google/Naver OAuth. 로그인은 실패 시에도 KDF를 사용자 있을 때만 돈다 — 없는 이메일은 빠른 실패(열거+CPU 비대칭). [확인]

로그인에 메일/IP 한도 없음. 스터핑과 CPU 증폭은 08-07과 같은 문. 메일은 시간당 이메일 3 / IP 10.

### 9.3 토큰 [확인]

30분, SHA-256 저장, 소비 시 `consumedAt` IS NULL 조건. 원자적 `RETURNING`/`changes` 없음. URL `?token=` (이메일 프리페치·로그·Referer). GET verify-email이 소비.

재설정 후 기존 세션 유지.

### 9.4 CSRF [확인]

Same-origin은 검수 POST만. `admin-operations` 알림 해결, `admin-data-sync` 동기화, `admin-ratings`, `admin-reviewers`, `admin-import`, 회원 vote/save는 Origin 검사 없음. 쿠키 SameSite=Lax가 기본 방어. 크로스사이트 POST는 현대 브라우저에서 제한되나, 같은 사이트 취약 페이지·느슨한 임베드는 남는다. [추론(영향)]

### 9.5 XSS/SQLi [확인]

React 기본 이스케이프. Drizzle 파라미터. `app/`에서 `dangerouslySetInnerHTML`·`innerHTML`·`document.write` **0건**. 지도 마커는 08-07과 같이 DOM API. XSS 표면은 사실상 없다. [확인]

### 9.6 헤더 [확인]

`workers/app.ts`는 헤더를 더하지 않음. 라이브 CSP/HSTS/XFO/nosniff/Referrer-Policy 없음. `reviewer-photo`만 `X-Content-Type-Options: nosniff`.

### 9.7 남용 메일 [확인]

가입·재설정·정정은 한도 후 발송. 정정은 미로그인 가능. 한도 안에서는 여전히 임의 주소로 확인 메일이 간다. SEC-02는 완치가 아니라 상한이다.

---

## 10. 각도 7 — 개인정보·법적·공급망

### 10.1 방침 vs 사실 [확인]

`privacy.tsx`는 **출시 전 검토본**(2026-08-05). 약속: 위치 서버 미저장, 탈퇴 시 삭제, 접수 채널은 출시 전 공개, 운영자 연락처 미정.

사실: bbox·온보딩 좌표가 URL/loader로 서버에 옴. 탈퇴 구현 0. Resend·Google/Naver OAuth·NAVER 검색·지도 CDN·jsDelivr 폰트가 위탁 표에 없음. `head_sampling_rate: 1`.

인벤토리(`docs/legal/privacy-data-inventory.md`)는 게스트 세션·제품 이벤트를 반영했으나 **출시 차단 항목 6줄은 그대로 미해소**다. 처리방침 본문은 인벤토리보다 뒤처진다.

### 10.2 관리자 화면의 이메일 [확인]

`admin-places.tsx:20` `{loaderData.user.email}`. 스크린샷·공유 시 운영자 식별자 노출. 위키/이슈에 옮기지 말 것.

### 10.3 공급망 [확인]

직접 runtime 9, dev 14. high 2는 **dev**(miniflare undici, vite nanoid). 런타임 도달로 올리지 않음. 08-07 SEC-12와 같은 등급.

거버넌스 문서 `docs/decisions/2026-08-10-tech-stack-governance.md`는 여전히 **PROPOSED**.

### 10.4 공개 저장소 [확인]·[추론]

`#182`: Private 요청은 “비밀값”이 아니라 사업 문서·오딧 지도 노출. Private는 Free에서 branch protection을 잃을 수 있음. 지금 `main` 보호는 이미 0. Private만으로 이 오딧의 P0는 닫히지 않는다.

---

## 11. 각도 8 — 테스트·CI·운영·release readiness

### 11.1 테스트 규모 [확인]

| 층 | 파일 | 이번 실행 |
|---|---:|---|
| unit | 128 | 805 PASS |
| integration | 71 | 미실행 |
| e2e | 19 | 미실행 |

커버리지 임계 없음. E2E는 로컬 QA 시드에 의존. CI는 unit+typecheck만.

### 11.2 배포 게이트 [확인]

`AGENTS.md`는 required checks 후 병합. 실제 required는 GitHub 보호가 없어 **강제되지 않음**. 사람이 CI 초록을 보고 머지하는 규율만 있음.

배포 런북의 최신 version 칸은 `7a10dd0` / `099d8361-…`까지. **`81a73e8` / `5f031bd2-…`는 런북 미기록.** 이 오딧은 런북을 고치지 않는다(별 PR).

### 11.3 운영 알림 [확인]

D1 `operational_alerts` OPEN 1. 외부 메일/페이지 없음. cron 실패는 로그·행에만 남는다.

### 11.4 Release readiness [확인]

08-07 체크리스트를 다시 적용하면:

| 항목 | 지금 |
|---|---|
| 단위 테스트 | PASS |
| 통합 | 존재, CI 밖 |
| E2E | 존재, CI 밖, 운영 id 복제 |
| typecheck | CI |
| 보안 헤더 | 실패 |
| 처리방침 사실 일치 | 실패 |
| 탈퇴 | 실패 |
| 공개 장소 규모 | 실패 (2) |
| rate limit (로그인) | 실패 |
| branch protection | 실패 |
| 관리자 검수 GET | 통과(Paid) |
| 관리자 2단계 이동 | 통과(`#186`) |

**공개 베타 NO-GO를 유지한다.**

---

## 12. 08-07 → 08-18에서 실제로 달라진 것

나아짐:

- CI 파일 생김
- 메일 rate limit
- 관리자 IA 복구, returnTo `/admin*`, 검수 화면 오류, 파이프라인 지표
- 감사 화면
- 홈 h1, 권역 밖 안내 `main` 흡수
- PlaceDetailSheet fetcher 분리
- Workers AI 제거
- Paid + 검수 GET 200 + 2단계 advance
- 지역 팩 단일화
- 통합 테스트가 운영 wrangler를 직접 안 씀
- `packageManager` 고정

그대로/악화:

- 로그인 한도·토큰 URL·탈퇴·헤더·SEO
- 공개 장소 2 (08-07 week1 CSV 20행보다 **공개분은 더 적음**. 숨김 646은 파이프라인에 갇힘)
- `/places` 온보딩 강제
- E2E가 운영 D1 id를 들고 있음
- `main` 보호 없음
- cron `Promise.all`
- 대비 AA 실패(쌍만 변경), hex 66→313, 홈 h1 2개

---

## 13. 권고 순서 (구현 승인 아님)

이 목록은 오딧이다. `PROPOSED`. 착수는 이슈 1 + PR 1.

1. **슬라이스 1** — E2E `database_id`를 운영과 다른 placeholder로. 새 D1 만들지 않음. (`#183`)
2. **로그인 rate limit** — 메일과 같은 창 테이블. 한도·메시지를 PR에 명시
3. **공개 카탈로그** — 300을 숫자로 닫거나 게이트를 명시적으로 낮추는 제품 결정. 615 지오코딩 일괄은 하지 말 것
4. **탈퇴 + 방침/인벤토리 동기화** — 익명화로 현 스키마에서 가능(08-07 SEC-05). 하드 삭제 아님
5. **토큰을 GET/쿼리에서 빼기** — POST 폼 또는 일회 fragment. 로그 샘플링 결정
6. **보안 헤더** — Worker `fetch`에서 CSP/HSTS/nosniff. 폰트 CDN을 헤더에 맞게
7. **CI에 integration** (E2E는 격리 후). `main` ruleset은 `#182`와 같이
8. **same-origin을 모든 admin POST에**
9. 목록 점수를 스냅샷/무효화와 맞추기
10. 관리자 셸·`#main`·이메일 미표시

하지 말 것: 두 번째 도시, KV/Queue/DO, Private만으로 보안 완료 선언, 운영 D1에 QA 시드.

---

## 14. 이 오딧이 실행하지 않은 것

통합/E2E/typecheck 재실행, CDP 반응형, 로그인 관리자 GET 재현, NAVER 추가 호출, 런북 배포 기록 PR, 위 권고의 구현. 대비·XSS grep·08-07 55건 파일 재오픈은 수행했다. ARC-12(schema↔migration FK 드리프트)만 라인 이동으로 **미재검증**으로 남긴다.

---

## 15. 08-07 55건 + 08-17 ADM 전수 상태

우선순위는 당시 표. 상태는 2026-08-18 `81a73e8` 기준.

### 15.1 08-07 55건

| ID | 08-07 P | 지금 | 한 줄 |
|---|---|---|---|
| SEC-01 | P0 | PARTIAL | 메일 한도 있음. 로그인 없음. PBKDF2 99,999 |
| SEC-02 | P0 | PARTIAL | 가입·재설정·정정 한도. 한도 안 임의 메일 가능 |
| SEC-03 | P0 | OPEN | `?token=` 3경로 + 샘플링 1 |
| SEC-04 | P0 | OPEN | 방침 “미저장” vs bbox URL/loader + 로그 1 |
| SEC-05 | P0 | OPEN | 탈퇴 라우트 0. FK restrict는 하드 삭제만 막음 |
| SEC-06 | P0 | PARTIAL | 인벤토리에 게스트 온보딩 추가. 위탁 표는 Cloudflare만. 차단 6줄 유지 |
| QLT-01 | P0 | PARTIAL | 로컬 `--persist-to`+시드. `wrangler.e2e.jsonc` 운영 id |
| QLT-02 | P0 | PARTIAL | CI typecheck+unit. integration/E2E/audit 없음 |
| ARC-01 | P1 | OPEN | 목록 `currentVotes` 합. 상세 스냅샷. 무효화 미조인 |
| ARC-02 | P1 | FIXED | load/save fetcher 분리 |
| ARC-03 | P1 | OPEN | re-import primary unset 없음. 공개 경로만 unset |
| SEC-07 | P1 | OPEN | `resetPassword`가 세션 삭제 없음 |
| SEC-08 | P1 | OPEN | `consumeToken` `changes` 미확인 |
| SEC-09 | P1 | OPEN | 라이브 보안 헤더 0. `reviewer-photo` nosniff만 |
| SEC-10 | P1 | OPEN | `EMAIL_NOT_VERIFIED` vs 일반 실패. 없는 이메일은 KDF 생략 |
| SEC-11 | P1 | OPEN | 상세 GET이 `recordPlaceDetailView` |
| UX-01 | P1 | PARTIAL | `/places*`·`/admin*`만. `/me` `/courses`는 `/` |
| UX-02 | P1 | OPEN | `signup.tsx:43` 메시지 있으면 Form 제거 |
| UX-03 | P1 | OPEN | OG 0, sitemap 404, 상세 title 고정, robots는 CF 기본 |
| QLT-03 | P1 | PARTIAL | 정정 try/catch+한도. 실패 시 `error.message` 노출 |
| QLT-04 | P1 | OPEN | 알림 D1만. 외부 채널 없음 |
| DOC-01 | P1 | OPEN | v2 스펙 `Tasted : IT` vs UI `Re:Taste` |
| ARC-04 | P2 | OPEN | latest snapshot이 stale 허용 |
| ARC-05 | P2 | PARTIAL | 목록 300 / 일괄 25 |
| ARC-06 | P2 | OPEN | 병합 후 재계산·flavor/golden 미이관 |
| ARC-07 | P2 | PARTIAL | 검수 action try/catch. 타 admin 그대로 |
| ARC-08 | P2 | OPEN | 동일 값 CHANGE |
| ARC-09 | P2 | OPEN | 카테고리 카운트 전역 vs bbox 결과 |
| QLT-05 | P2 | PARTIAL | 통합 `test-worker.ts` + `remoteBindings: false` |
| QLT-06 | P2 | OPEN | 런북 운영 D1 시드 지시 |
| QLT-07 | P2 | PARTIAL | AI 런북 삭제. week1 `npm`/`retaste-local` |
| QLT-08 | P2 | OPEN | `SESSION_SECRET` 요구 vs 미사용. 배포 SHA 칸 지연 |
| UX-04 | P2 | OPEN | aria-modal, 트랩 없음 |
| UX-05 | P2 | PARTIAL | OAuth·일부 admin만 `role=alert` |
| UX-06 | P2 | OPEN | 403=일반 ErrorBoundary |
| UX-07 | P2 | OPEN | `/maps/:slug` 좌표 버림. 홈 `locate()`는 권역 정책 사용 |
| UX-08 | P2 | OPEN | 새 쌍 3.98 / 3.90 |
| UX-09 | P2 | FIXED | h1 생김. 중복은 UX-18-01 |
| UX-10 | P2 | PARTIAL | admin 3경로 `#main` 없음 |
| UX-11 | P2 | OPEN | 토큰 0사용, hex 313 |
| UX-12 | P2 | OPEN | 스타일 3중 |
| DOC-02 | P2 | FIXED | `/admin/audit` |
| DOC-03 | P2 | OPEN | Better Auth / 매직링크 / 비밀번호 |
| SEC-12 | P3 | OPEN | undici dev |
| SEC-13 | P3 | PARTIAL | `upsertBetaUser` ADMIN 조건 완화, 라우트 0 |
| SEC-14 | P3 | OPEN | QA 시드 고정 세션, playwright `--local`만 |
| SEC-15 | P3 | OPEN | flavor 템플릿-장소 카테고리 미대조 |
| ARC-10 | P3 | FIXED | SDK 실패 재시도 가능 |
| ARC-11 | P3 | OPEN | 인증·정정 GET 소비 |
| ARC-12 | P3 | 미재검증 | schema↔migration FK. 이번 실행에서 라인 대조 안 함 |
| QLT-09 | P3 | OPEN | coverage 임계 없음 |
| QLT-10 | P3 | PARTIAL | `packageManager` 고정. 런북 `pnpm deploy` 표기는 별도 |
| UX-13 | P3 | OPEN | 8–11px 클러스터 |
| UX-14 | P3 | OPEN | 상세 시트 animation 예외 |
| UX-15 | P3 | OPEN | welcome·hero CSS 미사용 |

### 15.2 08-17 ADM

| ID | 지금 | 한 줄 |
|---|---|---|
| ADM-IA-01 | FIXED | 제안 승인 카드. E2E가 초안 승인 경로를 단언 |
| ADM-IA-02 | FIXED | 재검증·정정·병합 탭 + E2E 전환 |
| ADM-OPS-01 | SUPERSEDED | 원격 `0034` 적용. 코드 의존은 유지 |
| ADM-OPS-02 | SUPERSEDED | Paid. 검수 GET 200 |
| ADM-AUTH-01 | FIXED | `returnTo` `/admin*` |
| ADM-ERR-01 | FIXED | 검수 mutation 화면 400 |
| ADM-ERR-02 | OPEN | 403 화면 문구 미분리 |
| ADM-IA-03 | OPEN | `/admin` 404, 셸 없음 |
| ADM-OBS-01 | PARTIAL | `PLACE_REVIEW_*` + 레거시 칸 |
| ADM-TEST-01 | PARTIAL | 현 IA E2E 있음. 공개 파이프라인·격리 없음 |
| ADM-SEC-01 | OPEN | same-origin 검수 POST 1곳 |
| ADM-UX-01 | OPEN | places 목록 상한·empty·`#main` |
| ADM-UX-02 | OPEN | data-sync 검증·오류 UI 없음 |
| ADM-AUD-01 | OPEN | `sourceCommit: "runtime-unversioned"` |
| ADM-OPS-03 | FIXED | 운영 계정 SSOT |
| ADM-OPS-04 | OPEN | cron `Promise.all` 5작업 |

### 15.3 라이브 헤더 덤프 (2026-08-18 00:29 UTC, 익명, 리다이렉트 비추적)

공통: `HTTP/2`, `server: cloudflare`, `cf-ray`, `date`. HTML 경로는 `nel`/`report-to`/`alt-svc: h3`. **앱이 넣는 보안 헤더 없음.**

| 경로 | 상태 | Location / 비고 |
|---|---|---|
| `/` | 200 | HTML 12,400 B, h1×2 |
| `/privacy` `/login` `/courses` | 200 | |
| `/robots.txt` | 200 | CF content-signal 문구. `User-agent`/`Disallow` 앱 규칙 없음 |
| `/sitemap.xml` | 404 | |
| `/places` | 302 | `/onboarding/taste?returnTo=%2Fplaces` |
| `/admin` | 404 | |
| `/me` | 302 | `/login?returnTo=%2Fme` |

---

# Eight-angle full audit (English)

**Date:** 2026-08-18 · **Code:** `81a73e8` · **Live Worker version:** `5f031bd2-c34e-4191-8d1f-656fdc4d46a0`  
**Issue:** #187 · No product-code changes. No secrets/PII.

**Verdict: HOLD.** Internal unit quality GO (805 tests). Logged-in admin review is conditional GO (Paid, pipeline IA restored, step-2 advance verified). Invite beta HOLD. Public beta and production **NO-GO**.

**Why NO-GO (confirmed):** 2 PUBLISHED places vs a ~300-place gate; 708 items still in source review; login has no rate limit while PBKDF2 is 99,999 iterations; tokens still travel in query strings with 100% log sampling; no account-deletion route; privacy policy still claims location is not sent to the server; E2E config copies the production D1 id; CI does not run integration/E2E; `main` has no branch protection; no security headers; no sitemap/OG.

**Re-opened from 2026-08-07 (was unchecked this morning):** contrast still fails AA on new pairs (3.98 / 3.90); design tokens unused and hex count rose to 313; three style sheets; `/maps/:slug` still drops geolocation; vote CHANGE-on-same-value and stale-snapshot selection remain; bulk approve is 25 but the candidate window is still 300; flavor templates are not bound to the place category; docs still say `Tasted : IT` / Better Auth / magic link. **Fixed since 08-07:** ARC-02, ARC-10, UX-09, DOC-02. **New:** two `h1`s on the curated home (UX-18-01).

**Improved since 2026-08-07:** CI exists; mail rate limits; admin suggestion/liveness/merge tabs; admin `returnTo`; review actions return 400 instead of 500; audit page; home `h1`; location-outside-region on `main`; split fetchers on the place sheet; Naver SDK retry after failure; Workers AI removed; Paid + live review GET; region pack module.

**Do not treat this document as implementation approval.** Next work is one issue + one PR per slice, starting with E2E database id isolation.
