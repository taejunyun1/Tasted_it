# Re:Taste 제품·디자인·기술 풀 오딧 및 개선 제안

작성일 2026-08-07 · 요청 REQ-20260807-001 · 구현 역할 provider `claude` · 작성 role-run-id `e40bf420-b58e-4082-8ea2-cd6487214616` · 재검증·확정 role-run-id `19d29789-2020-40f6-8a80-b1d1bb3aadd9` (라이브 실측 재현·표본 라인 검증·계산값 재계산 완료, 정정 1건: app.css 45,749→45,751 bytes) · 1차 독립 리뷰 반영 보완 role-run-id `6a0d0eb1-0414-4697-9d02-dd52fa9aa855` (차단 항목 7건 반영: §13 finding 55건 전건 상세화, SEC-05 사실 판정 교정, SEC-03 처방 교체, §12 로드맵 55건 1:1 매핑, SEC-01·SEC-02 심각도 교정, §9 화면 계약 보완, 라이브 기준선 재실측 — CDP 27조합 재확인, DOC-01 인용 라인 정정 :20→:1·:19)

---

## 1. 감사 기준선, 확인 날짜, 범위와 제외 범위

### 1.1 기준선 (두 개의 서로 다른 기준선이며 같다고 가정하지 않는다)

| 기준선 | 대상 | 무엇을 판정하는가 |
|---|---|---|
| **코드 SSOT** | `docs/audits/.audit-source.cxo3js` — `origin/main@a4b76aa`의 읽기 전용 스냅샷, 추적 파일 276개(비밀·빌드 산출물·로컬 환경 파일 제외) | 모든 `파일:라인` 인용, 스키마·마이그레이션·테스트·문서 판정 |
| **브라우저 라이브** | `http://127.0.0.1:5173` (= `localhost:5173`) — **미병합 PR #41 head `406b1b3`** | 렌더 결과, 지오로케이션 폴백, 응답 헤더, 세션 fixture 존재 여부 |

두 기준선은 **같지 않다.** 라이브에서 관측된 동작이 `main`에 있다고 서술하지 않으며, 차이는 §1.3에 델타로 분리했다.

확인 날짜: **2026-08-07** (코드 판독, 라이브 실측, 외부 공식 자료 조회 전부 동일 일자).

### 1.2 라이브 서버 실측 사실 (2026-08-07 직접 측정)

- `GET /` → 200, SSR HTML 12,341 bytes, `<title>Re:Taste — 내 주변 맛 지도</title>`.
- Chrome headless(CDP) 375 / 768 / 1440 px에서 공개 경로 9개 × 3폭 = **27회 렌더 실측 완료**. 전 조합 `scrollWidth - clientWidth = 0` (가로 오버플로 0건), 콘솔 error 0건, hydration mismatch 0건.
- `robots.txt` → **404**, `sitemap.xml` → **404**.
- 응답 헤더에 보안 헤더 **0개** (`connection`, `content-type`, `date`, `keep-alive`, `transfer-encoding`, `vary: Origin`만 존재).
- PR #41 서버 DB에 QA 세션 fixture **부재 확인**: `GET /me` + `Cookie: retaste_session=qa-admin-session` → **302 → `/login?returnTo=%2Fme`** (익명 요청과 동일 응답). E2E 26 FAIL의 원인 가설을 직접 재현한 값이다.
- 접속 주소: dev 서버는 `pnpm dev --host 127.0.0.1`(playwright.config.ts:20)로 IPv4에 바인딩된다. `localhost`가 IPv6(`::1`)로 먼저 해석되는 환경에서는 연결이 거부될 수 있으므로 재현·검수 시 **`http://127.0.0.1:5173/`을 사용**한다(이번 보완 실행에서 두 주소 모두 200 확인, 단 환경 의존).
- 보완 실행(role-run-id `6a0d0eb1…`, 2026-08-07)에서 27조합 CDP 실측을 재재실행해 동일 결과를 확인했다: 오버플로 0건, 콘솔 오류 0건, OG·canonical 0건, 랜딩 `h1` 3폭 모두 null, 장소 상세 title 3폭 동일. 라이브 기준선은 이 시점에도 유지 중이다.

### 1.3 PR #41 대기 중 델타 (라이브에서만 확인 가능, `main`에는 없음)

PR #41 "2026-08-07 위치 기본 복귀 및 카테고리 줌 안정화" — 상태 **open, 미병합**, head `406b1b3`, 변경 파일 6개(GitHub API 조회, 2026-08-07).
변경: `app/components/map/PlaceMap.tsx`(+44/−25), `app/features/maps/location-policy.ts`(신규 +32), `app/routes/home.tsx`(+10/−5), e2e 2개, unit 1개.

CDP로 지오로케이션을 주입해 라이브에서 직접 측정한 결과:

| 시나리오 | 좌표 | "내 주변" 클릭 후 URL | 지도 zoom | 화면 status |
|---|---|---|---|---|
| 권역 밖 | 서울 37.5665, 126.978 | `?bbox=126.72,35.03,127.02,35.25` (**광주 기본 bbox 복귀**) | 12 유지 | "현재 위치는 전라남도 범위 밖에 있습니다." |
| 권역 안 | 광주 35.1531, 126.8877 | `?bbox=126.8627,35.1351,126.9127,35.1711` | 14로 이동 | 없음 |

**이 두 동작은 PR #41에서만 확인된다.** `main`(스냅샷)의 `home.tsx:47-56` `locate()`는 좌표를 무조건 bbox로 만들고 오류 콜백이 없으며, 권역 밖 안내 문구도 없다. 즉 **권역 밖 안내와 기본 복귀는 아직 `main`에 없는 개선이다.**

한편 **광주 기본 지도 자체는 `main`에도 이미 있다**: `app/features/maps/map-state.ts:1` `DEFAULT_BBOX = [126.72, 35.03, 127.02, 35.25]`, `app/components/map/PlaceMap.tsx:61` 초기 center `LatLng(35.1595, 126.8526)`. PR #41이 새로 만든 것은 "권역 판정 + 밖이면 되돌리기 + 안내"이지 "광주 기본값" 자체가 아니다.

### 1.4 범위

**포함** — 제품 정의·구현 단계·문서 정합성 / 아키텍처·데이터 정확성 / 보안·개인정보·법적 경계·공급망 / 테스트·CI·성능·운영 readiness / UI·UX·접근성·반응형·탐색성 / 공식 1차 자료 기반 기술 대안 비교.

**제외(수행하지 않음)** — 코드·테스트·lockfile·migration·설정·스냅샷 어떤 파일도 수정하지 않았다. 실행 중인 서버를 종료·재시작하지 않았다. 원격 D1·Workers AI·이메일 발송·배포를 실행하지 않았다. `.dev.vars`는 스냅샷에 부재(정상)이며 비밀값·계정 ID·이메일 실값을 이 문서에 옮기지 않았다. `pnpm test` 등 검증 명령은 재실행하지 않고 §1.5의 기수집 증거를 전제로만 사용했다. `refer/*.docx` 2건은 판독하지 않았다(존재만 확인).

### 1.5 전제로 사용한 기수집 검증 증거 (재실행하지 않음)

`pnpm test` 36파일 124테스트 PASS · `test:integration` 25파일 59테스트 PASS(Cloudflare 계정 조회·AI binding 원격 과금 경고, 종료 시 Vite 서버 10초 미종료 경고) · `typecheck` PASS · `build` PASS(클라이언트 주요 gzip 청크 58.63 kB / 27.73 kB, 서버 청크 약 957 kB, AI 클래스 청크 약 741 kB) · `pnpm audit --audit-level=high` FAIL(high 1, moderate 5) · `BASE_URL=http://localhost:5173 pnpm run test:e2e` 68 중 40 PASS / 26 FAIL / 2 SKIP.

### 1.6 증거 등급 표기 규약

모든 결론에 다음 중 하나를 붙인다.

- **[확인]** — 스냅샷 파일을 직접 열어 확인했거나 라이브에서 직접 측정한 값.
- **[추론]** — 확인된 사실에서 문서화된 동작·규칙을 근거로 도출했으나 실행 재현은 하지 않음.
- **[가설]** — 정황은 있으나 확인 수단이 없었음. 판단 근거로 쓰지 말 것.

자동 테스트 PASS, HTTP 200, 서버 프로세스 존재는 **제품·사람·프로덕션 승인이 아니다.** 이 문서 어디에서도 그 셋으로 승인을 선언하지 않는다.

---

## 2. Executive verdict

# HOLD

**정확한 release boundary:**

| 경계 | 판정 | 근거 |
|---|---|---|
| 내부 개발·기술 QA (로컬, 인증된 접근) | **GO** | 타입·빌드·단위·통합 전부 PASS, 도메인 로직 정합성 높음(§6.6) |
| 초대 기반 비공개 베타 (Cloudflare Access 등 접근 통제 하) | **조건부 GO** — SEC-01·SEC-02·QLT-01 해소 후 | 접근 통제가 남용 표면을 대부분 덮지만, 메일 발송(SEC-02)과 테스트 게이트(QLT-01)는 통제 밖이고, rate limit(SEC-01)은 통제 안에서도 비용 증폭을 남긴다 |
| **공개 베타 (외부 URL 공개, 임의 사용자 가입)** | **NO-GO** | P0 8건 전량 해소가 조건. 특히 공개 노출을 전제로 성립하는 SEC-01·SEC-02·SEC-03·SEC-04·SEC-06·QLT-01 |
| 프로덕션 정식 출시 | **NO-GO** | 위 전부 + **P1 14건 전량**. P1 각각의 완료 수단은 §12.6에 55건 전건이 1:1로 매핑돼 있다(PR-9~PR-18 + 결정 D-2) |

**HOLD의 핵심 사유 세 줄 요약**

1. **인증·메일 경로에 rate limit이 리포지토리 어디에도 없다**([확인] `app/`·`workers/` 전체 grep 0건, `wrangler.jsonc`에 `ratelimit` 바인딩 없음). 동시에 비밀번호 KDF는 요청당 PBKDF2 99,999회를 돈다. 무제한 시도 × 고비용 KDF = 크리덴셜 스터핑과 CPU 소진이 같은 문으로 들어온다.
2. **처리방침이 사실과 다르다.** `app/routes/privacy.tsx:12`는 위치를 "서버에 저장하지 않습니다"라고 단언하지만, 위치는 URL `bbox` 쿼리로 서버에 전송되고 `wrangler.jsonc:21-24`의 `head_sampling_rate: 1`이 전 요청을 로깅한다. 개인정보 인벤토리에 Resend 위탁·비회원 이메일·리뷰어 직업 정보가 빠져 있고, 회원 탈퇴는 라우트·서버 함수가 전혀 없다. FK `onDelete: "restrict"` 3곳은 사용자 행의 **하드 삭제**를 막지만, 방침이 약속한 삭제권은 익명화(사용자 행 UPDATE + 세션 삭제)로 현 스키마에서도 이행할 수 있다 — 막혀 있는 것은 물리 삭제이지 탈퇴 기능 자체가 아니다(§13 SEC-05).
3. **배포 게이트가 작동하지 않는다.** 프로젝트 자신의 배포 문서(`docs/operations/cloudflare-deploy.md:5`)가 "E2E 통과"를 게이트로 요구하는데, E2E는 구조적으로 통과할 수 없는 상태다(§8.1). CI 설정 파일은 저장소에 0건이라 `AGENTS.md:10-11`의 "required checks"를 강제할 수단도 없다.

**동시에 기록해야 할 사실:** 이 제품의 도메인 코어는 상당히 잘 만들어져 있다. 투표는 append-only 이벤트 소싱 + 프로젝션 + 보존형 무효화이고, 평가 v2의 상수(최소 8표, 리뷰어 가중치 30% 상한, 신뢰도 clamp)는 설계 문서와 코드가 상수 단위까지 일치한다. AI 비용은 규칙 우선 분류 → 30일 해시 캐시 → 뉴런 쿼터 90% 선제 차단의 3단 fail-closed로 통제된다. 권한 검사 누락 라우트는 29개 중 **0건**이며, IDOR도 없다. XSS·SQLi 표면은 사실상 없다. **HOLD는 "제품이 나쁘다"가 아니라 "공개에 필요한 마지막 층(남용 방어·법적 고지·출시 게이트)이 비어 있다"는 뜻이다.**

---

## 3. 핵심 결함 요약 표

심각도는 공격 가능성 × 영향 × 도달 경로로 교정했다. dev 전용·도달 불가 항목은 명시적으로 강등했다. **우선순위(P0~P3)와 심각도는 별개 축이다** — P0는 "공개 전 반드시"라는 순서 판단이고, 심각도는 현재 증거가 뒷받침하는 위험 수준이다. 직접 인증 우회·대규모 데이터 노출·측정된 전면 장애 증거가 없는 항목에 Critical을 부여하지 않았다(§7.6 교정 기록).

### P0 — 공개 베타 차단

| ID | 결함 | 심각도 | 근거 위치 | 영향 | 상태 |
|---|---|---|---|---|---|
| SEC-01 | 인증·메일 엔드포인트 rate limit 전무 + 인증 전 PBKDF2 99,999회 | High | `app/routes/login.tsx:16-27`, `app/features/auth/password.server.ts:1`, `app/`·`workers/` grep 0건 | 크리덴셜 스터핑 시도 무제한, Worker CPU 비용 증폭 | 확인(부재)·추론(악용 규모) |
| SEC-02 | 미인증 사용자가 임의 주소로 메일 발송 유발 가능 | High | `app/routes/place-correction.tsx:4`(`to: result.email`), `forgot-password.tsx:8`, `signup.tsx` | Resend 쿼터 소진, 발신 도메인 평판 훼손, 원치 않는 메일 | 확인(경로)·추론(피해 규모) |
| SEC-03 | 인증 토큰이 URL 쿼리로 이동 + 전 요청 로깅 | High | `signup.tsx:19`, `forgot-password.tsx:8`, `place-correction.tsx:4`, `wrangler.jsonc:23` | 로그 열람자가 30분 유효 재설정 토큰 획득 → 계정 탈취 | 확인(로깅 범위는 추론) |
| SEC-04 | 위치 bbox가 서버 전송·로깅되나 처리방침은 "저장 안 함"으로 단언 | High | `app/routes/home.tsx:47-56`, `wrangler.jsonc:23` vs `app/routes/privacy.tsx:12`, `docs/legal/privacy-data-inventory.md:12` | 고지 사실 불일치. 위치정보 규제 노출 | 확인(규제 해석은 추론) |
| SEC-05 | 회원 탈퇴 미구현. FK `restrict` 3곳은 하드 삭제만 차단(익명화는 현 스키마로 가능) | High | 탈퇴 라우트 0건, `app/db/schema.ts:125-127, 393, 475` | 방침이 약속한 삭제권 미이행. 하드 삭제 선택 시에만 스키마 마이그레이션 필요 | 확인 |
| SEC-06 | 개인정보 인벤토리·처리방침 누락 다수(Resend 위탁, 비회원 이메일, 리뷰어 직업, 비밀번호) | High | `docs/legal/privacy-data-inventory.md` 6행 표, `privacy.tsx:9,11` vs `email.server.ts:10`, `schema.ts:23-24, 251-268, 495-507` | 출시 차단 항목 미해소(문서 스스로 정한 규칙 위반) | 확인 |
| QLT-01 | E2E 격리·프로비저닝 결함 — 배포 게이트가 통과 불가 | High | `playwright.config.ts:19-24`, 라이브 `GET /me` 302 실측 | 26 FAIL의 구조적 원인. 게이트가 신호를 못 냄 | 확인(라이브 재현) |
| QLT-02 | CI 설정 전면 부재 | High | 저장소에 `.github` 등 CI 파일 0건 vs `AGENTS.md:10-11` | 워크플로 규약을 강제할 수단 없음 | 확인 |

### P1 — 출시 직후 반드시

| ID | 결함 | 심각도 | 근거 위치 | 영향 | 상태 |
|---|---|---|---|---|---|
| ARC-01 | 목록·지도(v1 원시 카운트)와 상세(v2 스냅샷)의 점수 불일치 + 무효화된 투표가 목록에 계속 반영 | High | `app/features/places/place.server.ts:166-167` vs `app/routes/place-detail.tsx:40-48`, `recompute.server.ts:70` | 같은 장소가 화면마다 다른 %. 조작 무효화가 목록에 안 먹힘 | 확인 |
| ARC-02 | `PlaceDetailSheet`가 load·submit에 같은 fetcher 사용 → 저장 클릭 시 렌더 크래시 | High | `app/components/places/PlaceDetailSheet.tsx:8-9, 20, 34` + `place-detail.tsx:76` | 모바일 저장 시 전체 페이지가 오류 화면으로 대체 | 추론 |
| ARC-03 | 재-import 시 이전 primary 카테고리 미해제 → 목록·지도 중복 노출 | High | `place.server.ts:104-110, 300-306`, `publicConditions` `:118-121`, `drizzle/0000_week1.sql:50-55` | 장소가 2행으로 조회, 마커 중복 | 확인 |
| SEC-07 | 비밀번호 재설정이 기존 세션을 무효화하지 않음 | High | `app/features/auth/account.server.ts:74-80`, `session.server.ts:10` | 탈취자 세션이 최대 7일 유지 | 확인 |
| SEC-08 | 토큰 일회성이 비원자적(TOCTOU) | Medium | `account.server.ts:46-53` (affected rows 미확인) | 동시 요청 2건이 모두 성공 | 확인 |
| SEC-09 | 보안 헤더·CSP 전무 | Medium | `workers/app.ts:12-15`, `public/` 내 `_headers` 없음, 라이브 응답 헤더 실측 | 외부 스크립트·폰트 사용 구조에서 방어층 0 | 확인(라이브 실측) |
| SEC-10 | 로그인 계정 열거(문구 + 타이밍) | Medium | `app/routes/login.tsx:25`, `account.server.ts:63` | 가입 여부 확정 가능 | 확인 |
| SEC-11 | GET loader에서 지표 쓰기 → 크로스사이트로 배지 조작 | Medium | `app/routes/place-detail.tsx:32`, `rating-badges.server.ts:18-26` | Hidden Gem 판정 입력 오염 | 확인 |
| UX-01 | 로그인 `returnTo`가 전 구간 배선되어 있으나 항상 `/`로 이동 | High(UX) | `app/features/auth/login.ts:1-3` (전문 3줄, `return "/"`) | 투표/저장하려 로그인한 사용자가 맥락 상실 | 확인 |
| UX-02 | 회원가입 오류 시 폼 자체가 사라짐 | High(UX) | `app/routes/signup.tsx:28` | 검증 실패 = 재입력 불가, 새로고침 필요 | 확인 |
| UX-03 | 공개 페이지 SEO·공유 기반 전무 | High(사업) | OG·JSON-LD·canonical grep 0건, 라이브 `robots.txt`/`sitemap.xml` 404, `place-detail.tsx:79` 정적 title | 모든 장소 페이지 title 동일, 공유 미리보기·지역 검색 유입 불가 | 확인(라이브 실측) |
| QLT-03 | 이메일 발송 실패가 고아 레코드를 남김 + 내부 에러코드 노출 | Medium | `app/routes/place-correction.tsx:4` (insert 후 throw) | 검증 불가 PENDING 행 + `EMAIL_NOT_CONFIGURED` 화면 노출 | 확인 |
| QLT-04 | 운영 알림의 외부 통지 채널 없음 (03:17 KST cron 실패 무통지) | Medium | `app/features/operations/alerts.server.ts`, `admin-operations.tsx:12`, `workers/app.ts:17` | 야간 배치 실패를 능동 감지 불가 | 확인 |
| DOC-01 | 서비스명이 확정 문서 간 모순 (`Re:Taste` vs `Tasted : IT`) | Medium | `specs/2026-08-05-tastedit-product-direction-v2-design.md:1·:19` vs README·전 UI·법무 문서 | 브랜드 미결정 상태로 공개 진입 | 확인 |

### P2 — 성장 전 정리

| ID | 결함 | 심각도 | 근거 위치 | 상태 |
|---|---|---|---|---|
| ARC-04 | 투표 되돌리기 시 stale 스냅샷이 최신으로 선택 | Medium | `recompute.server.ts:103-108, 148-153` | 확인 |
| ARC-05 | 일괄 승인이 필터 없는 300건 윈도우로 재검증 | Medium | `candidate.server.ts:46`, `bulk-review.server.ts:136-149` | 확인 |
| ARC-06 | 장소 병합 후 rating 재계산 미트리거 + flavor/golden/메트릭 미이관 | Medium | `place-merge.server.ts:21-43` | 확인 |
| ARC-07 | 관리자·리뷰어 도메인 에러가 전부 500 화면으로 | Medium | `admin-place-operations.tsx:31-63`, `reviewer-ratings.tsx:44-45` | 확인 |
| ARC-08 | 같은 값 재투표가 CHANGE 이벤트를 쌓아 무고한 사용자를 조작 신호로 | Medium | `vote.server.ts:43-52`, `integrity.server.ts:44-46`(임계 5회) | 확인 |
| ARC-09 | 카테고리 카운트는 전역 집계인데 결과는 bbox 필터 → 눌러도 0곳 | Medium | `place.server.ts:207-218`, `home.tsx:81`, fitBounds 없음 | 확인 |
| QLT-05 | 통합 테스트가 프로덕션 `wrangler.jsonc` 재사용(AI binding·실 DB id 주입) | Medium | `vitest.workers.config.ts:13`, `wrangler.jsonc:12,17` | 확인 |
| QLT-06 | 운영 D1에 QA 시드 실행을 런북이 지시 | Medium | `docs/operations/week1-data-runbook.md:55` | 확인 |
| QLT-07 | 런북–코드 드리프트(AI 프롬프트 v1 vs v3, 100곳/500건 vs 10곳/뉴런쿼터, `retaste-local` DB, `npm` 사용) | Medium | `ai-operations-runbook.md:7,17-18`, `week1-data-runbook.md:24-27` vs `ai-classification.server.ts:12-13`, `ai-usage-policy.ts:1-2` | 확인 |
| QLT-08 | 배포 런북의 secret 목록이 낡음(`SESSION_SECRET` 요구, 실제 필요한 5종 누락) | Medium | `cloudflare-deploy.md:7,26-27` vs `cloudflare-env.d.ts`, README:22-29 | 확인 |
| UX-04 | 다이얼로그 포커스 트랩·복원 없음 (`aria-modal` 선언과 동작 불일치) | Medium | `PlaceDetailSheet.tsx:20`, `MapPlaceDetail.tsx:21` | 확인 |
| UX-05 | 폼 오류에 `role=alert`/`aria-invalid`/`aria-describedby` 없음(코드베이스 0건) | Medium | `login.tsx:33`, `reset-password.tsx:8`, `place-suggest.tsx:23`, `reviewer-apply.tsx:49` | 확인 |
| UX-06 | 403 전용 화면 없음 — 일반 회원이 관리자 경로 진입 시 "잠시 길을 잃었습니다" | Medium | `guards.server.ts:8-11` → `root.tsx:45` | 확인 |
| UX-07 | `/maps/:slug`의 "내 주변" 버튼이 좌표를 받고 버림 + 탭이 URL 상태 파괴 | Medium | `map-category.tsx:27`(`() => undefined`), `Link to="?view=map"` | 확인 |
| UX-08 | 대비 미달 2건(3.64:1, 3.26:1) | Medium | `app.css` `.place-image{color:#777}` on `#e8e8e3`, `.map-place-index{color:#8290a0}` on `#fff` | 확인(직접 계산) |
| UX-09 | 랜딩(`/`)에 `h1` 없음 — 라이브 3폭 전부 재현 | Medium | `home.tsx:70-104`, CDP 실측 `h1: null` | 확인(라이브 실측) |
| UX-10 | skip-link 대상 `#main` 누락 라우트 4개 | Low | `admin-candidates.tsx:166`, `admin-places.tsx:17`, `admin-import.tsx:91`, `admin-data-sync.tsx:22` | 확인 |
| UX-11 | 디자인 토큰 형해화 — `--s1~--s12` 사용 0회, 고유 hex 66종 산재 | Medium | `app.css` 직접 계수 | 확인(직접 계수) |
| UX-12 | 이중 스타일 시스템(Tailwind 유틸 vs 수제 클래스)로 같은 오류 배너가 두 구현 | Medium | `app.css:1` `@import "tailwindcss"`, `app.css:26` `.operation-error` vs `reviewer-apply.tsx:49` | 확인 |
| DOC-02 | 관리자 감사 로그 조회 화면이 P0로 선언됐으나 코드에 없음 | Medium | v2 design:364 vs `app/routes/` 전체 0건 (기록 write는 8개 모듈에 존재) | 확인 |
| DOC-03 | 인증 방식 3중 불일치(Better Auth / 매직링크 / 실제 이메일+비밀번호) | Medium | master design:84, decisions D-02:43 vs `signup.tsx`, `password.server.ts` | 확인 |

### P3 — 관측·기록

| ID | 결함 | 심각도 | 근거 위치 | 상태 |
|---|---|---|---|---|
| SEC-12 | 공급망 `undici` GHSA-4cwx-7wf7-3272 — **dev 전용, 런타임 미도달로 강등** | Low | `pnpm-lock.yaml` undici 7.28.0 ← miniflare ← wrangler/vite-plugin/vitest-pool-workers (전부 devDependencies) | 확인 |
| SEC-13 | 미사용 인증 우회 코드 `upsertBetaUser` 잔존 | Low | `app/features/auth/login.server.ts:15-47`(`role: "ADMIN"` 무조건 부여), 라우트 참조 0건 | 확인 |
| SEC-14 | QA 시드가 고정 세션 ID로 ADMIN 세션 생성 — dev 전용 | Low | `scripts/seed-admin-qa.sql:1-7`, 호출은 `playwright.config.ts:20` `--local`뿐 | 확인 |
| SEC-15 | Flavor Print 템플릿–카테고리 정합성 미검증 | Low | `flavor-print.server.ts:32-33` | 확인 |
| ARC-10 | Naver SDK 로드 실패가 세션 내 영구화(재시도 불가) | Low | `naver-map-sdk.ts:2` 모듈 레벨 promise | 확인 |
| ARC-11 | 이메일 인증·정정 토큰을 GET loader에서 소비(프리페치 소진) | Low | `verify-email.tsx:6`, `verify-correction.tsx:2` | 확인 |
| ARC-12 | schema.ts ↔ migration FK 드리프트 2건 | Low | `drizzle/0007:12`, `0002:1` vs `schema.ts:563, 61` | 확인 |
| QLT-09 | 커버리지 측정·임계값 설정 없음 | Low | `vitest.config.ts`, `vitest.workers.config.ts` | 확인 |
| QLT-10 | `pnpm deploy` 표기 오류(내장 명령 충돌) + `packageManager` 미고정 | Low | `cloudflare-deploy.md:35`, `package.json` | 확인(충돌은 추론) |
| UX-13 | 9–11px 초소형 타이포 클러스터 | Low | `app.css` `.brand span{9px}`, region small 9px, 시트 내 10px 다수 | 확인 |
| UX-14 | reduced-motion 커버리지 구멍 — `.place-detail-sheet` 애니메이션만 예외 | Low | `app.css:50` vs `:19, :47, :73` | 확인 |
| UX-15 | 죽은 CSS·미등록 파일(`app/welcome/welcome.tsx`, `.hero`·`.category-grid` 등) | Low | grep 참조 0건 | 확인 |

**집계: P0 8건, P1 14건, P2 21건, P3 12건 (총 55건).** 목록은 확인된 것만 담았고, 중복·파생 항목은 병합했다.

---

## 4. 구현 phase와 SSOT 현황

### 4.1 단계 체계가 셋이고 매핑 문서가 없다 [확인]

세 개의 "확정/승인" 상태 문서가 서로 다른 단계 체계를 쓴다.

| 체계 | 출처 | 단위 |
|---|---|---|
| 4주 웹 MVP (1~4주차) | `specs/2026-08-05-retaste-master-design.md` §7 | 주차 |
| 단계 1~9 | `specs/2026-08-05-tastedit-product-direction-v2-design.md` §13 | 제품 단계 |
| P0~P4 | 같은 문서 §14 | 다음 개발 순서 |

어느 것이 현행 기준인지 선언한 문서가 없다. 가장 최신 상태 기술은 v2 §12·§14다.

### 4.2 현재 위치 추정 [추론]

v2 기준 **"단계 1(운영 기반 안정화) 마무리 ~ 단계 2(광주 공개 베타) 진입 전"**. v2 §14의 P0 잔여 4건 중:

- Resend 운영 secret·왕복 검증 → 미완(v2 §12:254가 자인)
- 원격 D1 마이그레이션 + 권한 회귀 → 배포 구성은 존재(`wrangler.jsonc` 운영 DB·cron), QA 수행 기록 없음
- 공공데이터 반복 동기화 QA → 기록 없음
- **관리자 감사 로그 조회 화면 → 코드에 없음** (DOC-02)

데이터 규모도 미달이다. 단계 2 요건은 "검수된 광주 Place 300곳"인데 `data/week1-places.csv`는 **20행**.

### 4.3 진행 상태 소스로서 플랜 체크박스는 신뢰 불가 [확인]

22개 플랜 중 `[x]` 표시가 있는 것은 4개뿐이다. 코드가 완성된 영역도 미체크로 남아 있다 — `plans/2026-08-06-rating-foundation.md` 41개 전부 미체크인데 `app/features/ratings/rating-v2.ts`와 `drizzle/0005_rating_foundation.sql`이 존재하고, `plans/2026-08-05-reviewer-management.md` 25개 전부 미체크인데 `app/features/reviewers/*`가 완비돼 있다. 반대로 week1 beta 플랜의 Task 8 출시 게이트 4스텝(실데이터 CSV 검수, 법무 초안, secrets+deploy, `week1-beta` 태그)은 미체크인데 산출물 파일은 존재한다 — 미체크가 "산출물 없음"인지 "검수 미완"인지 구분할 수 없다.

### 4.4 결정 관리의 역전 [확인]

`docs/decisions/2026-08-05-next-product-decisions.md:23`은 "결정되지 않은 항목은 임의로 구현하지 않는다"를 명시 규칙으로 둔다. 그러나 확정 표는 **D-07(NAVER Maps) 1건뿐**이고, D-02(로그인 방식)·D-04(14세 미만)·D-01(공개 범위)은 결정 기록 없이 코드가 방향을 정했다. 문서가 요구한 후속 ADR 8종은 저장소에 없다.

D-02가 대표 사례다: master design은 Better Auth를, decisions는 매직링크를 권장했는데, 실제 구현은 이메일+비밀번호(PBKDF2)다. v2 §12가 이를 "완료"로 기술하며 사실상 결정을 덮어썼지만 decisions 문서는 갱신되지 않았다(DOC-03).

### 4.5 마이그레이션은 규율이 지켜졌다 [확인]

`drizzle/0000_week1.sql` ~ `0008_ai_usage_quota.sql` 9개가 문서 릴리스 단위와 정확히 대응한다(0005=rating foundation, 0006=place operations, 0007=AI operations, 0008=AI quota). COWORK §5의 "새 순번 추가, 기존 수정 금지" 규칙과 부합한다. 이 저장소에서 가장 잘 지켜진 규율이다.

### 4.6 SSOT 판정

| 문서 | SSOT 자격 | 사유 |
|---|---|---|
| `drizzle/*.sql` + `app/db/schema.ts` | **SSOT로 사용 가능** | 순번 규율 준수, FK 드리프트 2건은 경미(ARC-12) |
| `AGENTS.md` / `COWORK.md` | **SSOT로 사용 가능** | 규칙 자체는 명확. 다만 CI 부재로 강제력 없음 |
| `specs/*-master-design.md` | **부분** | 인증 스택(Better Auth) 등 폐기된 결정 잔존 |
| `specs/*-product-direction-v2-design.md` | **가장 최신이나 부분** | 서비스명 모순(DOC-01), 날짜 메타데이터 신뢰 불가(작성일 08-05인데 08-06 산출물 포함) |
| `docs/decisions/*` | **불가** | 확정 1건, 나머지는 코드가 앞서감 |
| `plans/*` 체크박스 | **불가** | §4.3 |
| `docs/operations/*` 런북 | **불가** | QLT-07·QLT-08 드리프트. 따라 하면 실패하는 명령 포함 |

---

## 5. 제품·UX·접근성·반응형 풀 오딧

### 5.1 제품 경계와 정의

**경계는 코드로 강제된다** [확인]. `app/features/candidates/public-data.ts:96-100`이 `GWANGJU`/`JEONNAM` region code만 허용하고, 리뷰어 활동 지역도 `reviewer-policy.ts:15`에서 두 값으로 제한된다. README:3, master design:22·41, week1 플랜:16이 일관되게 광주·전남을 선언한다.

다만 **"광주 우선" vs "광주·전남 동시"에서 문서 간 긴장**이 있다 [확인]. v2 design:12·26-28은 "초기 제품은 광주에 집중"이라 하는데, `data/week1-places.csv`에는 전남 화순 항목이 포함되고 리뷰어·후보 코드는 양쪽을 동등 취급한다. 초기 커버리지를 선언한 문서와 데이터·코드가 어긋난다.

**정의되지 않은 것** [확인]: 타깃 사용자상(persona)이 어느 문서에도 없다. 역할(Guest/User/Reviewer/Admin)은 상세히 정의됐지만 "지역민인가 방문객인가", "왜 쓰는가"는 없다. 성공지표는 이름만 나열되고(master §11) 목표 수치는 4주차 완료 기준의 "LCP 2.5초, 누락률 5% 이하"뿐이다. 측정 구현도 `recordPlaceDetailView`(상세 조회) 하나만 확인된다 — `place_daily_metrics`의 `directionClicks`·`saveActions` 컬럼을 채우는 코드는 찾지 못했다(§14 미검증).

### 5.2 라이브 렌더 실측 결과 (2026-08-07, CDP)

9개 공개 경로 × 375/768/1440px = 27 조합.

| 항목 | 결과 |
|---|---|
| 가로 오버플로 | **27/27 모두 0px** — 반응형 폭 처리는 실측상 문제없음 |
| 콘솔 error / hydration mismatch | **27/27 모두 0건** (경로당 로그 3건은 전부 비오류) |
| 랜드마크 (header/main/footer/nav) | 전 경로 4종 모두 존재 |
| skip-link + `#main` 대상 | 공개 경로 전부 존재·연결됨 (관리자 4개 라우트는 코드상 누락 — UX-10) |
| Naver SDK 로드 | `/`·`/maps/:slug`에서 `window.naver.maps` 로드 성공, `.map-error` 미노출 |
| 지도 마커 | `/`: 지역 클러스터 5개 렌더(zoom 12, 개별 핀 0개 — 클러스터 레벨이므로 정상). `/maps/korean`: 클러스터 0·핀 0 (해당 카테고리 데이터 없음) |
| 이미지 명시 치수 | 지도 경로 6개 이미지 전부 `width`/`height` 속성 없음 (CLS 위험, CSS 고정 컨테이너로 부분 완화) |
| meta description | `/`에만 존재. 나머지 8개 경로 전부 없음 |
| OG / canonical / JSON-LD | **27/27 전부 없음** |

**보호 라우트 동작 실측**: `/me`, `/suggestions/new`는 익명 접근 시 로그인 화면으로 정상 전환됐고 title이 "로그인 — Re:Taste"로 바뀌었다. 즉 `requireUser` 리다이렉트는 실제로 동작한다.

**title 누락 실측**: `/places`, `/signup`, `/maps/korean`은 라이브에서 `document.title`이 **빈 문자열**이다. `meta` export가 없는 라우트가 실제로 title을 잃는다는 코드 판정이 라이브에서 확인됐다(UX-03 연관).

### 5.3 Route-state inventory (29 라우트 전수)

SSR(`react-router.config.ts:7`)이므로 초기 로드는 서버 렌더. "loading"은 클라이언트 전환·제출 중 표시 여부. 라우트별 ErrorBoundary는 **0개**이며 `root.tsx:45` 전역만 있다. `shouldRevalidate`는 코드베이스 전체 **0건**.

| # | 라우트 | 대상 | loading | empty | error | 권한거부 | stale |
|---|---|---|---|---|---|---|---|
| 1 | `/` | 공개 | ✗ (지도 오류만 `role=status`) | ✓ 리스트 empty | 전역만 | — | ✓ URL 기반 재검증 |
| 2 | `/places` | 공개 | ✗ | ✓ 레일별+전체 | 전역만 | — | 기본 |
| 3 | `/maps/:categorySlug` | 공개 | ✗ | ✓ | 전역만 | — | 기본(단 탭이 상태 파괴, UX-07) |
| 4 | `/places/:placeSlug` | 공개+회원액션 | 투표만 ✓ | — | 404 ✓ / 액션오류 전역 | 인라인 로그인 링크 ✓ | ✓ `isStale` 노출 |
| 5 | `/privacy` | 공개 | — | — | 전역만 | — | — |
| 6 | `/terms` | 공개 | — | — | 전역만 | — | — |
| 7 | `/login` | 공개 | ✗ | — | ✓ 인라인(a11y 미비) | 로그인시 `/` ✓ | — |
| 8 | `/signup` | 공개 | ✗ | — | **폼 소멸**(UX-02) | — | — |
| 9 | `/verify-email` | 공개(토큰) | — | — | ✓ ok/fail | — | GET 소비(ARC-11) |
| 10 | `/forgot-password` | 공개 | ✗ | — | generic ✓ | — | — |
| 11 | `/reset-password` | 공개(토큰) | ✗ | — | ✓ 인라인 | — | — |
| 12 | `/me` | 회원 | ✗ | ✓ 저장·평가 각각 | 전역만 | redirect(returnTo 무력) | 기본 |
| 13 | `/suggestions/new` | 회원 | ✗ | — | ✓ 인라인 | redirect | — |
| 14 | `/me/suggestions` | 회원 | ✗ | ✓ | 전역만 | redirect | 기본 |
| 15 | `/corrections/new` | **공개** | ✗ | — | 원문 에러코드 노출 | — | — |
| 16 | `/corrections/verify` | 공개(토큰) | — | — | 전역만(전용 안내 없음) | — | GET 소비 |
| 17 | `/reviewer/apply` | 회원 | ✗ | — | ✓ 오류맵+상태패널 | redirect | 기본 |
| 18 | `/reviewer/ratings` | 리뷰어 | ✗ | 부분 | 전역만 | **403 generic** | action 후 redirect ✓ |
| 19 | `/reviewers/:slug` | 공개 | — | — | 404 ✓ | — | — |
| 20 | `/logout` | 회원 | — | — | — | GET 405 ✓ | — |
| 21 | `/admin/places` | 관리자 | ✗ | **✗ 빈 테이블** | 전역만 | 403 generic | 기본 |
| 22 | `/admin/import` | 관리자 | ✗ (이중 반영 위험) | — | ✓ `aria-live` | 403 generic | — |
| 23 | `/admin/candidates` | 관리자 | ✓ "처리 중…" | ✓ | ✓ AI 실패·쿼터 배너 | 403 generic | ✓ 필터 URL 반영 |
| 24 | `/admin/candidates/bulk` | 관리자 | — | — | — | 403 generic | — |
| 25 | `/admin/data-sync` | 관리자 | ✗ | ✗ | **✗ 실패 피드백 없음** | 403 generic | — |
| 26 | `/admin/reviewers` | 관리자 | ✗ | ✓ | ✓ 인라인 오류맵 | 403 generic | 기본 |
| 27 | `/admin/ratings` | 관리자 | ✗ | ✓ 섹션별 | 성공만 ✓ | 403 generic | 기본 |
| 28 | `/admin/place-operations` | 관리자 | ✗ | ✓ 섹션별 | 성공만 ✓ | 403 generic | 기본 |
| 29 | `/admin/operations` | 관리자 | ✗ | ✓ | 성공만 ✓ | 403 generic | — |

**표에서 비어 있는 칸이 곧 결함이다:** 클라이언트 pending 표시는 29개 중 **2곳**, 라우트별 error 처리 **0곳**, 403 전용 화면 **0곳**, 전역 내비게이션 로딩 인디케이터 **없음**.

### 5.4 접근성 (WCAG 2.2 관점)

**직접 계산한 명도 대비** (스냅샷 `app.css`의 실제 hex 조합, sRGB 상대휘도 공식):

| 조합 | 대비 | 판정 | 위치 |
|---|---|---|---|
| `#777` on `#e8e8e3` (12px/600 placeholder) | **3.64:1** | ✗ AA 미달 | `.place-image`, `.detail-hero` |
| `#8290a0` on `#fff` (11px/500) | **3.26:1** | ✗ AA 미달 | `.map-place-index` |
| `#777` on `#e8ebe4` | **3.72:1** | ✗ AA 미달 | 지도 캔버스 placeholder |
| `#6b6b6b` on `#fafaf8` (`--muted`) | 5.10:1 | ✓ AA | 전역 보조 텍스트 |
| `#617068` on `#f1f5ee` (9px) | 4.73:1 | ✓ AA (크기가 문제) | 지역 그룹 소제목 |
| `#111` on `#e7ff55` (`--signal`) | 16.93:1 | ✓ AAA | 선택 상태 |
| `#22543d` on `#e8f3e9` (`--accent`) | 7.67:1 | ✓ AAA | 카테고리 활성 |
| `#111` on `#fafaf8` | 18.07:1 | ✓ AAA | 본문 |

즉 **대비 미달은 3건이며 모두 "이미지 없음" placeholder 계열**이다. 팔레트 전반의 대비 설계는 오히려 양호하다 — 과장할 사안이 아니다.

**터치 타깃** (라이브 375px 실측, 24×24px 미만인 인터랙티브 요소):
- 전 페이지 공통: 헤더 `맛집 리스트`(59×18), `내 상태`(36×18) — **높이 18px**
- 홈/지도: 4개 요소가 10~23px 높이 (지도 SDK 컨트롤 포함 추정)
- 로그인/가입: 보조 링크 5~6개가 20px 높이 (`회원가입`, `비밀번호 재설정`, `이용약관`, `개인정보 처리방침`)

WCAG 2.2 SC 2.5.8(24×24 CSS px)의 "인라인 텍스트 링크" 예외에 걸리는 것도 있으나, **헤더 내비 두 항목은 인라인 텍스트가 아니라 주 내비게이션 타깃**이므로 예외 적용이 어렵다. 모바일 주 내비가 18px 높이인 것은 실사용 문제다.

**기타 접근성 관측:**
- ✓ skip-link + 전역 `focus-visible` outline이 Tailwind 페이지에도 적용됨 (`app.css:3`)
- ✓ 지도 마커가 실제 `<button aria-label="…지도 핀">` (`PlaceMap.tsx:147-152`), 클러스터도 버튼 + 개수 안내
- ✓ 지도의 비시각 대안(좌측 리스트 패널)이 상시 제공됨
- ✓ 지도 morph가 JS에서 `prefers-reduced-motion`을 존중 (`PlaceMap.tsx:169-175, 186-193`)
- ✓ `VoteControl`이 `aria-pressed` + `aria-live="polite"` + pending disabled — 이 코드베이스의 폼 접근성 모범
- ✗ 다이얼로그 포커스 트랩·복원·배경 inert 없음 (UX-04)
- ✗ 폼 오류의 SR 안내 부재 — `aria-invalid`/`aria-describedby` **코드베이스 0건** (UX-05). 예외는 `admin-import.tsx:112,147`의 `aria-live`뿐
- ✗ 랜딩에 `h1` 없음 — 라이브 3폭 전부 재현 (UX-09)
- ✗ `me.tsx:11`의 `<meter>`에 접근 가능한 이름 없음 (`place-detail.tsx:95`는 fallback 있음 — 비일관)
- ✗ `root.tsx:24-38`의 `<details>` 메뉴: Escape·외부 클릭 닫기 없고, `summary role="button"`이 네이티브 확장/축소 의미론을 덮어씀
- ✗ 모바일 홈 지도 뷰에서 `max-height:49px; overflow:hidden`으로 잘린 리스트 버튼들이 DOM에 남아 Tab 포커스가 시야 밖으로 이동 (`app.css:17`)

### 5.5 반응형

브레이크포인트는 760px 단일 + 관리자 1100px. 라이브 실측상 오버플로는 없다. 코드상 위험 지점:

- `calc(100vh - 236px)` 계열 매직넘버가 3곳(`app.css:3, :4, :22`). 홈만 `dvh`를 쓴다(`:17`) — iOS 주소창 변동에 취약하고 헤더 높이(78→64px) 변경 시 수동 동기화가 필요하다.
- 760px 미디어 블록이 `:20`(세로 스택)과 `:54`(가로 유지)로 **상호 충돌**하며 후자가 이긴다 — `:20`은 죽은 규칙이다.
- `.discovery-rail{grid-auto-columns:82vw}`(모바일)은 카드 하나가 화면을 거의 채워 다음 카드 힌트가 8vw뿐이다.

### 5.6 공개 탐색성(SEO/AI 검색)

라이브 실측 기준으로 **탐색성 기반이 전무하다.** `robots.txt` 404, `sitemap.xml` 404, OG·canonical·JSON-LD 27/27 전부 없음, `place-detail.tsx:79`가 모든 장소에 동일한 `"장소 상세 — Re:Taste"` title을 부여, `/places`·`/signup`·`/maps/:slug`는 title 자체가 빈 문자열.

지역 음식점 서비스에서 이것은 SEO 최적화 이전에 **공유 가능성의 문제**다. 카카오톡·메시지로 장소 링크를 보내면 미리보기에 상호명이 뜨지 않는다. 근거 없는 SEO 확장은 제안하지 않되(§9.7), 이 최소 탐색성은 제품 기능에 가깝다.

---

## 6. 아키텍처·정확성·데이터·성능 풀 오딧

### 6.1 loader/action 경계

29개 라우트 중 action 보유 18개, 나머지 11개는 loader 전용이다. 서버/클라이언트 분리는 `.server.ts` 접미사와 `cloudflare:workers` env import로 일관되게 지켜진다 — 클라이언트 번들에서 `proj4`·`csv-parse`가 새지 않는 이유이기도 하다(라우트의 public-data 참조는 전부 `import type`) [확인].

**경계 위반 2건:**

1. **GET loader가 쓰기를 수행한다** [확인]. `app/routes/place-detail.tsx:32`가 `recordPlaceDetailView`를 호출해 `placeDailyMetrics.detailViews`를 증가시킨다(`rating-badges.server.ts:18-26`, `onConflictDoUpdate` + `detailViews + 1`). 이 값은 Hidden Gem 배지 판정의 입력이다(`:35` `getHiddenGemStatus`). 결과적으로 ① 투표·저장 후 자동 재검증마다 +1 ② `PlaceDetailSheet`의 `detail.load()`마다 +1 ③ 봇·프리페치·제3자 사이트의 `<img src="/places/x">`마다 +1. 지표가 부풀고 배지가 조작 가능하다(SEC-11).

2. **인증 토큰을 GET loader에서 소비한다** [확인]. `verify-email.tsx:6`, `verify-correction.tsx:2`. 메일 클라이언트·보안 스캐너의 링크 프리페치가 사용자 클릭 전에 토큰을 소진시킨다 [추론]. `reset-password.tsx`는 POST 폼으로 올바르게 처리하므로 패턴이 일관되지 않다(ARC-11).

### 6.2 상태·캐시·재검증

`shouldRevalidate`가 코드베이스 전체에 **0건**이다 [확인]. 지도 pan/zoom은 400ms 디바운스 후 bbox를 URL에 쓰고, 그때마다 loader 전체가 재실행된다. `home.tsx:29-32`는 `listPlaces`와 함께 **bbox와 무관한 전역 카테고리 집계**(`listPublicCategoryGroups`, 3중 조인 + groupBy)를 매번 다시 돈다. 지도 탐색 한 세션의 D1 쿼리량이 불필요하게 크다.

`/places`는 더 심하다 [확인]: `place-list.tsx:19-23`이 `listPlaces`와 `getPlaceDiscovery`를 병렬 호출하는데, `getPlaceDiscovery` 내부가 다시 `listPlaces(db, {…limit:100})`를 실행한다. 동일 bbox에 대해 100행 GROUP BY 집계(votes leftJoin 포함)를 요청당 **2회** 수행한다.

**URL-as-state 자체는 잘 설계됐다** [확인]. `bbox`/`q`/`category`/`selected`/`place`가 전부 쿼리에 있고(`map-state.ts`, `home.tsx:45-68`), `parseMapState`가 한국 좌표 범위(경도 124~132, 위도 33~39)로 검증한 뒤 실패 시 광주 기본값으로 폴백한다(`map-state.ts:10-23`). 공유·뒤로가기가 안전하다. 다만 `/maps/:slug`만 이 규율이 깨져 있다 — `map-category.tsx:27`의 `<Link to="?view=map">`은 쿼리 전체를 치환해 `q`·`bbox`·`selected`를 날린다(UX-07).

### 6.3 데이터 정확성 — 가장 중요한 결함

**ARC-01: 화면마다 다른 점수** [확인]. 이 제품의 신뢰 서사 전체가 걸린 문제다.

| 화면 | 점수 출처 | 무효화된 투표 |
|---|---|---|
| 지도 마커 influence, 목록 카드, 디스커버리, 모바일 시트 | `place.server.ts:166-167`의 원시 `sum(case when value=1…)` + rating-v1 | **계속 포함됨** (`invalidatedVoteEvents` 조인 없음) |
| 장소 상세 | rating-v2 스냅샷 (신뢰도 가중, `recompute.server.ts:70`에서 무효표 제외) | 제외됨 |

같은 장소가 목록에서 82%, 상세에서 74%로 보일 수 있다. 더 심각한 건 **관리자가 조작 투표를 무효화해도(`integrity.server.ts:84-100`) 목록 %와 마커 크기에는 계속 반영된다**는 점이다. 조작 대응 기능이 공개 표면에서 절반만 동작한다.

**ARC-03: primary 카테고리 중복** [확인]. `place.server.ts:104-110`(import)과 `:300-306`(upsert)이 새 카테고리에 `isPrimary: true`를 넣으면서 **기존 primary를 false로 내리지 않는다**. `place_categories`에는 PK(place_id, category_id)만 있고 "장소당 primary 1개" 제약이 없다(`drizzle/0000_week1.sql:50-55`). `publicConditions`(`place.server.ts:118-121`)가 `isPrimary = true`로 필터하고 `.groupBy(places.id, categories.id)`로 묶으므로, primary가 2개면 **같은 장소가 카테고리별 2행으로 반환**된다. CSV로 카테고리를 바꿔 재-import하면 즉시 도달한다.

**ARC-04: 투표 되돌리기 시 stale 스냅샷 고착** [확인]. `recompute.server.ts:103-108`은 입력 해시가 같은 기존 스냅샷을 찾으면 `isStale`만 해제하고 `computedAt`을 갱신하지 않는다. 그런데 `getLatestRatingSnapshot`(`:148-153`)은 `isStale` 필터 없이 `computedAt desc`만 본다. A→B→A로 투표를 되돌리면 최신 계산 결과는 스냅샷1(오래된 timestamp)인데 로더는 스냅샷2(더 최신 timestamp, B 기준)를 계속 보여준다 — "새 평가 반영 중" 라벨을 단 채 잘못된 점수가 무기한 고정된다.

**ARC-06: 병합 후 재계산 미트리거** [확인]. `place-merge.server.ts:21-43`의 batch는 votes·saves·categories·links·suggestions·corrections·redirect를 옮기지만 `markRatingStale`/`enqueueRatingRecompute` 호출이 없다. 투표가 이동했는데 target의 기존 스냅샷은 `isStale=false`인 채 "검증된 최신 결과"로 표시된다. source의 `flavorRatings`·`goldenPickEvents`·`placeDailyMetrics`·`ratingSnapshots`는 HIDDEN 장소에 남아 소실된다.

**ARC-08: 같은 값 재투표가 조작 신호를 만든다** [확인]. `vote.server.ts:43-52`는 이전 값과 동일해도 무조건 CHANGE 이벤트를 기록한다(값 비교 없음). `VoteControl.tsx:18-19`의 버튼은 이미 누른 상태에서도 활성이다. 그리고 `integrity.server.ts:44-46`이 24시간 내 CHANGE **5회**면 `REPEATED_VOTE_CHANGE` 케이스를 만든다 — 같은 버튼을 다섯 번 누른 정상 사용자가 스스로 조작 검토 대상이 된다.

**참고 — 무결성 임계값이 코드에만 있다** [확인]. `integrity.server.ts`가 쓰는 임계는 신규 계정 10분 15표(`:38`), 동일 장소 CHANGE 24시간 5회(`:44`), 장소 10분 20표(`:46`), 비공개 장소 투표 24시간 3회(`:49`)다. **이 수치는 어떤 설계·운영 문서에도 없다.** 운영자가 임계를 알 방법이 코드 열람뿐이다.

### 6.4 D1·Drizzle

**트랜잭션 전략이 플랫폼 제약에 맞다** [확인]. 코드베이스에 `db.transaction`이 0건이고 전부 `db.batch`를 쓴다. Cloudflare D1 공식 문서(2026-08-07 직접 확인)는 이렇게 명시한다: *"D1 operates in auto-commit. Our implementation guarantees that each statement in the list will execute and commit, sequentially, non-concurrently. Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence."* 즉 batch가 이 플랫폼의 원자성 도구이며, 이 프로젝트는 그것을 정확히 쓰고 있다.

특히 `placeSourceLinks.businessLicenseId UNIQUE`(`schema.ts:215`) + batch 원자성 조합이 후보 동시 승인 경합을 실질적으로 안전하게 만든다(`candidate.server.ts:141-153`).

**인덱스는 대체로 조회 패턴과 맞는다** [확인]. 마이그레이션 9개에 인덱스 35개. 미비 2건:

- `vote_events`에 `createdAt` 인덱스가 없어 무결성 스캔이 매일 24시간 범위를 스캔한다(`integrity.server.ts:16`). `.limit(5000)`은 있으나 `orderBy`가 없어 **어떤 5000건인지 비결정적**이다.
- `places.latitude/longitude`에 인덱스가 없고, 검색이 선행 와일드카드 `LIKE '%…%'`(`place.server.ts:129-130`)라 `places_search_text_idx`를 타지 못한다. limit 100 + 베타 규모(수백 행)에서는 무해하지만 공공데이터 대량 승인 후 병목 후보다.

**FK 드리프트 2건** [확인]: `drizzle/0007:12`의 `cached_from_id REFERENCES ai_classification_runs(id)`와 `0002:1`의 `parent_id REFERENCES categories(id)`가 `schema.ts:563`·`:61`에는 없다. 런타임 영향은 없으나 drizzle-kit 재생성 시 diff가 난다.

### 6.5 scheduled / AI

크론은 단일 `"17 18 * * *"` = **03:17 KST** (`wrangler.jsonc:10`, 런북 `week1-data-runbook.md:37`과 일치) [확인].

`workers/app.ts:17`이 4개 작업을 `Promise.all`로 동시 실행한다. **개별 작업 최상위 try/catch가 없어**, 작업이 자체 알림을 기록하기 전에 던진 예외는 `operational_alerts`를 우회하고 Workers 로그에만 남는다. 외부 통지 채널이 없으므로(`admin-operations.tsx:12`가 "외부 이메일 알림은 운영 문의 주소 확정 후 연결합니다"라고 자인) **야간 배치 실패는 관리자가 대시보드를 열 때까지 아무도 모른다**(QLT-04).

공공데이터 동기화는 하루 1회 × 5페이지(약 500행) × 8개 작업 순환이다 [확인]. `scheduled-sync.server.ts:14-18`이 RUNNING 작업을 무조건 우선 재개하므로 대형 소스가 끝날 때까지 나머지 7개가 기아 상태다. `jobs[getUTCDate() % 8]`은 월 날짜(1~31) 기준이라 jobs[0]만 월 3회, 나머지는 4회로 불균등하다. 전체 신선도 주기가 수개월 단위다 [추론 — 실제 행 수 미확인].

**AI 비용 통제는 이 코드베이스에서 가장 잘 설계된 부분 중 하나다** [확인]:

- 규칙 분류가 HIGH 신뢰도면 AI 호출 자체를 생략(`ai-classification.server.ts:80-89`)
- 입력 해시 기반 30일 캐시(`:91-92`)
- 일일 뉴런 추정 + 90% 선제 차단(`ai-usage-policy.ts:1-2` — `AI_DAILY_FREE_NEURONS = 10_000`, `AI_DAILY_BLOCK_NEURONS = 9_000`, 보수적 Llama 3.1 8B 단가 상수 포함)
- 배치 10건, 동시성 3, `max_tokens 260`, `temperature 0`, JSON Schema + 서버측 근거 검증
- 쿼터 소진 시 침묵 실패가 아니라 `limited: true` 반환 + UI 배지·버튼 비활성

빈틈 2건: ① rule-only insert와 캐시 조회가 per-candidate try 블록 **밖**에 있어(`:81-92`) 여기서 throw되면 `mapWithConcurrency`가 배치 전체를 reject해 다른 runner 결과까지 버린다. ② 쿼터는 배치 시작 시 1회만 검사한다(`:44-45`) — 다만 9,000/10,000의 1,000 뉴런 마진이 한 배치 초과분을 흡수하도록 설계된 것으로 보인다.

### 6.6 잘 된 설계 (기록)

1. **이벤트 소싱 + 보존형 무효화** — `vote_events`는 append-only(DB CHECK `0000_week1.sql:62`), `current_votes`는 프로젝션, 무효화는 `invalidated_vote_events`로 원본을 보존하며 수행(`integrity.server.ts:84-100`). 설계 문서의 "관리자는 원시 투표와 계산 결과를 직접 수정하지 않는다"가 코드로 지켜진다.
2. **입력 해시 멱등성** — rating(`recompute.server.ts:102-108`), 리뷰어 신뢰도(`reviewer-trust.server.ts:66-70`), AI 캐시가 모두 입력 해시로 중복 계산·중복 과금을 회피한다.
3. **평가 수학의 문서–코드 상수 일치** — 최소 8표(`rating-v2.ts:2`), 리뷰어 가중치 30% 상한(`:3` + 근거 문자열 `REVIEWER_WEIGHT_CAPPED_30_PERCENT`), 신뢰도 `clamp(0.6, 1.4, 0.6+0.8×acc)`(`:70`), 유사군집 공통 10곳·일치 80%·`1/sqrt(k)` 감쇠(`reviewer-similarity.ts:53,55,73`), Golden Pick 월 3회·90일(`golden-pick.server.ts:32,37-38`).
4. **핫패스 쿼리 상한** — 공개 목록 100행 하드캡(`place.server.ts:176`), 동기화 5페이지, 재계산 25건. 무제한 쿼리가 핫패스에 없다.
5. **E2E용 QA 폴백** — `PlaceMap.tsx:196-228`이 clientId 없이도 `?qa=` 파라미터로 마커·클러스터를 DOM에 렌더해 SDK 없이 지도 로직을 테스트할 수 있게 한다.

### 6.7 성능

**빌드 청크** [추론 — 빌드 미실행]. 서버 957 kB·AI 741 kB의 정체는 `workers/app.ts:2-5`가 4개 scheduled 모듈을 정적 import하고, 라우트 서버 코드가 `ai-classification.server.ts → category-suggestion.ts → public-data.ts → proj4` 체인을 공유하기 때문으로 보인다. **클라이언트는 깨끗하다** [확인] — 라우트의 public-data 참조가 전부 `import type`이라 proj4·csv-parse가 브라우저로 가지 않는다. 클라이언트 gzip 58.63 + 27.73 kB는 랜딩 예산(150 kB) 안이다.

**CSS** [확인]. `app.css` 원본 45,751 bytes, 단일 파일. gzip 후 마이크로사이트 예산(15 kB)에 근접할 것으로 보이나 실측하지 않았다.

**모바일 INP/LCP/CLS 위험 지점** [확인 — 코드 근거]:

- `PlaceMap.tsx:120-163`의 effect 의존성이 `[clusters, map, places, selected]`라 **마커 하나를 선택할 때마다 최대 100개 DOM 마커를 전부 파기·재생성**한다. 상한 100이라 치명적이진 않으나 모바일 탭 반응성을 깎는다.
- `root.tsx:9`의 Google Fonts 렌더 블로킹 stylesheet(Noto Sans KR 3웨이트 + IBM Plex Mono 2웨이트). `preconnect`와 `display=swap`은 있으나 자체 호스팅·서브셋이 없다. 한글 폰트 특성상 swap 시점 재배치가 CLS·LCP에 영향을 준다.
- 라이브 실측상 지도 경로의 이미지 6개가 `width`/`height` 속성 없이 렌더된다. CSS 고정 컨테이너(`height:210px` 등 + `object-fit:cover`)가 대부분 완화하지만 명시 치수가 정석이다.
- `getMemberTasteGraph`(`flavor-print.server.ts`)가 추천 장소마다 `getPlaceFlavorPrint`를 개별 호출하는 N+1이다 — `/me` 지연이 투표 수에 비례한다.
- 공개 상세 페이지가 매 뷰마다 `listActiveGoldenPicks`(`golden-pick.server.ts:47` — WHERE 없는 전체 테이블 스캔 후 JS 필터)와 최대 1,000곳 피어 + 90일 메트릭 조회(`rating-badges.server.ts:41-45`)를 수행한다. 이벤트 소싱이라 테이블은 단조 증가한다.
- `reviewer-ratings.tsx:18-27`의 rows 쿼리에 `.limit()`이 없고, `listReviewerHotTakes`가 매 로드마다 `currentVotes` 50,000행을 읽어 JS에서 필터한다.

---

## 7. 보안·개인정보·법적·공급망 풀 오딧

### 7.1 AuthZ 전수 결과

**29개 라우트 전부를 검사했고 권한 검사 누락은 0건이다.** action 보유 18개 / action 없음 11개.

**IDOR 없음** [확인]. 사용자 스코프 리소스(vote, save, suggestion 조회)는 전부 `userId`를 세션에서 취하고 폼 입력을 신뢰하지 않는다. `place-detail.tsx:72,74`는 `userId: user.id`를 고정하고 `placeId`는 URL slug로 재조회한다. `my-suggestions.tsx:3`은 `where(eq(placeSuggestions.userId, user.id))`로 스코프가 정확하다.

`guards.server.ts`는 13줄뿐이지만(`assertRole`이 403 Response를 throw할 뿐), **feature 계층이 DB에서 actor 역할을 재조회해 독립 검증한다** [확인] — `place-correction.server.ts:55,75`, `place-suggestion.server.ts:59,80`, `place-revalidation.server.ts:20`, `place-merge.server.ts:7`, `integrity.server.ts:70,89`. 리뷰어 액션은 role 외에 프로필 `status === "ACTIVE"`까지 확인하고(`golden-pick.server.ts:24`, `flavor-print.server.ts:29`), 실제로 `changeReviewerStatus`가 비활성화 시 `users.role`을 `USER`로 되돌린다(`reviewer.server.ts:95`). 이 이중화가 얇은 guards 파일의 위험을 실질적으로 상쇄한다.

**구조적 구멍 2곳:**

- `/corrections/new`가 완전 미인증인데 메일 발송 능력을 준다 (SEC-02)
- `/admin/data-sync`의 `sourceType`·`addressField`가 zod 없이 타입 단언만 거친다(`admin-data-sync.tsx:14,18`) — 관리자 전용이라 위험은 낮지만 유일한 미검증 입력이다

### 7.2 AuthN

| 항목 | 구현 | 판정 |
|---|---|---|
| 세션 | DB 저장 불투명 세션(`crypto.randomUUID()`), TTL 7일, `HttpOnly` + `SameSite=Lax` + 조건부 `Secure` | 구조는 안전. `Secure`가 요청 프로토콜 조건부라 프록시 오설정 시 조용히 빠짐(`session.server.ts:103`) |
| 비밀번호 | PBKDF2-HMAC-SHA256, 99,999 iterations, salt 16B CSPRNG, 상수시간 비교(`password.server.ts:27-30`) | OWASP 권고(600k)의 1/6이나 **Workers 런타임 상한(100k)에 붙은 값**(`tests/unit/password.test.ts:5-7`이 명시). 코드 실수 아님 — 그래서 rate limit이 더 필수 |
| 토큰 | SHA-256 해시로만 저장, 32B CSPRNG, TTL 30분, 정정 토큰은 검증 후 `null` 소거 | 저장 위생 양호 |
| 계정 열거 | `/forgot-password`는 generic 응답 유지 ✓ / `/login`은 `EMAIL_NOT_VERIFIED` 별도 문구로 유출 + 미존재 시 KDF를 안 돌려 타이밍 차이 | SEC-10 |
| 미인증 계정 덮어쓰기 | `account.server.ts:36-42` — 인증 전 계정이면 displayName·passwordHash·salt·role을 통째로 덮어씀 | 가입 선점 벡터. 최종 탈취엔 메일함 접근 필요 |

### 7.3 CSRF·XSS·인젝션

- **CSRF**: `SameSite=Lax` 단일 계층. CSRF 토큰 0건, Origin/Referer/Sec-Fetch 검증 0건 [확인]. React Router 8은 CSRF 토큰을 기본 제공하지 않는다. Lax가 cross-site POST를 막으므로 현재 실효 위험은 중간이나, **같은 site의 다른 서브도메인이 생기는 순간 방어가 무너진다.**
- **XSS**: `dangerouslySetInnerHTML`·`innerHTML`·`document.write` **전체 0건** [확인]. 지도 마커도 `createElement` + `textContent` + `setAttribute`로만 조립한다(`PlaceMap.tsx:125-152`) — Naver InfoWindow의 innerHTML 관용구를 쓰지 않았다. 외부 링크는 `rel="noreferrer"` + `encodeURIComponent`. **표면이 사실상 없다.**
- **SQLi**: 전 쿼리 drizzle 파라미터 바인딩. `sql` 템플릿 사용 3곳 모두 컬럼 참조·상수만 보간하고 사용자 입력이 들어가지 않는다 [확인].
- **Open redirect**: `safeReturnTo`가 입력을 통째로 무시하고 항상 `"/"`를 반환한다(`login.ts` 전문 3줄) [확인]. 가장 안전한 형태이며, 부작용이 UX-01이다.

### 7.4 개인정보

**인벤토리 누락** [확인]. `docs/legal/privacy-data-inventory.md`의 표 6행에 다음이 없다:

| 누락 항목 | 저장 위치 | 왜 문제인가 |
|---|---|---|
| Resend 위탁·국외 이전 | `email.server.ts:10` `fetch("https://api.resend.com/emails")` | 처리자 열이 "Cloudflare"뿐. 인벤토리 스스로 ":15 이메일 도구 도입 시 같은 릴리스에서 갱신"을 규칙으로 둠 — 자기 규칙 위반 |
| 비회원 정정 요청 이메일 | `schema.ts:495-507` `requesterEmail` | 회원 계정과 무관하게 영구 저장. 보존·파기 기준 없음 |
| 리뷰어 직업(`occupation`) | `schema.ts:251-268` | 명백한 개인정보 항목 |
| 비밀번호 해시·솔트, 인증 토큰 | `schema.ts:23-24, 29-42` | 처리방침 §1은 "이메일, 표시 이름, 역할, 세션"만 열거 |
| 장소 제안 이력, 감사 로그, AI 실행 로그 | `schema.ts:473-491`, `adminAuditLogs`, `aiClassificationRuns` | 표에 없음 |

**SEC-04 — 위치정보 고지 불일치가 가장 무겁다** [확인 + 규제 해석은 추론].

`home.tsx:47-56`의 `locate()`는 지오로케이션 좌표로 bbox를 만들어 **URL 검색 파라미터에 넣는다**. 이후 모든 loader 요청이 그 bbox를 서버로 보내고(`home.tsx:26`), `wrangler.jsonc:23`의 `head_sampling_rate: 1`이 전 요청을 로깅한다. 즉 **사용자 반경 약 ±0.018°/±0.025°의 위치가 요청 URL로 100% 로깅된다.**

반면 `privacy.tsx:12`는 "Re:Taste 서버에 저장하지 않습니다"라고, 인벤토리 12행은 "현재 클라이언트 메모리… 서버에 저장하지 않으며"라고 단언한다. **사실관계가 다르다.** 한국 위치정보법 관점에서 개인위치정보를 서버가 수신·로그 보관한다면 별도 고지·동의와 이용·제공 사실 확인자료 보관 의무가 추가로 발생할 수 있다 [추론 — 법률 검토 필요].

**SEC-05 — 탈퇴 기능이 없고, 하드 삭제는 스키마가 막는다** [확인]. 탈퇴 라우트·서버 함수가 0건이다. `schema.ts`의 사용자 참조 3곳이 `onDelete: "restrict"`다 — `voteEvents.userId`(`:125-127`), `goldenPickEvents.reviewerUserId`(`:393`), `placeSuggestions.userId`(`:475`). 따라서 **투표나 제안 이력이 있는 계정의 물리 `DELETE`는 FK로 거부된다.** 그러나 이 제약이 막는 것은 하드 삭제뿐이다 — 이메일·표시 이름 익명화와 비밀번호 해시 제거는 사용자 행 `UPDATE`이고 세션 제거는 `sessions` 행 `DELETE`이므로, **익명화 방식 탈퇴는 현재 FK를 유지한 채 구현할 수 있다.** 처리방침(`privacy.tsx:14`)과 약관(`terms.tsx:14`)은 탈퇴권을 명시하고, 인벤토리 :22가 이미 "계정 탈퇴 접수 및 투표 이력 처리 정책 확정"을 출시 차단 항목으로 잡아뒀다. 결정이 필요한 것은 "익명화로 충분한가, 하드 삭제까지 제공하는가"이며 — 전자는 지금 착수 가능하고, 후자를 택할 때만 restrict 3곳의 마이그레이션과 과거 스냅샷 재현성 포기가 따라온다(상세와 수용 기준 분리는 §13 SEC-05).

**14세 미만** [확인]. 인벤토리 :15는 "14세 미만 아동 대상 수집을 하지 않는다"고 단언하지만 `signup.tsx`는 이름·이메일·비밀번호만 받고 연령 확인·차단 로직이 없다. 주장과 통제가 불일치한다.

**잘 된 부분** [확인]: `/privacy`·`/terms` 라우트와 전역 푸터 링크가 존재하고, 세션 7일 문구가 코드와 정확히 일치하며, 두 문서 모두 DRAFT 표기 + 기준 commit 고정 + "법률 자문 아님" 고지를 갖췄다. 위치 문구도 설계 의도(`week1` 플랜의 "never requests geolocation during mount")와는 삼자 일치한다 — 어긋난 건 로깅 경로다. 인증 실패 로깅은 `console.error("SIGNUP_FAILED", failure.logCode)`로 코드만 남기고 이메일·입력값을 남기지 않는다(`signup-failure.ts:5-7`) — 코드베이스 전체 `console.*` 호출이 이 1건뿐이다. **골격은 좋고, 문제는 갱신 주기다.**

### 7.5 공급망

**GHSA-4cwx-7wf7-3272 / CVE-2026-13697 — 공식 advisory 직접 조회(2026-08-07):**

- 제목: "undici vulnerable to cross-user information disclosure and parse-time crash via degenerate private cache directives"
- 심각도 **high**, 공개일 **2026-08-03**
- 영향 범위: `>= 7.0.0, < 7.29.0` (패치 **7.29.0**), `>= 8.0.0, < 8.9.0` (패치 **8.9.0**)

**유입 경로** [확인 — lockfile 그래프]: `undici@7.28.0` ← `miniflare@5.20260730.0-alpha` ← `wrangler` / `@cloudflare/vite-plugin` / `@cloudflare/vitest-pool-workers`. **세 진입점 전부 devDependencies**다. 프로덕션 Worker는 workerd 내장 fetch를 쓰며 `email.server.ts:10`의 `fetch`도 런타임 전역이다. → **런타임 미도달, Low로 강등**(SEC-12).

**단, 흔한 처방이 지금은 통하지 않는다** [확인 — npm 공식 레지스트리 직접 조회, 2026-08-07]:

| 패키지 | 최신 버전 | undici 의존 |
|---|---|---|
| `wrangler` | 4.119.0 (2026-08-05) | → `miniflare@5.20260801.0-alpha` |
| `miniflare` | 5.20260801.0-alpha (2026-08-05, **최신**) | **여전히 `undici@7.28.0`** |

**즉 wrangler를 최신으로 올려도 취약 버전이 그대로 따라온다.** 현 시점 실효 처방은 `pnpm.overrides`로 `undici@^7.29.0`을 강제하고 로컬 dev·테스트 회귀를 확인하는 것이며, 업스트림이 패치를 반영하면 override를 제거한다. dev 전용이므로 긴급도는 낮지만, **"wrangler 올리면 해결"이라는 통념은 오늘 기준 사실이 아니다.**

**의존성 최소성은 양호** [확인]. 런타임 dependencies 8개(`csv-parse`, `drizzle-orm`, `isbot`, `proj4`, `react`, `react-dom`, `react-router`, `zod`). lockfile v9 존재. 공급망 표면 자체가 작다.

**부수 관측**: `package.json:18`의 `postinstall: wrangler types`는 설치 시 스크립트 실행이라 `--ignore-scripts` 정책과 충돌할 수 있다(Low). `.dev.vars.example`은 `NAVER_MAPS_CLIENT_SECRET`(코드 참조 0건)을 포함하면서 실제 필요한 `RESEND_API_KEY`·`RESEND_FROM_EMAIL`·`APP_BASE_URL`이 빠져 있다.

### 7.6 심각도 교정 기록 (과장 방지)

다음 항목은 표면적으로 위험해 보이나 **의도적으로 강등했다**:

| 항목 | 흔한 오판 | 실제 판정 |
|---|---|---|
| `wrangler.jsonc:17`의 D1 `database_id` 커밋 | "비밀값 유출" | **Low** — 계정 스코프 리소스 식별자이지 크리덴셜이 아니다. 사용하려면 별도 Cloudflare API 토큰이 필요하며, Wrangler의 정상 사용 패턴이다 |
| NAVER Maps Client ID 클라이언트 노출 | "API 키 노출" | **Low** — 브라우저 지도 SDK의 정상 패턴. 단 네이버 콘솔의 서비스 URL 제한 설정이 전제이며 코드로는 검증 불가 |
| `undici` high advisory | "high = 출시 차단" | **Low** — dev 툴체인 전용, 런타임 미도달 |
| `scripts/seed-admin-qa.sql`의 고정 ADMIN 세션 | "백도어" | **Low(dev 전용)** — 호출 지점이 `playwright.config.ts:20`의 `--local`뿐. 다만 `--local` 누락 시 즉시 관리자 탈취이므로 스크립트 레벨 환경 가드 권장 |
| PBKDF2 99,999 | "약한 해싱" | **Medium** — 플랫폼 상한. 처방은 KDF 강화가 아니라 rate limit |
| SEC-01 rate limit 부재 | "Critical — 즉시 서비스 장애" | **High** — rate limit 부재와 인증 전 고비용 KDF는 [확인]이지만, 직접 인증 우회가 아니고 대규모 데이터 노출도 아니며 실제 부하 임계·전면 장애는 측정하지 않았다. Cloudflare 계정 레벨 방어(WAF·Bot Fight Mode) 존재 여부도 미검증(§14.2)이라 실효 악용 가능성을 확정할 수 없다. P0(공개 차단) 우선순위는 유지 |
| SEC-02 미인증 메일 발송 | "Critical — 스팸 릴레이" | **High** — 발송 경로와 무제한성은 [확인]이지만 실제 발송 남용·평판 훼손은 재현하지 않았고(의뢰서가 이메일 발송을 금지) Resend 계정측 발송 제한도 미검증이다. P0 우선순위는 유지 |
| SEC-05 FK restrict | "탈퇴 구현 자체 불가능" | **"하드 삭제 불가"로 축소** — restrict는 DELETE만 거부한다. 익명화(UPDATE + 세션 삭제)는 현 스키마로 가능하므로 "구현 불가"는 과장이었다. 이번 보완에서 §2·§3·§7.4·§12·§13 전부 교정 |

---

## 8. 테스트·CI·운영·release readiness 풀 오딧

### 8.1 QLT-01: E2E 격리 결함 — 라이브에서 직접 재현했다

**메커니즘** [확인]. `playwright.config.ts:19-24`에서 마이그레이션과 시드가 **webServer 시작 명령 안에만** 있다:

```
command: "pnpm run db:migrate:local && pnpm run db:seed:local && pnpm exec wrangler d1 execute DB --local --file scripts/seed-admin-qa.sql && pnpm dev --host 127.0.0.1"
url: "http://127.0.0.1:5173"
reuseExistingServer: true
```

Playwright는 URL이 이미 응답하면 command 전체(마이그레이션 + 시드 3개 포함)를 건너뛴다. 고정 포트 5173에 **다른 워크트리의 dev 서버**가 떠 있으면 테스트는 그 서버의 미시드 DB를 상대로 돈다. `vite.config.ts:17-19` 주석("Feature worktrees share the repository dependency store")이 멀티 워크트리 운용을 확인해 준다.

**직접 재현** [확인 — 2026-08-07 라이브 측정]. 현재 5173에서 도는 PR #41 서버에 QA fixture가 있는지 확인했다:

```
GET /me  +  Cookie: retaste_session=qa-admin-session   →  302 → /login?returnTo=%2Fme
GET /me  (익명)                                         →  302 → /login?returnTo=%2Fme
```

**두 응답이 동일하다.** 이 서버의 D1에는 `qa-admin-session` 세션 행이 없다. 7개 spec이 사전 시드 세션 쿠키를 전제하므로(`admin-rating-operations.spec.ts:4` `qa-admin-session`, `rating-foundation.spec.ts:12` `qa-active-reviewer-session`, `reviewer-management.spec.ts:8,17` 등) 이들은 전부 로그인 리다이렉트를 만난다. **26 FAIL은 제품 결함이 아니라 테스트 프로비저닝 결함이며, 이것은 추론이 아니라 측정된 사실이다.**

산술도 맞는다: 34 spec × 2 프로젝트(chromium / mobile-chromium) = 68.

**부수 결함 3건:**

- `login.spec.ts:21`이 "로그아웃"을 클릭 → `logout.tsx` → `session.server.ts:109`가 **DB 세션 행을 삭제**한다. 시드는 콜드 스타트 때만 실행되므로 `reuseExistingServer` 환경에서 **두 번째 실행부터 반드시 실패**한다(자가 오염).
- `scripts/seed-discovery-ratings.sql`은 자동 프로비저닝에 없다 — `week1-data-runbook.md:52`의 수동 실행뿐. `place-discovery-feed.spec.ts:26`의 단언이 환경 의존적으로 통과/실패한다.
- 맵 spec 9종은 "서버 env에 `NAVER_MAPS_CLIENT_ID`가 없을 것"에 암묵 의존한다(`PlaceMap.tsx:196` `!clientId && qaMode`). placeholder 값이라도 설정된 서버에서는 실 SDK 경로로 빠진다. **실 Naver SDK 렌더 경로는 E2E로 전혀 검증되지 않는다.**

**처방**: 포트 랜덤화 또는 `reuseExistingServer: !process.env.CI`, 그리고 시드를 `globalSetup`으로 분리해 서버 기동 여부와 무관하게 항상 실행.

### 8.2 QLT-02: CI 부재

저장소 전체에 `.github` 등 CI 파일이 **0건**이다 [확인] (전체 find 결과 yml은 `pnpm-lock.yaml`, `pnpm-workspace.yaml`뿐). `AGENTS.md:10-11`은 "Wait for required checks", "Merge the PR only when checks pass"를 규약으로 두는데 강제 수단이 없다. **이번 E2E 붕괴가 로컬에서만 발견됐다는 사실 자체가 이 공백의 증상이다.**

### 8.3 통합 테스트가 프로덕션 설정을 재사용한다

`vitest.workers.config.ts:13`이 `wrangler: { configPath: "./wrangler.jsonc" }`로 **프로덕션 설정을 그대로** 주입한다 [확인]. 그 안에는 `"ai": { "binding": "AI" }`(`:12`)와 실제 운영 `database_id`(`:17`)가 있다. AI binding은 로컬에서도 원격 프록시라 관찰된 "Cloudflare 계정 조회·AI binding 원격 과금 경고"가 여기서 나온 것으로 보인다 [추론].

현재 테스트는 `ai.run`을 전부 mock하므로(`tests/integration/ai-classification.server.test.ts:11`) 실제 과금은 없을 가능성이 높지만, **미래 테스트가 `env.AI`를 실수로 호출하면 실 과금이며 COWORK §6("Workers AI 호출은 사전 승인") 위반**이다. 테스트 전용 wrangler 설정(AI binding 제거)이 필요하다.

병행성도 느슨하다: `fullyParallel: false`는 **파일 내** 직렬화일 뿐이고, chromium/mobile-chromium 두 프로젝트가 같은 서버·같은 로컬 D1에 동시 실행된다. 현재 spec은 대체로 read-only지만 상태 변경 테스트가 추가되는 순간 flaky 경로가 열린다.

### 8.4 커버리지

`vitest.config.ts`·`vitest.workers.config.ts` 어디에도 coverage 설정이 없다 [확인]. 124 + 59 테스트가 있어도 커버리지 회귀를 감지할 수단이 없고, 조직 표준(80%)과 대조할 수치 자체가 산출되지 않는다.

### 8.5 운영 문서 실행 가능성

| 런북 | 판정 | 근거 |
|---|---|---|
| `cloudflare-deploy.md` | **골격 양호, secret 목록이 치명적으로 낡음** | `:26-27`이 `SESSION_SECRET`(코드 미사용 — 불투명 세션 방식)과 `ADMIN_EMAIL`만 지시. 실제 필요한 `NAVER_MAPS_CLIENT_ID`·`DATA_GO_KR_SERVICE_KEY`·`RESEND_API_KEY`·`RESEND_FROM_EMAIL`·`APP_BASE_URL`이 없다. **이 런북만 따라 배포하면 지도·동기화·메일이 전부 죽은 배포가 된다.** `:35`의 `pnpm deploy`도 pnpm 내장 워크스페이스 명령과 충돌해 스크립트가 실행되지 않는다 [추론] |
| `week1-data-runbook.md` | **구조 붕괴 + 실패하는 명령** | 한 파일에 4개 주제가 이어붙어 H1이 2개다. `:24` `npm run db:migrate:local`은 pnpm-only 규약(COWORK §5) 위반. `:25-27`의 `wrangler d1 execute retaste-local --local`은 존재하지 않는 DB명이라 실패한다(현 설정은 binding `DB`, name `retaste-production`). `:55`는 **운영 D1에 QA 시드 실행을 지시**한다 — `qa-discovery-*` 가짜 사용자 50명 + 투표 + Golden Pick이 공개 추천률에 반영되며 제거 절차가 어디에도 없다 |
| `ai-operations-runbook.md` | **원칙·화면·장애 대응은 코드와 정합, 수치는 드리프트** | 모델·confidence 0.85·30일 캐시는 코드와 일치. 그러나 `:7` 프롬프트 `place-category-v1` vs 코드 `place-category-v3`(`ai-classification.server.ts:12`), `:17-18` "한 번에 100곳·하루 500건" vs 코드 배치 10 + 뉴런 쿼터. **장애 대응 시 런북을 믿으면 오판한다** |
| `place-operations-runbook.md` | **정합** | 상태 전이·라우트가 `routes.ts`와 일치 |

**공백**: 정기 백업 스케줄·보존 정책 문서가 없다(master 4주차 예정 항목 "D1 export, R2 inventory, 복구 절차"의 산출물이 아직 없음). 롤백 절차는 배포 런북과 week1 런북에 분산돼 있다.

### 8.6 release readiness 종합

| 게이트 | 상태 | 차단 요인 |
|---|---|---|
| 타입·빌드 | PASS | — |
| 단위·통합 테스트 | PASS (124 + 59) | 커버리지 미측정 |
| E2E | **작동 불가** | QLT-01 |
| CI required checks | **부재** | QLT-02 |
| 보안(남용 방어) | **미달** | SEC-01, SEC-02 |
| 개인정보·법적 고지 | **미달** | SEC-04, SEC-05, SEC-06 + 처리방침 미확정 항목(`privacy.tsx:11,16`의 계약 주체·보호책임자) |
| 관측·장애 감지 | 부분 | observability는 켜짐, 외부 통지 채널 없음(QLT-04) |
| 데이터 규모 | 미달 | 검수 장소 20곳 (단계 2 요건 300곳) |
| 롤백 | 부분 | 절차 분산, 백업 스케줄 문서 없음 |

---

## 9. 화면별 UI/UX 개선 제안

각 항목은 `현재 문제 → 제안 → 상호작용/상태 → 반응형 규칙 → 접근성 → 수용 기준` 순서로 쓴다. 모든 제안은 실제 route·component·data model에 연결했다.

### 9.1 지도 홈 `/` — 카테고리와 뷰포트의 소유권을 분리한다

**현재 문제** [확인]
좌측 패널의 자식 카테고리 개수는 전역 집계(`place.server.ts:207-218`, bbox 무관)인데 결과는 bbox 필터를 거친다(`home.tsx:30`). "치킨 25"를 눌러도 현재 화면 범위에 없으면 0곳이 뜨고, `PlaceMap`에는 places 변경 시 `fitBounds`가 없어 지도가 빈 상태로 남는다. 사용자는 "눌렀는데 아무것도 없다"만 본다. 랜딩에 `h1`도 없다(라이브 3폭 재현).

**제안**
1. 카테고리 칩의 개수를 **현재 bbox 기준 개수**로 바꾸고, 전역 개수는 괄호 보조 표기(`bbox 3 · 전체 25`)로 둔다. `listPublicCategoryGroups`에 bbox 파라미터를 추가하고, 전역 개수는 별도 캐시 가능한 호출로 분리한다.
2. 카테고리 선택 결과가 현재 bbox에서 0곳이면 지도를 자동 이동하지 말고 **명시적 제안 배너**를 띄운다: "이 범위에 치킨이 없어요. 광주 전체에서 25곳 보기" — 버튼을 누르면 그때 `DEFAULT_BBOX`로 이동한다. 지도 뷰포트의 소유권은 항상 사용자에게 둔다.
3. 지도 영역 위에 시각적으로 숨긴 `h1`을 둔다: `<h1 className="sr-only">광주·전남 맛 지도</h1>`.

**상호작용/상태**
- 로딩: 카테고리 전환 중 패널 리스트에 스켈레톤 3행. 지도는 기존 마커를 유지(깜빡임 금지).
- 빈 결과: 위 제안 배너. 카피는 "이 범위에 {카테고리}가 없어요."
- 오류: 지도 SDK 실패 시 현재 `.map-error`(`role="status"`)를 유지하되 **재시도 버튼**을 추가한다(`naver-map-sdk.ts:2`의 모듈 레벨 promise를 리셋 가능하게 — ARC-10).
- stale: 없음(URL 기반 재검증이 이미 정확).

**반응형 규칙**
- ≥761px: 좌 400px 패널 + 우 지도 (현행 유지).
- ≤760px: 지도 전면 + 하단 시트(현행). 시트 접힘 높이를 49px → **56px**로 올려 탭 타깃을 확보한다.
- 배너는 모바일에서 시트 상단에 인라인으로, 데스크톱에서는 리스트 상단에 표시한다.

**접근성**
- 배너는 `role="status"`(assertive 아님 — 파괴적 알림이 아니다).
- 카테고리 칩 그룹은 `role="group"` + `aria-label="음식 카테고리"`, 각 칩은 `aria-pressed`로 통일한다. 현재 그룹은 `aria-expanded`, 자식은 `aria-pressed`로 혼용돼 있다(`MapExplorerPanel.tsx:67-71`).
- 헤더 내비 링크 최소 높이 44px.

**수용 기준**
- [ ] 카테고리 칩 개수와 선택 후 결과 개수가 항상 일치한다.
- [ ] 0곳일 때 배너가 뜨고, 지도는 사용자가 버튼을 누르기 전까지 이동하지 않는다.
- [ ] 375/768/1440에서 `h1`이 정확히 1개 존재한다(자동 검사로 확인).
- [ ] 헤더 내비 링크 히트 영역이 3폭 전부 ≥44px.

### 9.2 지도 홈 — 위치 권한 거부·권역 밖 안내를 `main`으로 승격

**현재 문제** [확인]
`main`의 `home.tsx:47`과 `PlaceMap.tsx:86`은 지오로케이션 오류 콜백이 `() => undefined`다. 권한을 거부해도, 위치가 서울이어도 아무 안내가 없다. PR #41이 권역 판정과 안내를 추가했고 라이브에서 동작을 확인했다(§1.3).

**제안**
PR #41의 `location-policy.ts` 접근을 유지하되 다음을 보강한다.
1. 권한 **거부** 상태를 권역 밖과 구분해 안내한다: "위치 권한이 꺼져 있어 광주 기본 지도를 보여드려요." + 브라우저 설정 안내 링크.
2. 권역 밖 안내(현재 "현재 위치는 전라남도 범위 밖에 있습니다.")를 **서비스 경계 설명 + 다음 행동**으로 바꾼다: "Re:Taste는 지금 광주·전남만 다뤄요. 광주 지도로 이동했습니다."
3. 안내는 5초 후 자동 소멸하지 말고 사용자가 지도를 조작하면 소멸한다(읽을 시간 보장).

**상호작용/상태** — 권한 미결정 / 거부 / 권역 안 / 권역 밖 / 타임아웃(8초) 5개 상태를 명시적으로 모델링한다. 현재 코드는 성공 경로만 다룬다.

**반응형** — 안내는 모바일에서 지도 상단 고정 배너, 데스크톱에서 패널 상단.

**접근성** — `role="status"` + `aria-live="polite"`. 라이브 실측에서 PR #41의 문구는 이미 status로 노출됐다(§1.3) — 이 부분은 유지하면 된다.

**수용 기준**
- [ ] 5개 상태 각각에 대해 화면 문구가 다르다.
- [ ] 권역 밖 시나리오에서 URL bbox가 `DEFAULT_BBOX`로 복귀한다(라이브에서 이미 확인).
- [ ] 안내가 스크린리더로 읽힌다.

### 9.3 장소 상세 `/places/:slug` — 점수의 단일 출처와 근거 노출

**현재 문제** [확인]
목록과 상세의 점수 출처가 다르다(ARC-01). 상세는 "표본 수집 중 · 3/8", "검증된 최신 결과" 같은 좋은 문구를 이미 갖췄지만, 사용자가 목록에서 본 숫자와 다르면 그 문구의 신뢰가 무너진다. 또 모든 장소 페이지의 `<title>`이 "장소 상세 — Re:Taste"로 동일하다.

**제안**
1. **목록·지도·시트를 전부 v2 스냅샷으로 통일한다.** `listPlaces`가 `ratingSnapshots`를 leftJoin해 `overallScore`·`overallSampleCount`·`isStale`을 함께 반환하고, 스냅샷이 없으면 v1 폴백을 명시적 필드(`algorithmVersion`)로 표시한다. 마커 influence(`getMarkerInfluence`)도 이 유효 표본 수를 쓴다.
2. **점수 옆에 근거를 한 줄로 노출한다**: "회원 12표 · 리뷰어 3표 · 리뷰어 영향 최대 30%". 이 제품의 차별점이 평가 방법론인데 지금은 상세 하단 `<small>`에만 있다.
3. `meta`를 동적으로: `title: "{상호} · {동네} 맛집 — Re:Taste"`, `description`에 카테고리·추천률·주소, OG(`og:title`, `og:description`, `og:type=website`), `canonical`. JSON-LD `Restaurant`(name, address, geo, servesCuisine) 추가.

**상호작용/상태**
- 표본 미달: 현행 "표본 수집 중 · n/8" 유지 (좋은 처리다).
- stale: 현행 "새 평가 반영 중" 유지 + 마지막 계산 시각 표시.
- 투표 pending: 현행 `VoteControl` 유지 (모범 사례).
- 비로그인: 현행 인라인 로그인 링크 유지하되 `returnTo`가 실제로 동작해야 한다(UX-01).

**반응형** — ≤760px에서 상세 그리드 1열(현행). `.detail-hero` 최소 높이 350px → 이미지 없을 때 220px로 낮춰 스크롤 비용을 줄인다.

**접근성** — `<meter>`에 항상 fallback 텍스트(현재 `me.tsx:11`만 누락). 점수 변경 시 `aria-live="polite"`로 알림.

**수용 기준**
- [ ] 같은 장소의 추천률이 목록·지도·시트·상세에서 동일하다.
- [ ] 관리자가 투표를 무효화하면 목록 숫자도 다음 재계산 후 변한다.
- [ ] 장소 링크를 메신저에 붙이면 상호명이 미리보기에 뜬다.
- [ ] 라이브에서 `<title>`이 장소마다 다르다.

### 9.4 로그인·회원가입 — 맥락 복귀와 오류 복구

**현재 문제** [확인]
`safeReturnTo`가 항상 `/`를 반환한다(`login.ts` 전문 3줄). 투표하려고 로그인한 사용자가 홈으로 떨어진다. 회원가입은 오류 시 폼 자체가 사라진다(`signup.tsx:28`). 폼 오류에 `role=alert`·`aria-invalid`가 없다.

**제안**
1. `safeReturnTo`를 **허용 목록 기반**으로 되살린다: `/`로 시작하고 `//`·`\`를 포함하지 않으며 `routes.ts`의 알려진 경로 패턴에 매치될 때만 통과. 실패 시 `/`. Open redirect 위험 없이 UX를 회복한다.
2. 로그인 폼에 `<input type="hidden" name="returnTo">`를 추가하고, `VoteControl.tsx:12`와 `PlaceDetailSheet.tsx:34`의 링크도 `returnTo`를 싣는다. 시트의 `<a href="/login">`은 `<Link>`로 바꿔 풀 리로드를 없앤다.
3. 회원가입은 오류와 폼을 **함께** 렌더한다. 입력값을 `defaultValue`로 되살린다.
4. 폼 오류에 `role="alert"` + 필드에 `aria-invalid` + `aria-describedby`.

**상호작용/상태** — 제출 중 버튼 disabled + "확인 중…"(현재 이중 제출 방지가 없다). 성공 시 `returnTo`로 이동.

**반응형** — 보조 링크(`회원가입`, `비밀번호 재설정`, `이용약관`)를 모바일에서 세로 스택 + 최소 높이 44px. 현재 20px 높이로 실측됐다.

**접근성** — 오류 요약을 폼 상단에 두고 첫 오류 필드로 포커스 이동. 라벨-입력 연결 확인.

**수용 기준**
- [ ] `/places/x`에서 투표 → 로그인 → **`/places/x`로 복귀**한다.
- [ ] `returnTo=//evil.com`, `returnTo=https://evil.com`이 전부 `/`로 폴백한다(단위 테스트).
- [ ] 가입 검증 실패 시 폼과 입력값이 유지된다.
- [ ] 오류가 스크린리더로 즉시 읽힌다.

### 9.5 정정 요청 `/corrections/new` — 남용 차단과 실패 순서 교정

**현재 문제** [확인]
미인증 사용자가 임의 이메일 주소를 입력하면 그 주소로 메일이 나간다(SEC-02). DB insert가 먼저 실행되고 `EMAIL_NOT_CONFIGURED` throw가 나중이라 검증 불가능한 고아 행이 남으며, 내부 에러코드가 화면에 그대로 나온다(QLT-03).

**제안**
1. env 검사를 **insert 이전으로** 이동한다. 3줄 순서 교체.
2. IP·이메일 기준 rate limit(예: 동일 IP 시간당 3건, 동일 이메일 일 3건)을 적용한다.
3. 에러코드를 사용자 문구로 매핑하고 미매핑 코드는 "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요."로 통일한다. 원문은 서버 로그에만.
4. 로그인 사용자는 이메일 입력을 건너뛰고 계정 이메일을 쓴다(입력 필드를 읽기 전용으로 표시).

**상호작용/상태** — 제출 중 disabled. 성공 시 "확인 메일을 보냈습니다" + 재발송 쿨다운 표시. rate limit 도달 시 남은 대기 시간 안내.

**반응형** — 폼 단일 컬럼(현행 유지). 모바일에서 `<select>` 장소 목록 1,000개는 사용성이 나쁘다 → 검색 가능한 combobox 또는 "장소 상세에서 정정 요청" 진입점으로 대체 검토.

**접근성** — 필수 필드에 `required` + 시각적 표시 + `aria-required`. 오류 `role="alert"`.

**수용 기준**
- [ ] `RESEND_API_KEY` 부재 시 DB 행이 생성되지 않는다.
- [ ] 동일 IP 4번째 요청이 429로 거부된다.
- [ ] 화면에 `EMAIL_NOT_CONFIGURED` 같은 내부 코드가 나오지 않는다.

### 9.6 관리자 검수 `/admin/candidates` — 필터 일관성과 진행 표시

**현재 문제** [확인]
이 화면은 이 코드베이스에서 UX가 가장 잘 된 축이다(pending 표시, 빈 상태, AI 쿼터 배너, URL 필터 반영 전부 있음). 문제는 데이터 계약이다 — 로더는 필터를 쓰는데 승인 action은 **필터 없는 300건 윈도우**로 재검증해(ARC-05), 화면에 보이는 후보가 "검수 대기 후보가 아닙니다"로 스킵될 수 있다. 요약 카운트도 300 캡에 걸려 실제 대기량을 숨긴다.

**제안**
1. 승인 action이 **선택된 후보 ID로 직접 조회**하도록 바꾼다(윈도우 재검증 제거).
2. 요약 카운트를 `count(*)` 집계 쿼리로 분리해 실제 대기량을 보여준다.
3. 300건 상한이 남는 곳에는 "상위 300건만 표시 중 · 전체 1,240건" 문구를 명시한다. **조용한 절단이 가장 나쁘다.**

**상호작용/상태** — 현행 유지 + 승인 실패 시 어떤 후보가 왜 스킵됐는지 목록으로 표시.

**반응형** — 3열 워크스페이스(레일/지도/인스펙터)가 1100px에서 2열, 760px에서 세로 스택(현행). 모바일 검수는 실사용이 드무므로 현행으로 충분하다.

**접근성** — `aria-disabled` + `pointer-events:none`만 걸린 페이지네이션 링크(`admin-candidates.tsx:267`)를 키보드로도 비활성화한다(`tabIndex={-1}` 또는 `<span>` 대체).

**수용 기준**
- [ ] 필터를 건 상태에서 화면의 모든 후보를 승인할 수 있다.
- [ ] 대기 건수가 300을 넘어도 실제 수치가 표시된다.
- [ ] 표시 상한이 있는 화면에 그 사실이 명시된다.

### 9.7 공개 탐색성 — 최소한만, 근거 있는 것만

**현재 문제** [확인 — 라이브 실측] `robots.txt` 404, `sitemap.xml` 404, OG·canonical·JSON-LD 0건, `/places`·`/signup`·`/maps/:slug`는 title이 빈 문자열.

**제안 (최소 집합)**
1. 모든 공개 라우트에 `meta` export: `title`, `description`, `canonical`.
2. 장소 상세에 OG 4종(`og:title`, `og:description`, `og:type`, `og:url`) + `twitter:card=summary`. 이미지가 있으면 `og:image`.
3. `robots.txt`(관리자 경로 disallow) + `sitemap.xml`(PUBLISHED 장소 slug + 공개 카테고리).
4. 장소 상세에 JSON-LD `Restaurant`: `name`, `address`(PostalAddress), `geo`(GeoCoordinates), `servesCuisine`. **`aggregateRating`은 넣지 않는다** — 표본 8표 미만 공개 정책과 충돌하고, 검증되지 않은 평점을 구조화 데이터로 내보내면 신뢰 서사가 무너진다.

**제안하지 않는 것 (근거 없음)** — 키워드 페이지 양산, 지역×카테고리 조합 랜딩 대량 생성, 블로그 콘텐츠 전략. 현재 장소 20곳 규모에서 이것들은 근거 없는 확장이다.

**수용 기준**
- [ ] 모든 공개 라우트가 고유한 non-empty title을 갖는다(라이브 자동 검사).
- [ ] `robots.txt`·`sitemap.xml`이 200을 반환하고 관리자 경로가 disallow된다.
- [ ] JSON-LD가 스키마 검증을 통과하고 `aggregateRating`을 포함하지 않는다.

### 9.10 발견·목록 `/places` — 이중 조회 제거와 검색 접근성

**현재 문제** [확인] `place-list.tsx:19-23`이 `listPlaces`·`listPublicCategoryGroups`·`getPlaceDiscovery`를 병렬 호출하는데, `getPlaceDiscovery` 내부가 다시 `listPlaces`를 돌려 동일 bbox 100행 GROUP BY 집계를 요청당 2회 수행한다(§6.2). 검색 폼(`:53-59`)은 label이 있으나 결과 개수(`:60` "N PLACES")가 `aria-live`가 아니라 검색 후 변경이 스크린리더에 안 알려진다. `<h1>`은 있다(`:38`).

**제안**
1. `getPlaceDiscovery`가 상위에서 받은 `places`를 재사용하도록 시그니처를 바꿔 중복 `listPlaces`를 제거한다(라이브러리 없이, §11.2 결론과 정합).
2. 검색 결과 영역을 `aria-live="polite"`로 감싸 개수 변화를 알린다.
3. 빈 결과 문구(`:62`)는 이미 양호("검색어를 줄이거나 지도 범위를 넓혀보세요") — 유지.

**상호작용/상태** — 로딩: 검색 제출 중 결과 그리드에 스켈레톤(현재 pending 표시 없음). 빈 결과: 현행 유지. 오류: 라우트 ErrorBoundary가 전역뿐 → 인라인 오류로 보강. stale: URL 기반 재검증(정확).

**반응형 규칙** — `.discovery-rail{grid-auto-columns:82vw}`(§5.5)로 모바일 카드가 화면을 거의 채워 다음 카드 힌트가 8vw뿐 → **74vw로 낮춰** 다음 카드를 노출한다. ≥761px 다열 그리드 유지.

**접근성** — 검색 결과 개수 `aria-live`. 레일은 `role="list"`/`listitem` 또는 시맨틱 목록. 카드 링크 히트 영역 44px.

**수용 기준** — [ ] `/places` 로드 시 `listPlaces`가 1회만 실행된다. [ ] 검색 후 결과 개수가 스크린리더로 읽힌다. [ ] 모바일에서 다음 카드 힌트가 보인다.

### 9.11 회원 `/me` — N+1 제거와 meter 접근성

**현재 문제** [확인] `me.tsx:9`가 `getMemberTasteGraph`를 호출하는데 이 함수가 추천 장소마다 `getPlaceFlavorPrint`를 개별 호출하는 N+1이다(§6.7) — `/me` 지연이 투표 수에 비례. `me.tsx:11`의 `<meter min max value>`에 접근 가능한 이름이 없다(`place-detail.tsx:95`는 fallback 있음 — 비일관). 저장 해제가 `action`으로 처리되나 pending 표시가 없다(`:10`).

**제안**
1. `getMemberTasteGraph`의 flavor print 조회를 batch 1회로(placeIds IN). 라이브러리 불필요.
2. 각 `<meter>`에 `aria-label`(예: `${dimension} 점수`) + 시각 fallback 텍스트.
3. 저장 해제 버튼을 `PendingButton`(§9.8)으로.

**상호작용/상태** — 로딩: 취향 그래프 학습 중 상태 이미 있음(`:11` "학습 중 · n/5") — 유지. 빈 결과: 저장·평가 각각 Empty 있음(`:11` `<Empty>`) — 유지. 오류: 전역만 → 인라인 보강. stale: 기본.

**반응형 규칙** — ≤760px 세로 스택(현행 `md:grid-cols-2`). 그래프 바가 모바일에서 넘치지 않게 `min-width:0`.

**접근성** — meter aria-label 필수. 저장 해제 후 `aria-live`로 결과 알림.

**수용 기준** — [ ] `/me` 로드 시 flavor print 조회가 O(1) 쿼리다. [ ] 모든 meter가 접근 가능한 이름을 갖는다. [ ] 저장 해제 중 버튼이 pending을 표시한다.

### 9.12 리뷰어 신청 `/reviewer/apply` — 오류 SR 안내와 상태 명료화

**현재 문제** [확인] 이 화면은 상태 패널(`reviewer-apply.tsx:51-52` profile/hasOpen 분기)과 오류맵(`:34,:65`)이 이미 잘 구조화돼 있다. 남은 결함은 (1) 오류 배너(`:49`)가 `role="alert"` 없이 시각 텍스트뿐, (2) 필드 오류가 필드에 연결(`aria-describedby`)되지 않음, (3) `occupation`은 개인정보인데 수집 고지가 폼에 없다(SEC-06 연계).

**제안**
1. 오류 배너에 `role="alert"`. 필드 오류를 `FormField`로 배선.
2. `occupation` 필드에 "직업 정보는 리뷰어 심사에만 쓰이며 처리방침에 따라 보관됩니다" 고지.
3. 제출 버튼 pending 상태(현재 없음, `:58`).

**상호작용/상태** — 로딩: 제출 중 pending. 빈 결과: N/A. 오류: 인라인 오류맵(현행) + SR 안내. 권한: `requireUser` redirect(현행). stale: 기본.

**반응형 규칙** — `md:grid-cols-[1fr_260px]`(현행) → ≤760px 세로 스택. 체크박스 그리드 `grid-cols-2`(모바일)/`md:grid-cols-4`(현행 적절).

**접근성** — 오류 `role="alert"` + 첫 오류 필드 포커스. fieldset/legend 이미 있음(`:57`) — 유지.

**수용 기준** — [ ] 신청 오류가 스크린리더로 읽힌다. [ ] `occupation` 수집 고지가 폼에 있다. [ ] 제출 중 이중 제출이 방지된다.

### 9.13 리뷰어 평가 `/reviewer/ratings` — 무제한 조회와 403 처리

**현재 문제** [확인] `reviewer-ratings.tsx:18-27`의 rows 쿼리에 `.limit()`이 없어 PUBLISHED 전 장소를 로드하고, `listReviewerHotTakes`가 매 로드마다 `currentVotes`를 읽어 JS 필터한다(§6.7). 권한 거부(`:16` `assertRole`)는 403 generic 화면으로 떨어진다(UX-06). Flavor Print select에 `aria-label`은 있다(`:63`).

**제안**
1. rows 쿼리에 페이지네이션/`limit` 추가 + 리뷰어가 평가할 장소를 우선순위(미평가 우선)로 정렬.
2. `listReviewerHotTakes`를 집계 쿼리로 전환(전체 votes JS 필터 제거).
3. 403을 전용 화면으로(UX-06, §9.14와 공유).

**상호작용/상태** — 로딩: 제출 중 pending(현재 redirect만). 빈 결과: 템플릿 없음 안내 있음(`:63` "템플릿 준비 중") — 유지. 오류: `:48,:52` throw Response → 인라인 보강(ARC-07). 권한: 403 전용. stale: action 후 redirect.

**반응형 규칙** — 평가 리스트가 모바일에서 1열. Flavor Print select 그룹이 터치 타깃 44px.

**접근성** — select `aria-label` 유지. Golden Pick 부여 버튼에 확인 단계(비가역 작업).

**수용 기준** — [ ] 장소 수가 커도 페이지 단위로 로드된다. [ ] 403이 전용 화면으로 표시된다. [ ] Golden Pick 부여 전 확인이 있다.

### 9.14 관리자 운영 화면군 — 목록 접근성·403·실패 피드백

대상: `/admin/places`, `/admin/reviewers`, `/admin/ratings`, `/admin/place-operations`, `/admin/operations`, `/admin/data-sync`.

**현재 문제** [확인] (1) `admin-places.tsx`·`admin-import.tsx`·`admin-data-sync.tsx`·`admin-candidates.tsx`의 `<main>`에 `id="main"`이 없어 skip-link 무효(UX-10). (2) 전 관리자 화면이 403을 generic 오류로(UX-06). (3) `admin-data-sync`는 실패 피드백이 없다(§5.3 표 25행). (4) `admin-places.tsx`는 빈 테이블에 empty 상태가 없다(§5.3 21행). (5) 도메인 에러가 500으로(ARC-07). (6) `admin-data-sync.tsx:14,18`의 `sourceType`·`addressField`가 zod 없이 타입 단언(§7.1).

**제안**
1. 6개 `<main>` 전부 `id="main"`.
2. 공통 403 전용 화면(UX-06) — ErrorBoundary가 status===403을 분기.
3. `admin-data-sync`에 성공/실패 `aria-live` 피드백 + 입력 zod 검증.
4. `admin-places` 빈 테이블에 EmptyState.
5. 모든 관리자 action을 try/catch로 인라인 오류화(ARC-07).

**상호작용/상태** — 로딩: 목록·동기화 pending(`admin-candidates`만 있음). 빈 결과: 각 목록 EmptyState. 오류: 인라인. 권한: 403 전용. stale: 필터 URL 반영(candidate만).

**반응형 규칙** — 3열 워크스페이스가 1100px에서 2열, 760px에서 세로 스택(현행). 관리자 모바일 사용은 드무므로 데스크톱 우선 유지.

**접근성** — 테이블에 `<caption>` 또는 `aria-label`. 상태 배지에 텍스트 동반(색만으로 구분 금지). 페이지네이션 링크 키보드 비활성 처리(§9.6).

**수용 기준** — [ ] 6개 관리자 라우트 skip-link가 작동한다. [ ] 403이 전용 화면. [ ] `admin-data-sync` 실패가 화면에 표시되고 입력이 검증된다. [ ] 빈 목록에 EmptyState.

### 9.15 오프라인·네트워크 실패 — 현재 계약이 전무하다

**현재 문제** [확인] 오프라인 감지·서비스 워커·네트워크 실패 처리가 코드베이스에 **0건**(`onLine`·`serviceWorker`·`offline` grep 무결과, 이번 실행 확인). SSR 앱이라 초기 로드는 서버 렌더되지만, 클라이언트 전환(fetcher.load, 지도 pan) 중 네트워크 실패 시 사용자 피드백이 없다. `PlaceDetailSheet`는 무한 로딩 문구에 머문다(ARC-02 연계).

**제안 (최소, 과설계 금지)**
1. fetcher 실패(`state==="idle" && !data`)에 "정보를 불러오지 못했어요 · 다시 시도" + 재시도 버튼(§9.3·ARC-02).
2. 지도 pan/zoom 재검증 실패 시 마지막 성공 상태 유지 + 상단 "연결이 불안정해요" 배너(`role="status"`).
3. 서비스 워커·오프라인 캐시는 **도입하지 않는다** — 베타 규모에서 근거 없는 확장(§11 원칙). 지역 지도 서비스는 실시간성이 캐시보다 중요.

**상호작용/상태** — 온라인 복귀 시 배너 자동 소멸. 실패 중 파괴적 액션(투표·저장) 버튼 비활성.

**반응형 규칙** — 배너는 모바일 지도 상단 고정, 데스크톱 패널 상단.

**접근성** — 실패 배너 `role="status"` + `aria-live="polite"`(파괴적 알림 아님).

**수용 기준** — [ ] fetcher 실패 시 재시도 UI가 나온다. [ ] 재검증 실패가 마지막 상태를 파괴하지 않는다. [ ] 서비스 워커를 추가하지 않는다(범위 준수).

### 9.8 전역 — 정보 위계·타이포·spacing·색 토큰

**현재 문제** [확인]
`--s1~--s12` spacing 토큰 사용 **0회**, `var(--signal)` 4회, 고유 hex **66종**이 인라인 산재한다. accent 계열만 `#22543d`, `#1f6146`, `#2f634d`, `#173c2c`, `#174d35` 등 5가지 유사 녹색이다. semantic 토큰 층이 없다. 게다가 Tailwind와 수제 클래스가 공존해 같은 오류 배너가 `.operation-error`와 `border-rose-500 bg-rose-50` 두 구현으로 존재한다.

**제안 — 3층 토큰**

```
primitive   --green-900:#173c2c  --green-700:#22543d  --green-500:#2f634d
            --ink-900:#111  --ink-600:#555  --ink-400:#6b6b6b
            --paper:#fafaf8  --surface:#fff  --line:#d9d9d4  --line-soft:#e2e5df
            --signal:#e7ff55  --warn:#a04e00  --danger:#8a2b18  --ok:#145f3b

semantic    --text-primary: var(--ink-900)
            --text-secondary: var(--ink-600)      /* #777 대체 — 대비 3.64 → 7.46 */
            --text-muted: var(--ink-400)
            --accent: var(--green-700)
            --accent-strong: var(--green-900)
            --surface-map-placeholder: #e8e8e3
            --state-selected: var(--signal)

component   --map-pin-size-base/medium/high/selected
            --sheet-radius, --sheet-shadow
            --touch-min: 44px
```

**타이포 (한글 우선)**
- Body 16px / line-height 1.6 / `word-break: keep-all`(한국어 필수 — 현재 미적용). 현재 본문은 상속 기본값이다.
- 위계 5단: Display `clamp(38px,5vw,68px)` / Headline 28px / Title 19px / Body 16px / Label 12px. **9~11px 단계를 없앤다**(현재 `.brand span` 9px, 지역 소제목 9px, 시트 내 10px 다수).
- 폰트는 Noto Sans KR + IBM Plex Mono 2종 유지가 옳다(과하지 않다). 다만 **자체 호스팅 + 한글 서브셋**으로 전환해 렌더 블로킹과 CLS를 줄인다. Mono는 숫자 표기 전용으로 역할을 좁히고 `font-feature-settings: "tnum"`을 적용한다(추천률·표본 수 정렬).

**Spacing** — `--s1~--s12`를 실제로 쓴다. 최소한 신규·수정 컴포넌트부터 강제하고, 기존은 파일 단위로 점진 이관한다. 하드코딩 px는 lint 규칙으로 막는다.

**컴포넌트 재사용 방향** — 지금 필요한 공통 컴포넌트는 5개뿐이다: `Banner`(status/warn/error 3변형 — 현재 2중 구현 통합), `FormField`(label+input+error+aria 배선), `EmptyState`, `PendingButton`(제출 중 disabled+문구), `Sheet`(포커스 트랩+Esc+복원). 이 5개가 §5.3 표의 빈 칸 대부분을 메운다. **디자인 시스템을 크게 짓지 말고 이 5개만 만든다.**

**수용 기준**
- [ ] 신규 코드에 하드코딩 hex·px가 없다(lint).
- [ ] 대비 미달 3건이 해소된다(자동 대비 검사).
- [ ] 오류 배너 구현이 1개다.
- [ ] 본문에 `word-break: keep-all`이 적용된다.
- [ ] 9~11px 텍스트가 0건이다.

### 9.9 피해야 할 것 — AI slop 명시 금지 목록

이 제품은 현재 **AI slop 징후가 매우 적다.** 보라-파랑 그라디언트, 글래스모피즘, 벤토 그리드, 3열 아이콘 피처 카드, pill eyebrow 배지, 상시 다크모드, 스파클 AI 브랜딩이 **전부 없다.** 흑백 + 단일 녹색 accent + 시그널 옐로우의 에디토리얼 흑백 방향은 의도가 읽힌다. 개선하면서 이것을 잃지 말아야 한다.

명시 금지:

| 금지 | 이유 |
|---|---|
| 카테고리 칩·장소 카드에 그라디언트·글로우 추가 | 현재 flat + 외부 그림자로 표본 영향을 표현하는 마커 정책(`app.css:30-34`)이 이미 의미 있는 깊이다. 장식 그라디언트는 그 의미를 지운다 |
| 균일 라운드(`rounded-3xl` 일괄) | 현재 각진 편집 그리드가 제품 성격이다. 시트만 14~18px 라운드로 물리적 은유를 유지 |
| 무차별 소프트 섀도 | 현재 그림자는 "지도 위 떠 있음"과 "표본 영향력"에만 쓰인다. 전 카드에 뿌리면 위계가 죽는다 |
| 3열 아이콘 피처 카드, 1-2-3 단계 블록, 지표 배너 행 | 이 제품엔 마케팅 랜딩이 없다. 만들지 마라 |
| 장식용 상태 점 | `.session-status i`(로그인 상태 점)는 **실제 상태**를 나타내므로 정당하다. 이걸 다른 곳에 장식으로 복제하지 마라 |
| 획일적 대시보드(사이드바+카드+차트) | 관리자 화면은 이미 검수 워크플로에 맞춘 3열 구조다. 일반적 대시보드로 바꾸지 마라 |
| 한국어 AI 번역투 | 현재 카피("추천할 만한 한 끼를 기록합니다", "이 페이지는 지도 밖에 있어요")는 자연스럽다. "오늘날 빠르게 변화하는", 무생물 주어, 과한 피동을 넣지 마라 |
| 이모지 남발 | 카테고리 이모지는 마커 식별에 기능적으로 쓰인다. 본문·버튼으로 확장하지 마라 |
| 근거 없는 숫자 배지 | Golden Pick·Hidden Gem은 계산 근거가 있다. "인기 급상승" 같은 근거 없는 배지를 추가하지 마라 |

---

## 10. 디자인 시스템 · Dictionary 판정

의뢰서의 `dictionary_context` 5개 문서를 읽고 이 제품에 관련된 개념만 판정했다. **Dictionary는 선택지를 분명히 하는 어휘이지 스타일 지시가 아니다.** 원문 카피·표·값·자산은 복제하지 않았다.

### 10.1 `ux-taxonomy`

| 개념 | 판정 | 근거 |
|---|---|---|
| Geographical Scheme (지리적 체계) | **ADOPT** | 이미 채택돼 있고 코드로 강제된다(`public-data.ts:96-100`). 광주·전남 경계가 조직 체계의 1차 축 |
| Search Results: Map (지도 결과) | **ADOPT** | 홈이 정확히 이 패턴(좌 리스트 + 우 지도). 유지 |
| Map → List → Detail (시퀀스) | **ADOPT** | `home.tsx` → `MapPlaceList` → `MapPlaceDetail`/`PlaceDetailSheet`로 이미 구현. §9.1·9.3이 이 흐름의 결함만 고친다 |
| Faceted Classification / Faceted Search | **ADAPT** | 현재는 카테고리 단일 축. 거리·영업상태·가격대 패싯을 **지금 추가하지 않는다** — 장소 20곳 규모에서 패싯은 빈 결과만 늘린다. 300곳 도달 후 재검토 |
| Bottom Sheet Filter | **ADAPT** | 모바일 시트는 이미 있으나 필터가 아니라 결과 목록이다. 필터가 늘어날 때(위 패싯과 동시에) 시트 필터로 승격 |
| Stale Data State | **ADOPT** | `isStale` → "새 평가 반영 중"이 이미 있다. §9.3에서 마지막 계산 시각 추가로 강화 |
| Permission Denied (403) | **ADOPT** (미구현) | 현재 403이 generic 오류 화면으로 떨어진다(UX-06). 전용 상태 도입 |
| Empty State / No Results State | **ADOPT** (부분 구현) | §5.3 표의 빈 칸을 메운다 |
| Optimistic UI | **REJECT** | 투표는 서버 무결성 검사(`integrity.server.ts`)와 재계산 큐를 거친다. 낙관적 반영은 무효화·재계산 결과와 충돌해 신뢰 서사를 해친다. 현행 pending + 확정 표시가 옳다 |
| Infinite Scroll | **REJECT** | 지도 bbox 기반 탐색이 1차 모델이다. 목록 무한 스크롤은 지도 상태와 이중 소유권을 만든다. `Load More`도 현재 100행 상한에서 불필요 |
| Bottom Tab Bar | **N/A** | 웹 앱이며 주요 과업이 지도 하나에 집중돼 있다. 5탭을 만들 표면이 없다 |
| Conversational / AI UX 패턴 전반 | **N/A** | AI는 관리자 분류 백오피스에만 있고 사용자 대면 AI 기능이 없다. Source Citation·Confidence Indicator는 관리자 화면(`admin-candidates.tsx:89-92`)에 이미 근거 표시가 있어 충분 |
| Kanban Board / Inbox Layout | **N/A** | 해당 과업 없음 |

### 10.2 `layout-taxonomy`

| 개념 | 판정 | 근거 |
|---|---|---|
| Split-view (Master-Detail) | **ADOPT** | 홈과 검수 화면의 골격. 유지 |
| Mobile-first Stack | **ADOPT** | 760px 단일 브레이크포인트 + 세로 스택. 실측상 오버플로 0건 |
| Off-canvas Panel | **ADOPT** | 모바일 시트가 이 패턴. 접힘 높이만 조정(§9.1) |
| CLS Prevention | **ADOPT** (미완) | 이미지 명시 치수 부재(라이브 6개), 폰트 스왑 재배치 → §9.8·§12에서 처리 |
| Overflow Containment | **ADOPT** | `min-width:0`이 이미 여러 곳에 있고 실측 오버플로 0건. 유지 |
| Aspect-ratio Discipline | **ADAPT** | 카드 이미지 높이가 고정 px(210/180/150)로 되어 있다. `aspect-ratio`로 바꿔 폭 변화에 안정적으로 대응 |
| Fluid (clamp) Layout | **ADOPT** (부분) | 헤딩에 이미 `clamp` 사용. `calc(100vh - 236px)` 매직넘버를 `dvh` + CSS 변수로 정리(§5.5) |
| Sticky Header | **ADAPT** | 현재 헤더는 sticky가 아니다. 지도 화면에서는 오히려 옳다(높이가 귀하다). 목록·상세에서만 검토 |
| Hierarchical Grid / Bento Grid | **REJECT** | 결과 목록은 동등한 항목의 나열이지 위계가 다른 콘텐츠가 아니다. 벤토는 AI slop 신호이기도 하다(§9.9) |
| Brutalism / Anti-design / Maximalism | **REJECT** | 신뢰·명료성이 핵심인 로컬 정보 서비스. 현재의 절제된 에디토리얼 방향과 정면 충돌 |
| Parallax / Scrollytelling | **REJECT** | 지도 앱에 스크롤 서사가 없고 성능·접근성 비용만 든다 |
| Broken Grid / Collage / Diagonal | **REJECT** | 같은 이유 |
| Infinite Canvas | **N/A** | 지도가 이미 무한 캔버스 역할을 한다(SDK 소관) |
| Documentation Layout / Pricing Page / Long-form Sales | **N/A** | 해당 페이지 없음 |

### 10.3 `typography-taxonomy`

| 개념 | 판정 | 근거 |
|---|---|---|
| Gothic (돋움/고딕) 계열 본문 | **ADOPT** | Noto Sans KR. 한글 UI 표준이며 적절 |
| `word-break: keep-all` | **ADOPT** (미적용) | 한국어 조판 필수. 현재 미적용 — §9.8에서 도입 |
| Role Tiers (Display/Headline/Title/Body/Label) | **ADOPT** | 현재 5단이 암묵적으로만 존재. 명시적 토큰화(§9.8) |
| Tabular Numbers (`tnum`) | **ADOPT** | 추천률·표본 수·개수 정렬에 직접 필요. IBM Plex Mono를 이 역할로 좁힌다 |
| rem 기반 크기 | **ADOPT** (미적용) | 현재 전부 px. 사용자 기본 폰트·줌 대응을 위해 최소한 본문·라벨은 rem으로 |
| Fluid Typography (clamp) | **ADOPT** (본문 제외) | 이미 헤딩에 사용 중. 본문에는 쓰지 않는다(범위가 좁고 줌 대응 문제) |
| Serif + Sans Pairing | **REJECT** | 현재 Sans + Mono 조합이 제품 성격(데이터·지도)에 맞다. 세리프 추가는 2026 "크림+세리프+세이지" 기본값으로 수렴하는 길이다 |
| Oversized Display | **ADAPT** | 이미 `clamp(38px,5vw,68px)`로 쓰고 있다. 더 키우지 않는다 — 지도 화면은 정보 밀도가 우선 |
| Kinetic Typography / Brutalist Type / Anti-design Type | **REJECT** | 신뢰 톤과 충돌 |
| Hyphenation / Justified Minimum / Baseline Grid | **N/A** | 한글 조판·웹 환경에 해당 없음 |
| COLRv1 Color Fonts / Variable Fonts | **N/A** | Noto Sans KR 3웨이트로 충분. 한글 가변 폰트는 용량 이득이 불확실 |

### 10.4 `design-taxonomy`

| 개념 | 판정 | 근거 |
|---|---|---|
| Flat Design | **ADOPT** | 현재 방향. 마커 정책 주석(`app.css:29`)이 "sample influence is expressed through external shadow, not 3D fill"로 의도를 명시한 것이 인상적 |
| Swiss / Editorial | **ADAPT** | 각진 그리드·2px 구분선·좌측 정렬이 이미 스위스 계열. 정보 밀도 높은 화면(검수·운영)에서 특히 유지 |
| Sheet / Drawer | **ADOPT** | 모바일 상세 시트. 포커스 관리만 보강(UX-04) |
| Empty / Skeleton | **ADOPT** (부분) | Skeleton은 현재 0건. §9.1에서 도입 |
| Badge / Tag | **ADOPT** | Golden Pick·Hidden Gem 배지가 근거 기반. 유지하되 근거 없는 배지 추가 금지(§9.9) |
| Toast / Snackbar | **ADAPT** | 현재 인라인 메시지만 쓴다. 관리자 벌크 작업 결과에는 토스트가 맞지만, 공개 화면은 인라인 유지(스크린리더 친화적) |
| Progress / Meter | **ADOPT** | Flavor Print `<meter>`가 적절. `MapPlaceDetail.tsx:37`의 `role="progressbar"`만 `meter`로 교정 |
| Glassmorphism | **REJECT** | 지도 위 텍스트 대비를 깨고 저사양 모바일에서 비싸다. 현재 시트는 불투명 흰색인데 이게 옳다 |
| Neumorphism / Claymorphism / Neubrutalism | **REJECT** | 대비·신뢰 문제 |
| Carousel / Lightbox / Gallery | **N/A** | 장소당 이미지 1장 구조 |
| DataTable (정렬·필터·페이지네이션 통합) | **ADAPT** | 관리자 화면에 필요해 보이지만, 현재 검수 워크플로는 테이블이 아니라 레일+인스펙터가 더 맞다. 운영 목록(`admin-places`)에만 제한적 적용 검토 |
| Command Palette | **N/A** | 관리자 과업이 6~7개로 적다 |

### 10.5 `ai-slop-taxonomy`

이 문서는 **음화 사전**이므로 "해당 패턴이 있는가"로 판정한다.

| 패턴 | 현재 상태 | 판정 |
|---|---|---|
| Purple-Blue Gradient / Indigo-500 Accent / Floating Gradient Orb / Mesh·Aurora 배경 | **없음** | REJECT 유지 — 도입 금지(§9.9) |
| Glassmorphism Default / Permanent Dark Mode | **없음** | REJECT 유지 |
| Low-Contrast Body | **부분 해당** — 대비 미달 3건(placeholder 계열) | **수정 대상**. 본문 자체는 18.07:1로 우수 |
| Ubiquitous Soft Shadow | **해당 없음** | 그림자가 "떠 있음"과 "표본 영향력"에만 쓰여 의미가 있다 |
| Inter for Everything / Italic Serif Accent / Repeated Font Combos | **없음** | Noto Sans KR + IBM Plex Mono는 한국어 제품의 의도된 선택 |
| Monospace Body Aesthetic | **경계** — Mono가 eyebrow·카운트·라벨에 광범위 사용 | **ADAPT** — Mono를 숫자·코드 표기로 역할 축소(§9.8) |
| All-Caps Eyebrow | **해당** — `.eyebrow{text-transform:uppercase}`, `CATEGORY / KOREAN`, `PUBLIC / CORRECTION` | **ADAPT** — 라틴 대문자 eyebrow는 한국어 제품에서 장식에 가깝다. 의미 있는 곳(카테고리 식별)만 남기고 폼 페이지의 `PUBLIC / CORRECTION` 류는 제거 |
| Centered Hero / Fixed Section Stack / Canned SaaS Skeleton | **없음** | 랜딩이 지도 자체다. 강점 |
| Icon-Top 3 Feature Cards / Numbered 1-2-3 / Stat Banner Row | **없음** | REJECT 유지 |
| Bento Grid Overuse / Uniform Rounding / Over-Rounded Corners | **없음** | 각진 그리드 유지 |
| Excessive Card Nesting | **경계** — 시트 안 섹션 안 카드가 3단에 근접 | 관찰 대상 |
| shadcn Default Look / Lucide-Only Icons / Pill Eyebrow Badge | **없음** | 수제 CSS라 키트 디폴트 자체가 없다 |
| Emoji Icon Navigation | **부분 해당** — 카테고리 이모지가 마커·칩에 사용 | **ADAPT(정당화됨)** — 지도 마커에서 이모지는 **기능적 식별자**로 작동하고 30px 원 안에서 아이콘보다 인지가 빠르다. 단 내비게이션·버튼으로 확장 금지 |
| Dead "Get Started" CTA | **부분 해당** — `/maps/:slug`의 "내 주변" 버튼이 좌표를 받고 버림(UX-07) | **수정 대상**. 정확히 이 패턴이다 |
| Decorative Status Dots | **해당 없음** | `.session-status i`는 실제 로그인 상태를 나타냄 |
| Sparkle AI Branding | **없음** | AI 기능에 스파클·그라디언트가 없다 |
| Generic Fade-In on Scroll / Motion Without Meaning | **없음** | 모션이 지도 포커스(`map-pin-focus`)와 시트 등장에만 있고 둘 다 의미가 있다 |
| Missing Micro-Interactions | **부분 해당** — 폼 제출 pending이 29개 중 2곳뿐(§5.3) | **수정 대상** |
| Korean AI Translationese | **없음** | 카피가 자연스럽다. "추천할 만한 한 끼를 기록합니다", "이 페이지는 지도 밖에 있어요" |
| AI Buzzword Stack / Vague Aspirational Headline | **없음** | 강점 |
| No Pre-Implementation Verification (근본 원인) | **해당** | 죽은 버튼(UX-07), 죽은 CSS(UX-15), 미등록 `welcome.tsx`, 죽은 미디어 규칙(`app.css:20`) — 생성 후 점검 부재의 전형적 잔재 |
| Mean-Best Aesthetic / No Brand Constraint (근본 원인) | **해당 없음** | 흑백 + 단일 녹색 + 시그널 옐로우, 각진 편집 그리드는 **결정의 흔적이 뚜렷하다**. 이 제품의 시각적 강점이며 개선 과정에서 지켜야 할 자산이다 |

**Dictionary 종합**: 62개 slop 패턴 중 명확히 해당하는 것은 **4건**(저대비 placeholder, 죽은 CTA, 마이크로 인터랙션 부재, 구현 후 점검 부재)이고, 전부 §9와 §12 로드맵에 매핑돼 있다. 시각 방향 자체는 재설계 대상이 아니다.

---

## 11. 기술 대안 및 최신 라이브러리 비교 매트릭스

조사 원칙: 도메인마다 **최소 3개 후보 + "현 상태 유지" 옵션**을 함께 비교했다. 버전·라이선스·발행일은 **npm 공식 레지스트리와 GitHub Security Advisory를 2026-08-07에 직접 조회한 값**이다. **코드에서 확인되지 않은 문제를 라이브러리로 해결한다고 가정하지 않았다** — 각 도메인 첫 줄에 "고정된 문제"를 먼저 적었다.

### 11.1 접근 가능한 UI primitive · 폼

**고정된 문제**: 다이얼로그 포커스 트랩·복원 부재(UX-04), 폼 오류의 `aria-invalid`/`aria-describedby` 코드베이스 0건(UX-05), 제출 pending 부재(29개 중 27개). 수용 기준은 §9.4·§9.8의 체크리스트.

| 후보 | 최신(2026-08-07) | 라이선스 | React 19 | 번들 비용 | Migration 비용 | 결론 |
|---|---|---|---|---|---|---|
| **현 상태 유지 + 자체 5개 컴포넌트** | — | — | — | 0 | 낮음 (Sheet 포커스 트랩 ~60줄, FormField ~40줄) | **KEEP** |
| `@radix-ui/react-*` | `react-dialog` 1.1.23 (2026-07-24) | MIT | 지원 | Dialog만 ~12 kB gz | 중 (스타일 재작성 불필요, 구조 변경 필요) | PILOT 조건부 |
| `react-aria-components` | 1.20.0 (2026-07-31) | Apache-2.0 | 지원 | 큼(~40 kB gz~) | 높음 | REJECT |
| `@base-ui/react` | 1.7.0 (2026-08-04) | MIT | 지원 | 중 | 중 | REJECT(현시점) |
| `@ark-ui/react` | 5.38.0 (2026-08-03) | MIT | 지원 | 중 | 중 | REJECT |
| `@headlessui/react` | 2.2.10 (2026-04-07) | MIT | 지원 | 작음 | 낮음 | REJECT |

**결론: KEEP (현행 hand-authored 유지) + 자체 컴포넌트 5개 신설.**

근거: 이 제품에서 접근성이 필요한 오버레이는 **2개**(`PlaceDetailSheet`, `MapPlaceDetail`)뿐이고 나머지는 폼과 리스트다. 라이브러리 도입 비용(번들 + 학습 + 스타일 재작성)이 60줄짜리 포커스 트랩 훅보다 크다. `@base-ui-components/react`가 `@base-ui/react`로 **패키지 이름이 바뀐 사실**(구 패키지 deprecated, 메시지 "Package was renamed to @base-ui/react")도 현시점 채택을 미룰 이유다.

**도입 조건(재검토 트리거)**: 오버레이·메뉴·툴팁·콤보박스가 총 6개를 넘거나, 자체 구현이 접근성 회귀를 두 번 이상 낸 경우 → Radix 개별 primitive만 부분 도입(PILOT).

### 11.2 표 · 가상화

**고정된 문제**: `reviewer-ratings.tsx:18-27`의 무제한 조회, `admin-candidates`의 300건 캡. **둘 다 렌더 성능 문제가 아니라 쿼리 설계 문제다.**

| 후보 | 최신 | 라이선스 | 결론 |
|---|---|---|---|
| **현 상태 유지 (서버 페이지네이션 + 100행 캡)** | — | — | **KEEP** |
| `@tanstack/react-table` | 9.0.0 (2026-08-04) | MIT | REJECT |
| `@tanstack/react-virtual` | 3.14.9 (2026-07-28) | MIT | REJECT |
| `react-window` | 2.3.0 (2026-07-20) | MIT | REJECT |

**결론: KEEP.** 현재 화면에 100행을 넘는 목록이 없다. 가상화는 **문제가 없는 곳의 해결책**이다. `@tanstack/react-table`이 9.0.0 메이저를 낸 직후(2026-08-04)라는 점도 지금 붙을 이유가 아니다.

**도입 조건**: 단일 화면에서 500행 이상을 렌더해야 하는 요구가 실측 근거와 함께 생길 때 → `@tanstack/react-virtual`만(테이블 추상화 없이).

### 11.3 지도 · 클러스터링 · 상태 동기화

**고정된 문제**: 마커 전체 재생성으로 인한 INP 위험(§6.7), 자체 `region-cluster-policy.ts` 유지 비용.

| 후보 | 상태(2026-08-07 확인) | 결론 |
|---|---|---|
| **현 상태 유지 (Naver SDK + 자체 행정구역 클러스터)** | 자체 `buildRegionClusters`가 **행정구역 라벨 기반**(광산구 12 같은 지명 + 개수) | **KEEP** |
| Naver Maps 공식 `MarkerClustering` | 공식 문서에 마커 클러스터 예제·라이브러리가 존재함을 확인 | ADAPT 후보 |
| `supercluster` | 8.0.1 (2023-04-27, ISC) — **3년 이상 릴리스 없음** | REJECT |
| `maplibre-gl` | 6.2.0 (2026-08-06, BSD-3-Clause) — 활발 | REJECT |

**결론: KEEP.**

근거가 중요하다. 일반적인 클러스터링 라이브러리(supercluster, MarkerClustering)는 **밀도 기반 원형 클러스터**를 만든다. 그런데 이 제품의 클러스터는 `region-cluster-policy.ts`가 만드는 **행정구역 단위 라벨**이다 — "광산구 12"처럼 지명이 나오고, 좌측 리스트도 같은 그룹 구조를 공유하며(`map-region-group__heading`), 클릭 시 해당 구역으로 이동한다. **이것은 지도 라이브러리 기능이 아니라 제품 결정이다.** 지역 음식 탐색에서 "이 원 안에 12개"보다 "광산구에 12곳"이 훨씬 유용하다. 밀도 클러스터로 바꾸면 제품이 나빠진다.

`maplibre-gl`은 활발하지만 **네이버 지도 타일·길찾기 생태계를 버리는 결정**이며 D-07(NAVER Maps 확정)을 뒤집는다. 한국 로컬 서비스에서 이 교체는 근거가 부족하다.

**대신 해야 할 것(라이브러리 없이)**: `PlaceMap.tsx:120-163`의 마커 effect를 **선택 상태 변경 시 전체 재생성하지 않도록** 분리한다. 마커 인스턴스를 `Map<placeId, Marker>`로 유지하고 `selected` 변경 시 해당 마커의 className만 갱신한다. 이것이 INP 문제의 실제 해법이다.

### 11.4 Validation · Data layer

**고정된 문제**: `/admin/data-sync`의 `sourceType`·`addressField`가 zod 없이 타입 단언만 거침(§7.1). 그 외 입력 검증은 이미 zod로 처리된다.

| 후보 | 최신 | 라이선스 | 결론 |
|---|---|---|---|
| **zod (현행)** | 4.4.3 (2026-05-04) | MIT | **KEEP** |
| `valibot` | 1.4.2 (2026-06-28) | MIT | REJECT |
| `arktype` | 2.2.3 (2026-07-07) | MIT | REJECT |
| `drizzle-zod` | 0.8.3 (2025-08-06) | Apache-2.0 | **PILOT** |

**결론: zod KEEP + `drizzle-zod` PILOT.**

zod 4.4.3은 프로젝트가 선언한 버전이자 레지스트리 최신이며 트리에 단일 버전으로 정합한다. valibot으로 바꿀 번들 이득은 이 앱의 서버 중심 검증 구조에서 거의 없다(검증이 대부분 Worker에서 실행된다). `valibot@1.4.2`가 이미 dev 트리에 있지만 이는 `@react-router/dev`의 의존이지 채택 근거가 아니다.

`drizzle-zod`는 다르다 — `schema.ts`에서 검증 스키마를 파생하면 **스키마-검증 드리프트가 구조적으로 사라진다**. 다만 최신 릴리스가 2025-08-06으로 1년 가까이 지났으므로 유지보수 상태를 확인한 뒤 **admin action 3개에만 파일럿**하고 회귀가 없으면 확대한다.

### 11.5 관측 가능성

**고정된 문제**: cron 실패 무통지(QLT-04), 작업별 오류 격리 없음, 구조화 로그 없음.

| 후보 | 상태 | 결론 |
|---|---|---|
| **현 상태 유지 (Workers Observability, `head_sampling_rate: 1`)** | 공식 문서 페이지 확인(200) | **KEEP** (샘플링 조정 필요) |
| `@sentry/cloudflare` | 10.69.0 (2026-07-29), MIT | **PILOT** |
| OpenTelemetry (`@opentelemetry/api` 1.9.1, 2026-03-25) | Apache-2.0 | REJECT |
| Cloudflare Web Analytics | 공식 문서 페이지 확인(200) | ADOPT (별건, §11.7) |

**결론: KEEP + 샘플링 조정 + Sentry PILOT.**

주의할 점이 있다. `head_sampling_rate: 1`은 관측에는 좋지만 **SEC-03·SEC-04의 증폭 요인**이다 — 토큰과 위치가 URL에 실리는 한 100% 로깅은 유출 경로가 된다. 순서가 중요하다: **먼저 토큰·위치를 URL에서 빼고, 그 다음에 샘플링을 유지**한다. URL 정리 없이 샘플링만 낮추는 것은 위험을 줄이는 게 아니라 감추는 것이다.

Sentry PILOT의 실제 목표는 오류 추적이 아니라 **알림 채널**이다. QLT-04(야간 cron 실패 무통지)를 해결하려면 통지 대상이 필요한데, 운영 문의 이메일이 아직 확정되지 않았다. Sentry는 이메일 확정과 무관하게 알림 대상을 만들 수 있다. 도입 조건: 개인정보(사용자 이메일·위치)가 이벤트에 실리지 않도록 `beforeSend` 스크러빙을 먼저 작성할 것.

**라이브러리 없이 먼저 할 것**: `workers/app.ts:17`의 `Promise.all`을 작업별 try/catch로 감싸 실패를 `operational_alerts`에 반드시 기록하게 만든다. 이게 5줄이고 가장 큰 이득이다.

### 11.6 테스트 · 접근성 · 보안 도구

**고정된 문제**: E2E 프로비저닝 결함(QLT-01), 커버리지 미측정(QLT-09), 접근성 자동 검사 0건, CI 부재(QLT-02).

| 후보 | 최신 | 라이선스 | 결론 |
|---|---|---|---|
| **Playwright (현행)** | 1.62.1 (2026-07-30) — **프로젝트와 동일** | Apache-2.0 | **KEEP** |
| `@axe-core/playwright` | 4.12.1 (2026-06-23) / `axe-core` 4.13.0 (2026-08-05) | MPL-2.0 | **ADOPT** |
| `eslint-plugin-jsx-a11y` | 6.10.2 (**2024-10-26** — 22개월 정체) | MIT | PILOT |
| `pa11y` | 9.1.1 (2026-02-26) | LGPL-3.0-only | REJECT |
| `@vitest/coverage-v8` | (vitest 4.1.10과 동기) | MIT | **ADOPT** |

**결론: Playwright KEEP, `@axe-core/playwright` ADOPT, coverage ADOPT, jsx-a11y PILOT, pa11y REJECT.**

`@axe-core/playwright`는 이미 있는 E2E 인프라에 붙는 3줄 추가이며, §5.4에서 수동으로 찾은 대비·aria 문제를 **회귀로 잡아준다**. 이 오딧의 결과를 유지하는 가장 싼 방법이다. 단 QLT-01(프로비저닝)을 먼저 고치지 않으면 axe 검사도 같이 실패한다 — **순서가 QLT-01 → axe다.**

`pa11y`를 REJECT하는 이유는 기능이 아니라 **LGPL-3.0-only 라이선스**다. dev 의존이라 실질 위험은 낮지만, 같은 일을 MPL-2.0인 axe로 할 수 있으면 라이선스 표면을 늘릴 이유가 없다.

`eslint-plugin-jsx-a11y`는 최신 릴리스가 2024-10-26으로 22개월 정체다. 규칙 자체는 안정적이라 PILOT은 가능하나, **이 프로젝트에 ESLint 설정 자체가 없다**는 게 더 큰 문제다 — lint 인프라를 먼저 세울 때 함께 검토한다.

### 11.7 성능 · 실사용 모니터링(RUM)

**고정된 문제**: 현재 RUM이 **없다**. 4주차 완료 기준의 "LCP 2.5초"를 측정할 수단이 없다.

| 후보 | 최신 | 라이선스 | 결론 |
|---|---|---|---|
| **현 상태 유지 (없음)** | — | — | REJECT — 측정 없이 목표를 선언할 수 없다 |
| `web-vitals` | 6.1.0 (2026-08-05) | Apache-2.0 | **ADOPT** |
| Cloudflare Web Analytics | 공식 문서 확인(200) | **ADOPT** |
| `@sentry/cloudflare` performance | 10.69.0 | MIT | PILOT (§11.5와 묶어서) |

**결론: `web-vitals` + Cloudflare Web Analytics 둘 다 ADOPT.**

`web-vitals` 6.1.0은 gzip 2 kB 미만이고 LCP·INP·CLS를 실사용자 기준으로 수집한다. Cloudflare Web Analytics는 이미 Cloudflare에 있으므로 추가 비용이 없고 쿠키리스다 — **개인정보 인벤토리를 다시 어기지 않으려면 이 점이 중요하다**(GA 도입은 인벤토리·처리방침 갱신을 또 요구한다).

**도입 조건**: 수집 엔드포인트가 개인 식별자를 남기지 않을 것. `web-vitals` 이벤트를 자체 엔드포인트로 보낸다면 그 경로도 인벤토리에 등재할 것. **이 오딧이 지적한 실수(도구 추가 후 문서 미갱신)를 반복하지 말 것.**

### 11.8 스택 자체의 최신성 (교체 아님, 확인)

npm 공식 레지스트리 조회(2026-08-07) 결과, **이 프로젝트는 사실상 최신 스택이다**:

| 패키지 | 프로젝트 선언 | 레지스트리 최신 | 판정 |
|---|---|---|---|
| `react` / `react-dom` | ^19.2.7 | **19.2.8** (2026-07-21) | 최신 |
| `react-router` | ^8 | **8.3.0** (2026-07-22, GitHub 릴리스로 교차 확인) | 최신 |
| `typescript` | 7.0.2 | **7.0.2** (2026-07-08) | 최신 |
| `zod` | ^4.4.3 | **4.4.3** (2026-05-04) | 최신 |
| `drizzle-orm` | ^0.45.2 | **0.45.2** (2026-03-27) | 최신 |
| `tailwindcss` | ^4.2.2 | 4.3.3 (2026-07-16) | 범위 내 |
| `wrangler` | ^4.118.0 | 4.119.0 (2026-08-05) | 범위 내 |
| `playwright` | ^1.62.1 | **1.62.1** (2026-07-30) | 최신 |

**업그레이드가 필요한 항목은 없다.** 유일한 의존성 조치는 §7.5의 `undici` override이며, 그것도 dev 전용이라 긴급하지 않다. 스택 최신성은 이 프로젝트의 강점이므로 "낡은 의존성 정리" 류 작업을 로드맵에 넣지 않았다.

### 11.9 매트릭스 종합

| 도메인 | 결론 | 조치 |
|---|---|---|
| UI primitive·폼 | **KEEP** | 자체 컴포넌트 5개 신설 |
| 표·가상화 | **KEEP** | 쿼리 설계로 해결 |
| 지도·클러스터링 | **KEEP** | 마커 재생성만 최적화 |
| Validation | **KEEP** + `drizzle-zod` **PILOT** | admin action 3개 파일럿 |
| 관측 가능성 | **KEEP** + Sentry **PILOT** | 먼저 try/catch 5줄 |
| 테스트·접근성 | Playwright **KEEP**, axe·coverage **ADOPT** | QLT-01 선행 |
| RUM | web-vitals + CF Web Analytics **ADOPT** | 인벤토리 등재 동시 |
| 스택 버전 | **KEEP** | undici override만 |

**7개 도메인 중 5개가 KEEP이다.** 신규 런타임 의존성은 `web-vitals`(2 kB) 하나이고, 나머지 ADOPT는 전부 devDependency다. 이 결론은 "hand-authored 구현이 더 적합하면 유지를 우선한다"는 의뢰 원칙에 따른 것이며, 각 도메인의 "고정된 문제"가 대부분 **라이브러리로 풀리지 않는 설계·프로비저닝 문제**였기 때문이다.

---

## 12. P0/P1/P2 로드맵과 독립 PR 구현 순서

각 PR은 **독립적으로 리뷰·머지 가능한 크기**로 잘랐다. 의존 관계가 있는 곳만 명시했다.

### 12.1 P0 — 공개 베타 차단 해소 (7개 PR)

| PR | 범위 | 대상 결함 | 예상 크기 | 의존 |
|---|---|---|---|---|
| **PR-1** | E2E 프로비저닝 수리 — `globalSetup`으로 시드 분리, `reuseExistingServer: !process.env.CI`, 포트 랜덤화, `login.spec` 자가 오염 수정 | QLT-01 | 중 (config + setup 파일 1개) | 없음 |
| **PR-2** | CI 파이프라인 신설 — typecheck·build·unit·integration·e2e를 PR 체크로. `packageManager` 고정 | QLT-02, QLT-10 | 중 | **PR-1 선행 필수** (안 그러면 CI가 항상 빨강) |
| **PR-3** | Rate limit 도입 — Cloudflare Rate Limiting 바인딩 또는 D1 카운터를 `/login`·`/signup`·`/forgot-password`·`/corrections/new`에 | SEC-01, SEC-02(부분) | 중 | 없음 |
| **PR-4** | 메일 경로 안전화 — `/corrections/new` env 검사를 insert 이전으로, 이메일 쿨다운, 에러코드 사용자 문구 매핑 | SEC-02, QLT-03 | 소 | PR-3과 함께면 좋음 |
| **PR-5** | 토큰을 URL에서 분리 — 인증·재설정·정정 링크를 랜딩 페이지 + POST 소비 구조로. GET loader 소비 제거 | SEC-03, ARC-11 | 중 | 없음 |
| **PR-6** | 위치정보 처리 정리 — bbox를 로그에서 제외(또는 좌표 정밀도 축소), 처리방침·인벤토리를 실제 동작에 맞게 수정 | SEC-04 | 소(코드) + 법무 검토 | PR-5와 같은 릴리스 권장 |
| **PR-7** | 개인정보 문서 갱신 — Resend 위탁·국외 이전, 비회원 이메일, 리뷰어 직업, 비밀번호·토큰, 제안·감사·AI 로그를 인벤토리·처리방침에 등재. `privacy.tsx:11,16`의 미확정 항목(계약 주체, 보호책임자) 확정 | SEC-06 | 소(코드) + 운영 결정 | 없음 |

**결정 트랙 D-1 (PR 아님, 결정 먼저)**: **SEC-05 회원 탈퇴 정책 — "익명화로 충분한가, 하드 삭제까지 제공하는가"**. 권장은 익명화다 — 투표 이력이 평가 계산의 입력이라 하드 삭제는 과거 스냅샷의 재현성을 깨뜨린다. **익명화 트랙은 현 스키마로 착수 가능**하므로(restrict는 DELETE만 막는다, §7.4) 결정 후 곧바로 탈퇴 라우트 + `users.status/withdrawnAt` 컬럼 추가 마이그레이션(제약 변경 아님)으로 **PR-8**이 된다. 하드 삭제를 택할 때만 restrict 3곳의 제약 변경 마이그레이션이 추가된다.

### 12.2 P1 — 출시 직후 (11개 PR + 결정 D-2)

프로덕션 경계가 "P1 전량"을 요구하므로, P1 14건 각각에 완료 PR 또는 결정을 명시한다(1차 리뷰 차단 항목 4 반영 — SEC-10·SEC-11·QLT-04·DOC-01의 완료 수단을 추가).

| PR | 범위 | 대상 결함 | 크기 |
|---|---|---|---|
| **PR-9** | 점수 단일 출처 — `listPlaces`가 v2 스냅샷을 leftJoin, 마커 influence도 유효 표본 기준으로 | ARC-01 | 중 |
| **PR-10** | `PlaceDetailSheet` fetcher 분리 (load용·submit용) + 로드 실패 상태 | ARC-02, UX-04(일부) | 소 |
| **PR-11** | primary 카테고리 단일성 — import·upsert에서 기존 primary 해제 + 부분 유니크 인덱스 마이그레이션 | ARC-03 | 소 |
| **PR-12** | 인증 하드닝 — 재설정 시 전 세션 삭제, `consumeToken` affected-rows 원자 소비, 로그인 계정 열거 완화(동일 문구 + 미존재 이메일도 더미 KDF로 타이밍 평탄화) | SEC-07, SEC-08, **SEC-10** | 소 |
| **PR-13** | 보안 헤더 — `workers/app.ts`에 CSP(Naver·Google Fonts 허용)·HSTS·nosniff·frame-deny·Referrer-Policy(no-referrer on auth)·Permissions-Policy(geolocation self) | SEC-09 | 소 |
| **PR-13b** | 지표 쓰기 경로 교정 — `recordPlaceDetailView`를 GET loader에서 분리(POST 액션 또는 서버측 비파생 집계로), 배지 판정 입력 오염 차단 | **SEC-11**, ARC(§6.1 경계위반) | 소 |
| **PR-13c** | 운영 통지 — `workers/app.ts:17`의 `Promise.all`을 작업별 try/catch로 감싸 실패를 `operational_alerts`에 반드시 기록 + 외부 통지 훅(§11.5 Sentry PILOT 또는 임시 웹훅). **QLT-04는 P1이며 P3 관측 묶음으로 미루지 않는다** | **QLT-04** | 소 |
| **PR-14** | 로그인 맥락 복귀 — `safeReturnTo` 허용목록 복원, hidden 필드, 시트 링크를 `Link`로 | UX-01 | 소 |
| **PR-15** | 폼 접근성·복구 — 가입 오류 시 폼 유지, `role=alert`·`aria-invalid`·`aria-describedby`, `PendingButton` 도입 | UX-02, UX-05(일부), slop "마이크로 인터랙션 부재" | 중 |
| **PR-16** | 탐색성 최소 집합 — 전 공개 라우트 `meta`, 장소 상세 OG·canonical·JSON-LD(Restaurant, `aggregateRating` 제외), `robots.txt`, `sitemap.xml`. 랜딩 `h1` 추가(UX-09) | UX-03, **UX-09** | 중 |

**결정 트랙 D-2 (PR 아님, 결정 먼저)**: **DOC-01 서비스명 확정** — `Re:Taste` vs `Tasted : IT`. 코드·법무·README는 `Re:Taste`, v2 스펙(`:1·:19`)은 `Tasted : IT`. 운영 결정이 선행되며, 확정 후 v2 스펙 1곳과 잔여 표기를 정합화하는 문서 PR(**PR-16b**, 소)로 닫는다.

### 12.3 P2 — 성장 전 (묶음 6개)

| 묶음 | 범위 | 대상 |
|---|---|---|
| **PR-17** | 데이터 정확성 — stale 스냅샷 선택 수정, 병합 후 재계산 트리거 + 부수 데이터 이관, 동일 값 재투표 무시 | ARC-04, ARC-06, ARC-08 |
| **PR-18** | 관리자 워크플로 — 일괄 승인을 선택 ID 직접 조회로, 실제 대기 건수 표시, 표시 상한 명시, 도메인 에러 try/catch(500 대신 인라인), 403 전용 화면 | ARC-05, ARC-07, UX-06, §9.6 |
| **PR-19** | 지도 UX — 카테고리 카운트 bbox 정합, 0곳 배너, 마커 인스턴스 재사용(INP), `/maps/:slug` 죽은 버튼·상태 파괴 수정 | ARC-09, UX-07, §9.1, §11.3 |
| **PR-20** | 디자인 토큰 3층 + 대비 수정 + `keep-all` + 9~11px 제거 + 공통 컴포넌트 5개(Sheet 포커스 트랩으로 UX-04 마감, FormField로 UX-05 마감, skip-link `#main` 4곳 UX-10) | UX-04, UX-05, UX-08, UX-10, UX-11, UX-12, UX-13, §9.8 |
| **PR-21** | 문서·런북 정리 — 배포 secret 목록, week1 런북 분할·명령 수정, AI 런북 수치 동기화, 운영 D1 QA 시드 지시 제거, 폐기 문서(DOC-02 감사 로그 화면 미구현·DOC-03 인증 방식 3중 불일치)의 스펙-코드 정합화 | QLT-06, QLT-07, QLT-08, DOC-02, DOC-03 |
| **PR-21b** | 테스트 격리 2차 — 통합 테스트 전용 wrangler 설정(AI binding·운영 DB id 제거), chromium/mobile 프로젝트 상태 격리 | QLT-05 |

> UX-09(랜딩 h1)는 §3에서 P2로 분류했으나 탐색성 PR-16과 원인·수정이 겹쳐 P1 PR-16에서 함께 닫는다(조기 처리, 강등 아님).

### 12.4 P3 — 관측·정리 (묶음 3개)

| 묶음 | 범위 | 대상 |
|---|---|---|
| **PR-22** | 관측 — 커버리지 설정(`@vitest/coverage-v8`), `@axe-core/playwright`, `web-vitals` + CF Web Analytics. (작업별 try/catch·외부 통지는 QLT-04로 P1 PR-13c에서 선행) | QLT-09 |
| **PR-23** | 정리 — `upsertBetaUser` 삭제, QA 시드 환경 가드, 죽은 CSS·`welcome.tsx` 제거, FK 드리프트 동기화, `undici` pnpm.overrides, `.dev.vars.example` 정정, reduced-motion 커버리지 구멍, `pnpm deploy` 표기·`packageManager` 고정 | SEC-12, SEC-13, SEC-14, ARC-12, UX-14, UX-15, QLT-10 |
| **PR-24** | 잔여 소규모 — Naver SDK 로드 실패 재시도(모듈 promise 리셋), Flavor Print 템플릿-카테고리 정합 검증 | ARC-10, SEC-15 |

> ARC-11(GET 토큰 소비)은 P0 PR-5에서 SEC-03과 함께 닫으므로 P3 묶음에 중복 배치하지 않는다.

### 12.5 순서 요약

```
1주차   PR-1 → PR-2        (게이트 복구 — 이후 모든 PR이 CI 신호를 받는다)
        PR-3, PR-4         (남용 차단, 병렬 가능)
2주차   PR-5, PR-6, PR-7   (토큰·위치·문서, 같은 릴리스 권장)
        [결정 D-1] 탈퇴 정책 → PR-8
3주차   PR-9 ~ PR-13c      (정확성·보안·지표경로·운영통지 마감)
4주차   PR-14 ~ PR-16      (UX·탐색성)  · [결정 D-2] 서비스명 → PR-16b
이후    PR-17 ~ PR-24 + PR-21b
```

release boundary 정합: **공개 베타**는 P0(PR-1~PR-7 + 결정 D-1→PR-8) 완료가 조건. **프로덕션**은 그 위에 P1 전량(PR-9~PR-16 + PR-13b·13c + 결정 D-2→PR-16b) 완료가 조건. P2·P3(PR-17~24, 21b)는 프로덕션 차단이 아니다.

**PR-1과 PR-2를 가장 먼저 두는 이유**: 이 두 개가 없으면 이후 모든 PR이 "검증 없이 머지"된다. 지금 이 오딧이 발견한 것들 중 상당수가 정확히 그 결과다.

### 12.6 55개 finding → PR·결정·비조치 1:1 매핑 (정본)

§3의 55개 ID 전부를 **정확히 하나**의 처리에 매핑한다. 이 표가 로드맵의 정본이며, 위 12.1~12.4 묶음 설명과 충돌하면 이 표를 따른다. "명시적 비조치"는 근거와 함께 남긴 의도적 미조치다.

| ID | P | 처리 | ID | P | 처리 |
|---|---|---|---|---|---|
| SEC-01 | P0 | PR-3 | UX-01 | P1 | PR-14 |
| SEC-02 | P0 | PR-3 + PR-4 | UX-02 | P1 | PR-15 |
| SEC-03 | P0 | PR-5 | UX-03 | P1 | PR-16 |
| SEC-04 | P0 | PR-6 | QLT-03 | P1 | PR-4 |
| SEC-05 | P0 | 결정 D-1 → PR-8 | QLT-04 | P1 | PR-13c |
| SEC-06 | P0 | PR-7 | DOC-01 | P1 | 결정 D-2 → PR-16b |
| QLT-01 | P0 | PR-1 | ARC-04 | P2 | PR-17 |
| QLT-02 | P0 | PR-2 | ARC-05 | P2 | PR-18 |
| ARC-01 | P1 | PR-9 | ARC-06 | P2 | PR-17 |
| ARC-02 | P1 | PR-10 | ARC-07 | P2 | PR-18 |
| ARC-03 | P1 | PR-11 | ARC-08 | P2 | PR-17 |
| SEC-07 | P1 | PR-12 | ARC-09 | P2 | PR-19 |
| SEC-08 | P1 | PR-12 | QLT-05 | P2 | PR-21b |
| SEC-09 | P1 | PR-13 | QLT-06 | P2 | PR-21 |
| SEC-10 | P1 | PR-12 | QLT-07 | P2 | PR-21 |
| SEC-11 | P1 | PR-13b | QLT-08 | P2 | PR-21 |
| UX-04 | P2 | PR-10(일부) + PR-20 | UX-05 | P2 | PR-15(일부) + PR-20 |
| UX-06 | P2 | PR-18 | UX-07 | P2 | PR-19 |
| UX-08 | P2 | PR-20 | UX-09 | P2 | PR-16(조기) |
| UX-10 | P2 | PR-20 | UX-11 | P2 | PR-20 |
| UX-12 | P2 | PR-20 | DOC-02 | P2 | PR-21 |
| DOC-03 | P2 | PR-21 | SEC-12 | P3 | PR-23 |
| SEC-13 | P3 | PR-23 | SEC-14 | P3 | PR-23 |
| SEC-15 | P3 | PR-24 | ARC-10 | P3 | PR-24 |
| ARC-11 | P3 | PR-5 | ARC-12 | P3 | PR-23 |
| QLT-09 | P3 | PR-22 | QLT-10 | P3 | PR-23 |
| UX-13 | P3 | PR-20 | UX-14 | P3 | PR-23 |
| UX-15 | P3 | PR-23 | — | — | — |

**명시적 비조치 (finding이 아닌 관측이라 PR을 만들지 않음)**: 없음 — 55건 전부 PR 또는 결정에 매핑했다. 다만 UX-04·UX-05는 두 PR에 나눠 걸치므로(각각 부분+마감) "1:1"의 예외로 명시한다. 나머지 51건은 정확히 하나의 처리에 매핑된다. 검증: 위 표의 좌우 두 열을 합치면 SEC 15 + ARC 12 + QLT 10 + UX 15 + DOC 3 = **55건**이며 중복은 ARC-11(PR-5, 표기 1회)뿐이다.

---

## 13. 주요 finding 상세 — 재현 절차 · 정확한 위치 · 영향 · 수정안 · 수용 기준

**55개 finding 전건**을 다룬다(1차 리뷰 차단 항목 1 반영 — 이전 판(§13이 10건만 상세)의 "P2·P3는 §3 표로 충분" 임의 면제를 철회했다). §13.1은 재현이 무거운 P0/P1 핵심 10건을 장문으로, §13.2는 나머지 45건을 같은 5필드 계약(재현/확인 절차 · 정확한 `파일:라인` · 사용자/사업/보안 영향 · 구체 수정안 · 수용 기준)으로 다룬다. §12.6의 55개 매핑과 이 절의 55개 finding은 1:1로 대응한다.

### 13.1 P0/P1 핵심 10건 (장문)

### SEC-01 — rate limit 전무 + 인증 전 PBKDF2 99,999회 (심각도 High)

**확인된 사실 (실행 재현 아님)**
- `app/`·`workers/` 전체에 rate limit 코드가 없다([확인] grep 0건). `wrangler.jsonc`에 `ratelimit` 바인딩이 없다([확인]).
- `login` action은 시도 횟수·지연·잠금을 두지 않는다([확인] `login.tsx:16-27`).
- 인증 시도마다 `verifyPassword`가 PBKDF2 99,999회를 돈다([확인] `password.server.ts:1`, `account.server.ts:63`).

**미실행 재현 절차 (부하 시험은 수행하지 않았다 — 아래는 결과가 아니라 절차다)**
1. `POST /login`에 임의 자격증명으로 다회 반복 요청 → 차단·지연·잠금이 없는지 관찰.
2. 실재 이메일 사용 시 `verifyPassword` 실행으로 응답 지연이 커지는지 관찰(계정 열거 SEC-10과 같은 신호).
3. Worker CPU 소비·과금 증가를 대시보드로 관찰.
> 이 절차의 결과 수치(예: "100회 후 차단 없음")는 **측정하지 않았다.** 실효 악용 여부는 Cloudflare 계정 레벨 방어(WAF·Bot Fight Mode) 존재에 좌우되며 그 상태는 미검증이다(§14.2).

**위치** — `app/routes/login.tsx:16-27`(action에 시도 제한 없음), `app/features/auth/account.server.ts:63`(`verifyPassword` 호출), `app/features/auth/password.server.ts:1`(`PASSWORD_HASH_ITERATIONS = 99_999`), `wrangler.jsonc`(ratelimit 바인딩 없음).

**영향 (도달 경로 명시)** — 사용자: 크리덴셜 스터핑 시도가 무제한이라 약한 비밀번호 계정 탈취 표면이 넓다(단, 직접 인증 우회는 아니다). 사업: 인증 전 무제한 고비용 KDF라 요청당 100k PBKDF2가 Worker CPU 과금을 증폭한다 — DoS 비용비가 공격자에게 유리하다. **왜 P0인가**: 공개 URL + 임의 가입이 열리는 순간 위 두 표면이 동시에 노출되므로 심각도 High여도 공개 차단 우선순위는 P0다.

**수정안**
```
1. Cloudflare Rate Limiting 바인딩을 wrangler.jsonc에 추가하거나,
   D1에 (key, window_start, count) 테이블 + batch upsert로 카운터 구현.
2. 키: IP + 이메일 해시. 창: 로그인 15분 5회, 가입 1시간 3회,
   비밀번호 재설정 1시간 3회, 정정 요청 1시간 3회.
3. 초과 시 429 + Retry-After. 잠금이 아니라 지연이므로 계정 잠금 DoS를 만들지 않는다.
4. 실패 시도는 성공/실패 무관하게 카운트(타이밍 열거 완화와 함께).
```

**수용 기준**
- [ ] `/login` 6번째 시도가 429를 받는다.
- [ ] 429 응답에 `Retry-After`가 있다.
- [ ] 정상 사용자의 오타 3회는 차단되지 않는다.
- [ ] rate limit 설정이 **리포지토리에 파일로 존재**한다(대시보드 설정에만 의존하지 않는다 — 현재 "Cloudflare가 막아주겠지"라는 가정을 검증할 방법이 없는 것이 문제다).

### SEC-02 — 미인증 임의 주소 메일 발송 (심각도 High)

**확인된 사실 (코드 경로, 실행 재현 아님)**
- `/corrections/new` action은 `getOptionalUser`만 호출하고 미인증도 통과시킨다([확인] `place-correction.tsx:4`).
- 발송 대상이 폼 입력 이메일이다: `requesterEmail: String(form.get("email") ?? user?.email ?? "")` → `sendAccountEmail({... to: result.email ...})`([확인]).
- 이 경로에 rate limit·중복 억제·honeypot이 없다([확인] grep 0건).

**미실행 재현 절차 (실제 발송은 하지 않았다 — 의뢰서가 이메일 발송을 금지)**
1. 로그아웃 상태로 `/corrections/new` 접속.
2. 확인 이메일 필드에 임의 주소를 입력하고 제출.
3. (미수행) 그 주소로 발신 메일이 도착하는지, 반복 제출이 제한되는지 관찰.
> 실제 발송·평판 훼손은 **재현하지 않았다.** Resend 계정측 발송 제한·SPF/DKIM/DMARC 상태도 미검증이라(§14.2) 피해 규모는 [추론]이다.

**위치** — `app/routes/place-correction.tsx:4`. 동일 구조가 `forgot-password.tsx:8`, `signup.tsx:19`에도 있다(이 둘은 자기 주소 확인이라는 정당성이 있으나 역시 무제한).

**영향 (도달 경로 명시)** — 사업: 무제한 미인증 발송은 Resend 쿼터 소진과 발신 도메인 평판 훼손으로 이어질 수 있다. 사용자: 임의 주소로 원치 않는 메일. 보안: 서비스가 발송 릴레이로 오용될 표면. **왜 P0인가**: 공개 시 임의 사용자가 즉시 도달하는 미인증 발송 경로이므로 심각도 High여도 공개 차단 우선순위는 P0다.

**수정안**
```
1. SEC-01의 rate limit을 이 경로에 우선 적용(IP 시간당 3, 이메일 일 3).
2. 로그인 사용자는 계정 이메일 강제 사용(입력 필드 readonly).
3. 비로그인 제출은 유지하되 honeypot 필드 + 최소 체류 시간 검사 추가
   (CAPTCHA보다 가볍고 UX 비용이 없다).
4. 동일 (placeId, email) 조합의 미검증 요청이 이미 있으면 새 메일을 보내지 않고
   "이미 확인 메일을 보냈어요"로 응답.
```

**수용 기준**
- [ ] 동일 IP 4번째 요청이 429.
- [ ] 미검증 요청이 있는 조합에 중복 메일이 나가지 않는다.
- [ ] honeypot이 채워진 제출이 조용히 성공 응답을 받되 메일은 나가지 않는다.

### SEC-03 — 토큰이 URL 쿼리로 이동 + 전 요청 로깅

**재현**
1. 비밀번호 재설정을 요청해 메일을 받는다.
2. 링크가 `…/reset-password?token=<32바이트 랜덤>` 형태임을 확인.
3. `wrangler.jsonc:23`의 `head_sampling_rate: 1` 설정 확인 → Workers Logs가 요청 URL을 기록한다면 토큰이 평문으로 남는다.

**위치** — `app/routes/signup.tsx:19`, `app/routes/forgot-password.tsx:8`, `app/routes/place-correction.tsx:4`(URL 생성), `wrangler.jsonc:21-24`(로깅).

**영향** — 로그 열람 권한자가 30분 이내 유효한 재설정 토큰을 획득해 계정을 탈취할 수 있다. 브라우저 히스토리·Referer 유출 경로도 열린다.

**위협 모델 (수정안 설계의 전제)**
URL에 실린 값이 그 자체로 재설정 권한을 갖는 **bearer**인지가 핵심이다. `?token=<32B>`는 명백한 bearer다. 그런데 `/reset-password/<opaque-id>`로 이름만 바꾸고 서버가 그 ID로 실토큰을 조회해 폼에 hidden으로 내보내면, **그 opaque-id 역시 "제출하면 재설정이 되는" bearer**가 된다 — Cloudflare invocation log의 fetch 메시지는 요청 URL을 포함하고 `head_sampling_rate: 1`(`wrangler.jsonc:23`)이 전 요청을 기록하므로, 로그·히스토리·공유로 유출되면 결과가 같다. 따라서 "ID로 이름 바꾸기"는 그 자체로 해결책이 아니다.

**수정안 — 기본 처방(무조건)과 구조 선택지(택1)를 분리한다**
```
[기본 처방 — 어느 구조를 택하든 반드시]
1. 재설정 URL에서 로그를 스크러빙하거나(bbox·token·id 파라미터 제거),
   URL 쿼리를 기록하지 않도록 로깅 파이프라인을 조정한다.
   ※ 위치(SEC-04)와 순서가 얽힌다: 먼저 URL에서 비밀을 빼고 그 다음 샘플링을 유지.
2. Referrer-Policy: no-referrer 를 재설정·인증 페이지에 적용(외부 Referer 유출 차단).
3. 토큰/식별자를 단일 사용 + 짧은 TTL(현재 30분 → 15분 권장)로 좁힌다.
4. 전 구간 HTTPS 강제(HSTS는 SEC-09/PR-13).

[구조 선택지 — 하나를 택한다]
A. URL에서 비밀을 완전히 제거(권장):
   - 메일 링크 랜딩이 토큰을 URL이 아닌 방식으로 확보한다.
     예: 랜딩 즉시 토큰을 서버측 일회성 HttpOnly/SameSite=Strict 세션에
     바인딩하고 URL의 토큰을 제거하는 리다이렉트(302 to 클린 URL)를 수행,
     이후 POST 폼은 그 세션으로 재설정을 완료한다.
   - 이렇게 하면 로그·히스토리에 남는 URL에 재설정 권한이 없다.
B. 교환(exchange) 구조를 택하면:
   - 랜딩이 URL 토큰을 즉시 소비해 서버측 일회성 세션으로 교환하고
     곧바로 클린 URL로 리다이렉트(URL에서 원 토큰 제거).
   - 이때 URL에 남는 어떤 식별자도 "조회 전용·재설정 불가"여야 하며,
     실제 재설정 권한은 HttpOnly 세션에만 존재한다.
5. 토큰 소비는 loader가 아닌 action에서만(verify-email·verify-correction의
   GET 소비도 함께 제거 — ARC-11).
```

**수용 기준**
- [ ] 재설정 완료까지의 어떤 요청 URL에도 재설정을 완료시킬 수 있는 값(원 토큰 또는 제출만으로 재설정되는 opaque-id)이 남지 않는다.
- [ ] 재설정 페이지 응답에 `Referrer-Policy: no-referrer`가 있다.
- [ ] 링크를 프리페치해도 토큰이 소비되지 않는다(GET 부작용 없음).
- [ ] 재설정 권한은 HttpOnly·SameSite 세션에만 존재하고, 단일 사용·짧은 TTL이 적용된다.
- [ ] `verify-email`·`verify-correction`이 POST로만 상태를 바꾼다.
- [ ] 로그에 URL 쿼리가 남는 경우, 재설정·위치 파라미터가 스크러빙된다(실 배포 로그 1건으로 확인 — §14.4).

### SEC-04 — 위치 고지 불일치

**재현**
1. `/`에서 "내 주변"을 클릭하고 위치 권한을 허용.
2. 주소창이 `?bbox=126.86270,35.13510,126.91270,35.17110`로 바뀌는 것을 확인(라이브에서 실측한 실제 값).
3. 이후 모든 loader 요청이 이 bbox를 서버로 보낸다.
4. `/privacy`를 열어 "Re:Taste 서버에 저장하지 않습니다" 문구를 확인 → 사실과 다름.

**위치** — `app/routes/home.tsx:47-56`(bbox 생성), `:26`(서버 파싱), `wrangler.jsonc:23`(로깅) vs `app/routes/privacy.tsx:12`, `docs/legal/privacy-data-inventory.md:12`.

**영향** — 법적: 고지 내용과 실제 처리가 다르다. 위치정보 관련 규제 노출 [추론 — 법률 검토 필요]. 신뢰: 이 제품의 핵심 가치가 신뢰인데 방침이 사실과 다르다.

**수정안 — 둘 중 하나를 선택**
```
A. 동작을 문구에 맞춘다 (권장)
   - bbox를 URL이 아닌 클라이언트 상태로만 유지하고, 서버에는
     좌표 정밀도를 낮춘 값(소수 2자리 ≈ 1km)만 전달.
   - 또는 로깅 파이프라인에서 bbox 파라미터를 스크러빙.
B. 문구를 동작에 맞춘다
   - "현재 위치 기반 검색 범위가 서버 요청에 포함되며 운영 로그에
     기록됩니다"를 방침에 명시하고 동의 절차를 검토.
```
A를 권장한다. URL 공유 기능(§6.2의 강점)은 유지하면서 정밀도만 낮추면 제품 가치를 잃지 않는다.

**수용 기준**
- [ ] 처리방침 문구와 실제 데이터 흐름이 일치한다.
- [ ] 운영 로그에 좌표가 남는다면 그 사실이 인벤토리에 등재돼 있다.
- [ ] 법무 검토 기록이 문서에 남는다.

### SEC-05 — 회원 탈퇴 구현 불가

**재현**
1. `routes.ts` 29개 경로에서 탈퇴 관련 라우트를 찾는다 → 없음.
2. `schema.ts:125-127`에서 `voteEvents.userId`가 `onDelete: "restrict"`임을 확인.
3. 투표 이력이 있는 사용자에 `DELETE FROM users` 시도 → FK 제약 위반.
4. `/privacy`(`:14`)와 `/terms`(`:14`)는 탈퇴권을 명시.

**위치** — `app/db/schema.ts:125-127`(voteEvents), `:393`(goldenPickEvents), `:475`(placeSuggestions).

**영향** — 법적: 방침이 약속한 삭제권을 이행할 수 없다. 기술: 스키마 변경 없이는 기능 착수 자체가 불가능하다.

**수정안 (익명화 권장)**
```
1. 결정: 익명화. 이유 — 투표 이력이 rating 계산 입력이라
   하드 삭제는 과거 스냅샷의 재현성을 깨뜨린다.
2. users에 status('ACTIVE'|'WITHDRAWN')와 withdrawnAt 추가.
3. 탈퇴 시: email → 해시된 placeholder, displayName → "탈퇴한 회원",
   passwordHash/Salt → null, 세션 전량 삭제, 리뷰어 프로필 SUSPENDED.
4. 투표·제안 행은 유지하되 공개 표면에서 작성자 식별 정보를 노출하지 않는다.
5. 방침에 "투표 이력은 통계 목적으로 익명화 후 보관"을 명시.
```

**수용 기준**
- [ ] 투표 이력이 있는 계정을 탈퇴시킬 수 있다.
- [ ] 탈퇴 후 해당 이메일로 재가입이 가능하다.
- [ ] 탈퇴 후 그 사용자의 세션이 즉시 무효화된다.
- [ ] 탈퇴 후에도 장소 평가 점수가 변하지 않는다(익명화이므로).
- [ ] 방침의 삭제·보관 문구가 실제 동작과 일치한다.

### QLT-01 — E2E 격리 결함

**재현 (2026-08-07에 실제로 수행함)**
1. PR #41 워크트리의 dev 서버가 5173에서 실행 중인 상태에서
2. 다른 워크트리에서 `BASE_URL=http://localhost:5173 pnpm run test:e2e` 실행
3. 세션 fixture 부재 확인:
   ```
   GET /me  +  Cookie: retaste_session=qa-admin-session  →  302 → /login?returnTo=%2Fme
   GET /me  (익명)                                        →  302 → /login?returnTo=%2Fme
   ```
   두 응답이 동일 = 시드가 적용되지 않은 DB
4. 세션 의존 spec 7개가 로그인 리다이렉트로 실패

**위치** — `playwright.config.ts:19-24`(시드가 webServer command에만, `reuseExistingServer: true`, 고정 포트), `tests/e2e/admin-rating-operations.spec.ts:4`·`rating-foundation.spec.ts:12`·`reviewer-management.spec.ts:8,17`(시드 세션 의존), `tests/e2e/login.spec.ts:21` + `session.server.ts:109`(자가 오염).

**영향** — 프로젝트 자신의 배포 게이트("E2E 통과", `cloudflare-deploy.md:5`)가 통과 불가능하다. **더 중요한 건 신호 상실이다** — 26 FAIL이 상시화되면 진짜 회귀가 묻힌다.

**수정안**
```
1. playwright.config.ts:
   - reuseExistingServer: !process.env.CI
   - port를 환경변수로 파라미터화(기본 랜덤)
2. globalSetup 파일 신설:
   - migrate + seed-week1 + seed-admin-qa + seed-discovery-ratings를
     서버 기동 여부와 무관하게 항상 실행
3. login.spec의 로그아웃 테스트는 전용 세션을 자체 생성 후 사용
   (공용 시드 세션을 소비하지 않는다)
4. 맵 spec의 clientId 가정을 명시화 — 테스트 전용 env로 빈 값을 강제
```

**수용 기준**
- [ ] 다른 dev 서버가 떠 있어도 e2e가 자기 서버·자기 DB로 실행된다.
- [ ] 같은 명령을 연속 2회 실행해도 결과가 동일하다(자가 오염 없음).
- [ ] 68개 중 SKIP 2를 제외한 66개가 통과한다.
- [ ] CI에서 재현 가능하다(PR-2 이후).

### ARC-01 — 화면마다 다른 점수

**재현**
1. 투표가 8표 이상인 장소를 목록(`/places`)과 상세(`/places/:slug`)에서 각각 연다.
2. 리뷰어 투표가 섞여 있으면 두 숫자가 다르다(목록은 원시 비율, 상세는 신뢰도 가중).
3. 관리자가 `/admin/ratings`에서 해당 장소의 투표를 무효화한다.
4. 상세는 재계산 후 변하지만 **목록·지도 마커는 변하지 않는다**.

**위치** — `app/features/places/place.server.ts:166-167`(원시 `sum`, `invalidatedVoteEvents` 조인 없음) vs `app/routes/place-detail.tsx:40-48` + `app/features/ratings/recompute.server.ts:70`(무효표 제외). 마커는 `place-marker-policy.ts:3-8`이 같은 원시 카운트를 쓴다.

**영향** — 사용자: 같은 장소의 점수가 화면마다 달라 신뢰가 깨진다. 사업: **조작 대응 기능이 공개 표면에서 절반만 동작한다** — 무효화된 조작 투표가 목록 순위와 마커 크기에 계속 반영된다. 이 제품의 차별점이 평가 신뢰성인데 그 신뢰성이 목록에서 보장되지 않는다.

**수정안**
```
1. listPlaces가 ratingSnapshots를 leftJoin해
   overallScore·overallSampleCount·isStale·algorithmVersion을 반환.
2. 스냅샷이 없는 장소는 v1 폴백을 쓰되 algorithmVersion으로 구분해
   UI가 "표본 수집 중"을 정확히 표시하게 한다.
3. getMarkerInfluence의 입력을 원시 positive/negative에서
   유효 표본 수로 교체.
4. PlaceDiscoveryRail, MapPlaceDetail, PlaceDetailSheet도 같은 필드를 소비.
```

**수용 기준**
- [ ] 동일 장소의 추천률이 목록·지도 시트·상세에서 같다.
- [ ] 투표 무효화 후 재계산이 끝나면 목록 숫자도 변한다.
- [ ] 스냅샷 없는 장소가 "표본 수집 중 · n/8"로 일관되게 표시된다.
- [ ] 통합 테스트로 무효화 → 목록 반영 경로가 커버된다.

### ARC-02 — 모바일 시트 저장 시 렌더 크래시

**재현**
1. 모바일 폭(≤760px)에서 `/`를 연다.
2. 지도 마커를 눌러 장소를 선택하고 시트를 연다(`?place=<slug>`).
3. 로그인 상태에서 "맛집지도에 추가"를 누른다.
4. `detail.data`가 `{ok:true}`로 교체되어 `data.place.name` 접근이 TypeError → 전역 오류 화면.

**위치** — `app/components/places/PlaceDetailSheet.tsx:8`(`useFetcher` 하나), `:9`(`detail.load`), `:34`(`detail.Form`), `:20`·`:24`(`data.place.*` 접근) + `app/routes/place-detail.tsx:76`(`return { ok: true }`).

**주의** — 이 항목은 **[추론]이다.** React Router의 문서화된 fetcher 동작(submit 결과가 `fetcher.data`를 교체)에 근거하며, 실행 재현은 하지 않았다. 라이브 서버에 QA 세션이 없어 로그인 시나리오를 만들 수 없었기 때문이다(§14). **수정 전에 재현부터 하라.**

**영향** — 모바일 저장이라는 핵심 과업에서 페이지 전체가 오류 화면으로 대체된다. 모바일이 1차 타깃인 제품에서 치명적이다.

**수정안**
```
1. fetcher를 둘로 분리: const detail = useFetcher(); const save = useFetcher();
2. save.Form으로 제출하고, save.state === "idle" && save.data?.ok일 때
   detail.load()로 재조회.
3. 렌더는 detail.data만 참조.
4. 로드 실패 상태를 추가: detail.state === "idle" && !detail.data이면
   "정보를 불러오지 못했어요 · 다시 시도" (현재는 무한 로딩 문구).
```

**수용 기준**
- [ ] 모바일 시트에서 저장/해제를 5회 반복해도 오류 화면이 뜨지 않는다.
- [ ] 저장 후 버튼 문구가 즉시 반영된다.
- [ ] 로드 실패 시 재시도 UI가 나온다.
- [ ] E2E에 이 시나리오가 추가된다.

### UX-01 — 로그인 후 맥락 상실

**재현**
1. 로그아웃 상태로 `/places/sample-yangnim-gukbap`을 연다.
2. "추천" 버튼 영역의 로그인 링크를 누른다 → `/login?returnTo=%2Fplaces%2Fsample-yangnim-gukbap`
3. 로그인 성공 → **`/`로 이동**한다. 원래 장소로 돌아가지 않는다.

**위치** — `app/features/auth/login.ts` (파일 전문 3줄):
```ts
export function safeReturnTo(_value: string | null | undefined): string {
  return "/";
}
```
`session.server.ts:74-76`과 `VoteControl.tsx:12`는 여전히 `returnTo`를 만들어 보낸다. `tests/unit/login-return-to.test.ts:5-9`가 현재 동작을 "always returns to the member map"으로 의도화하고 있다.

**영향** — 투표하려고 로그인한 사용자가 홈으로 떨어져 다시 그 장소를 찾아야 한다. 전환율에 직접 영향을 준다. 배선(returnTo 생성)과 정책(무시)이 불일치해 코드 의도가 불명확하다.

**수정안**
```ts
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return "/";
  if (!SAFE_PATH.test(value)) return "/";     // //evil.com, https://…, \evil 차단
  if (value.startsWith("/logout")) return "/"; // 즉시 로그아웃 루프 방지
  return value;
}
```
그리고 `login.tsx`의 폼에 `<input type="hidden" name="returnTo" value={returnTo}>`를 추가하고, `PlaceDetailSheet.tsx:34`의 `<a href="/login">`을 `returnTo`를 실은 `<Link>`로 바꾼다. 기존 단위 테스트는 새 정책에 맞게 갱신한다.

**수용 기준**
- [ ] `/places/x` → 로그인 → `/places/x` 복귀.
- [ ] `//evil.com`, `https://evil.com`, `\\evil.com`, `javascript:` 전부 `/`로 폴백(단위 테스트).
- [ ] 시트의 로그인 링크가 풀 리로드를 일으키지 않는다.
- [ ] E2E에 복귀 시나리오가 추가된다.

### UX-03 — 탐색성·공유 기반 부재

**재현 (2026-08-07 라이브 실측)**
1. `curl -I http://localhost:5173/robots.txt` → **404**
2. `sitemap.xml` → **404**
3. `/places`, `/signup`, `/maps/korean`의 `document.title` → **빈 문자열**
4. 어떤 페이지에도 `og:*`, `canonical`, `application/ld+json` 없음(27/27 조합 확인)
5. 서로 다른 장소 두 개의 `<title>`이 모두 "장소 상세 — Re:Taste"

**위치** — `app/routes/place-detail.tsx:79`(정적 meta), `place-list.tsx`·`map-category.tsx`·`signup.tsx` 등 17개 라우트에 `meta` export 없음, `public/`에 `favicon.ico`만 존재.

**영향** — 사업: 메신저로 장소 링크를 보내면 상호명이 뜨지 않는다. 지역 검색·AI 검색 유입 경로가 없다. 이건 SEO 최적화 이전에 **공유 가능성**의 문제다.

**수정안** — §9.7의 최소 집합(meta 4종 + OG + robots + sitemap + Restaurant JSON-LD, `aggregateRating` 제외).

**수용 기준**
- [ ] 모든 공개 라우트의 `<title>`이 고유하고 비어 있지 않다(라이브 자동 검사).
- [ ] `robots.txt`·`sitemap.xml`이 200이며 `/admin/*`이 disallow된다.
- [ ] 장소 링크의 OG 미리보기에 상호명과 동네가 나온다.
- [ ] JSON-LD가 스키마 검증을 통과하고 `aggregateRating`을 포함하지 않는다.

### 13.2 나머지 45건 상세 (동일 5필드 계약)

각 항목: **재현/확인** · **위치** · **영향** · **수정안** · **수용 기준**. 라인은 스냅샷(`.audit-source.cxo3js`)을 직접 열어 확인했고, 이번 보완 실행에서 표본 재검증한 항목은 §Handoff에 기록했다.

#### SEC-06 — 개인정보 인벤토리·처리방침 누락 다수 (P0)
- **재현/확인**: `privacy.tsx:9,11`은 처리 항목으로 "이메일, 표시 이름, 역할, 세션·투표·저장"만 열거한다. 그러나 `email.server.ts:10`이 Resend(`https://api.resend.com/emails`)로 국외 전송, `schema.ts:495-507` `requesterEmail`(비회원 이메일 영구 저장), `schema.ts:251-268` 리뷰어 `occupation`, `schema.ts:23-24` `password_hash/salt`가 실제로 저장된다. 인벤토리(`privacy-data-inventory.md`) 6행 표에도 이 항목들이 없다. 인벤토리 :15는 "이메일 도구 도입 시 같은 릴리스에서 갱신"을 자기 규칙으로 두는데 Resend가 이미 도입돼 규칙을 스스로 어겼다.
- **위치**: `docs/legal/privacy-data-inventory.md`(6행 표), `app/routes/privacy.tsx:9,11`, `app/features/auth/email.server.ts:10`, `app/db/schema.ts:23-24,251-268,495-507`.
- **영향**: 법적 — 처리방침·인벤토리가 실제 처리 항목을 누락. 문서 스스로 정한 출시 차단 규칙(인벤토리 :22) 위반.
- **수정안**: 인벤토리·처리방침에 (1) Resend 위탁·국외 이전(계약 주체·국가·시점), (2) 비회원 정정 이메일과 보존·파기 기준, (3) 리뷰어 직업, (4) 비밀번호 해시·인증 토큰, (5) 제안·감사·AI 실행 로그를 등재. `privacy.tsx:11,16`의 미확정 항목(계약 주체·보호책임자)을 운영 결정으로 확정.
- **수용 기준**: [ ] 코드가 저장하는 모든 개인정보 항목이 인벤토리 표에 있다. [ ] 처리방침 §1·§3이 Resend 위탁과 국외 이전을 명시한다. [ ] 법무 검토 기록이 문서에 남는다.

#### QLT-02 — CI 설정 전면 부재 (P0)
- **재현/확인**: 스냅샷 전체에 `.github`가 없다([확인] 이번 실행에서 `.github ABSENT` 재확인). yml은 `pnpm-lock.yaml`·`pnpm-workspace.yaml`뿐. `AGENTS.md:10-11`은 "required checks 통과 후 머지"를 규약으로 두나 강제 수단이 없다.
- **위치**: 저장소 루트(`.github/` 부재), `AGENTS.md:10-11`.
- **영향**: 운영 — 워크플로 규약을 강제할 수단이 없다. E2E 붕괴가 로컬에서만 발견된 것이 이 공백의 증상.
- **수정안**: GitHub Actions(또는 동등 CI)에 typecheck·build·unit·integration·e2e를 PR 필수 체크로. **QLT-01(PR-1) 선행** — 프로비저닝을 먼저 고치지 않으면 CI가 상시 빨강.
- **수용 기준**: [ ] PR마다 5개 체크가 실행된다. [ ] 체크 실패 시 머지가 차단된다. [ ] `packageManager` 고정으로 CI/로컬 pnpm 버전이 일치한다.

#### ARC-03 — 재-import 시 이전 primary 카테고리 미해제 (P1)
- **재현/확인**: `place.server.ts:104-110`(import)과 `:300-306`(upsert)이 새 카테고리에 `isPrimary: true`를 넣으며 `onConflictDoUpdate set: { isPrimary: true }`만 한다 — 기존 primary를 false로 내리지 않는다. `0000_week1.sql:50-55` `place_categories`는 PK(place_id, category_id)만 있고 "장소당 primary 1개" 제약이 없다. `publicConditions`(`:118-121`)가 `isPrimary=true`로 필터 + groupBy하므로 primary 2개면 같은 장소가 2행 반환. CSV 카테고리 변경 재-import로 즉시 도달.
- **위치**: `app/features/places/place.server.ts:104-110,118-121,300-306`, `drizzle/0000_week1.sql:50-55`.
- **영향**: 사용자 — 같은 장소가 목록·지도에 2행/중복 마커. 데이터 정합성.
- **수정안**: import·upsert가 새 primary 지정 전에 해당 place의 기존 primary를 false로 내리는 문을 batch에 추가. 부분 유니크 인덱스(`WHERE is_primary=1`) 마이그레이션으로 DB 레벨 강제.
- **수용 기준**: [ ] 카테고리 변경 재-import 후 장소가 1행으로 조회된다. [ ] 장소당 primary가 최대 1개임을 DB 제약이 보장한다.

#### SEC-07 — 비밀번호 재설정이 기존 세션을 무효화하지 않음 (P1)
- **재현/확인**: `account.server.ts:74-80` `resetPassword`가 `users.passwordHash/Salt`만 UPDATE하고 `sessions` 삭제가 없다([확인]). `session.server.ts:10` TTL 7일이므로 탈취자 세션이 재설정 후에도 최대 7일 유지.
- **위치**: `app/features/auth/account.server.ts:74-80`, `app/features/auth/session.server.ts:10`.
- **영향**: 보안 — 계정 탈취 후 피해자가 비밀번호를 바꿔도 공격자 세션이 살아 있다.
- **수정안**: `resetPassword` batch에 `db.delete(sessions).where(eq(sessions.userId, userId))` 추가.
- **수용 기준**: [ ] 재설정 직후 기존 세션 전부가 무효화된다. [ ] 재설정한 사용자만 재로그인으로 새 세션을 얻는다.

#### SEC-08 — 토큰 일회성이 비원자적(TOCTOU) (P1)
- **재현/확인**: `account.server.ts:46-53` `consumeToken`이 `findFirst`로 조회(:47-49) 후 별도 `update`(:51)로 소비한다. update의 affected rows를 확인하지 않으므로, 동시 요청 2건이 같은 토큰으로 둘 다 findFirst를 통과하면 둘 다 성공할 수 있다.
- **위치**: `app/features/auth/account.server.ts:46-53`.
- **영향**: 보안 — 동시 요청으로 단일 사용 토큰이 2회 소비될 여지.
- **수정안**: `update ... where(id, isNull(consumedAt))`의 **affected rows == 1**을 확인하고 0이면 `TOKEN_INVALID` throw. 또는 조건부 UPDATE 후 반환값으로 판정(조회-후-갱신을 단일 원자 연산으로).
- **수용 기준**: [ ] 동일 토큰 동시 2요청 중 하나만 성공한다. [ ] 소비 실패가 명확한 오류를 반환한다.

#### SEC-09 — 보안 헤더·CSP 전무 (P1)
- **재현/확인**: `workers/app.ts:12-15`가 `requestHandler(request)` 결과를 그대로 반환하며 헤더 주입이 없다. `public/_headers` 부재([확인] 이번 실행). 라이브 응답 헤더 실측에서 보안 헤더 0개(§1.2).
- **위치**: `workers/app.ts:12-15`, `public/_headers`(부재).
- **영향**: 보안 — 외부 스크립트(Naver SDK)·폰트를 쓰는 구조에서 CSP·HSTS·nosniff·frame-deny가 전부 없다.
- **수정안**: `workers/app.ts` 응답에 CSP(script-src에 Naver·Google Fonts 허용, object-src none), HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy: geolocation=(self)` 주입. 정적 자산은 `_headers`로 보완.
- **수용 기준**: [ ] 라이브 응답에 위 헤더가 존재한다. [ ] Naver 지도·폰트가 CSP 위반 없이 로드된다.

#### SEC-10 — 로그인 계정 열거(문구 + 타이밍) (P1)
- **재현/확인**: `login.tsx:25`가 미인증 계정에 `EMAIL_NOT_VERIFIED`용 별도 문구("이메일 인증을 먼저 완료해 주세요.")를 노출해 가입 여부를 유출한다. `account.server.ts:63`은 미존재 이메일이면 `verifyPassword`를 돌리지 않아(단락 평가) 타이밍 차이가 생긴다. `forgot-password`는 generic 응답이라 대비된다.
- **위치**: `app/routes/login.tsx:25`, `app/features/auth/account.server.ts:63`.
- **영향**: 보안 — 이메일의 가입·인증 여부를 확정할 수 있다(SEC-01 크리덴셜 스터핑의 표적 선별에 악용).
- **수정안**: 로그인 실패 문구를 단일화("이메일 또는 비밀번호가 올바르지 않습니다."). 미인증 안내는 별도 채널(재발송 유도)로. 미존재 이메일에도 더미 KDF를 돌려 타이밍 평탄화.
- **수용 기준**: [ ] 미존재·오답·미인증 응답 문구가 동일하다. [ ] 응답 시간이 계정 존재 여부로 구분되지 않는다.

#### SEC-11 — GET loader에서 지표 쓰기 → 배지 조작 (P1)
- **재현/확인**: `place-detail.tsx:32`가 loader에서 `recordPlaceDetailView`를 호출해 `placeDailyMetrics.detailViews`를 +1(`rating-badges.server.ts:18-26`, `onConflictDoUpdate ... detailViews + 1`). 이 값이 Hidden Gem 판정 입력이다. 봇·프리페치·제3자 `<img src="/places/x">`마다 증가.
- **위치**: `app/routes/place-detail.tsx:32`, `app/features/ratings/rating-badges.server.ts:18-26`.
- **영향**: 보안·정합 — GET 부작용으로 지표가 부풀고 Hidden Gem 배지가 크로스사이트로 조작 가능.
- **수정안**: 지표 증가를 GET loader에서 분리 — POST 기반 조회 이벤트 또는 서버측 비파생 집계(로그 기반 배치)로 이전. 최소한 프리페치·봇 UA를 배제.
- **수용 기준**: [ ] 장소 상세 GET이 지표를 변경하지 않는다. [ ] 배지 입력이 크로스사이트 요청으로 오염되지 않는다.

#### UX-02 — 회원가입 오류 시 폼 자체가 사라짐 (P1)
- **재현/확인**: `signup.tsx:28`가 `actionData?.message ? <메시지> : <Form>`의 삼항이라, 오류 메시지가 오면 폼 전체가 사라진다. 검증 실패 사용자는 새로고침 없이 재입력할 수 없다.
- **위치**: `app/routes/signup.tsx:28`.
- **영향**: UX(High) — 가입 전환율 직접 저하. 검증 실패 = 입력값 소실.
- **수정안**: 오류와 폼을 함께 렌더. 입력값을 `defaultValue`로 복원. 성공(ok)일 때만 폼을 안내로 교체.
- **수용 기준**: [ ] 검증 실패 시 폼과 입력값이 유지된다. [ ] 성공 시에만 안내로 전환된다.

#### QLT-03 — 이메일 발송 실패가 고아 레코드 + 내부 에러코드 노출 (P1)
- **재현/확인**: `place-correction.tsx:4`가 `createPlaceCorrectionRequest`(DB insert)를 먼저 실행하고 그 뒤 `if (!env.RESEND_API_KEY...) throw "EMAIL_NOT_CONFIGURED"`. 메일 미설정 시 검증 불가 PENDING 행이 남고, catch가 `error.message`를 그대로 반환해 `EMAIL_NOT_CONFIGURED`가 화면에 노출된다.
- **위치**: `app/routes/place-correction.tsx:4`.
- **영향**: 운영·UX — 고아 행 누적 + 내부 코드 유출.
- **수정안**: env 검사를 insert **이전**으로 이동(순서 교체). 에러코드를 사용자 문구로 매핑하고 미매핑은 generic 문구로 통일, 원문은 서버 로그에만.
- **수용 기준**: [ ] `RESEND_API_KEY` 부재 시 DB 행이 생성되지 않는다. [ ] 화면에 내부 코드가 노출되지 않는다.

#### QLT-04 — 운영 알림 외부 통지 채널 없음 (P1)
- **재현/확인**: `workers/app.ts:17`이 4개 scheduled 작업을 `Promise.all`로 실행하며 작업별 try/catch가 없다 — 자체 알림 기록 전에 던진 예외는 `operational_alerts`를 우회하고 Workers 로그에만 남는다. `admin-operations.tsx:12`가 "외부 이메일 알림은 운영 문의 주소 확정 후 연결합니다"라고 자인. 03:17 KST cron 실패를 능동 감지할 채널이 없다.
- **위치**: `workers/app.ts:17`, `app/features/operations/alerts.server.ts`, `app/routes/admin-operations.tsx:12`.
- **영향**: 운영 — 야간 배치 실패를 관리자가 대시보드를 열 때까지 아무도 모른다.
- **수정안**: `Promise.all`을 작업별 try/catch로 감싸 실패를 반드시 `operational_alerts`에 기록 + 외부 통지 훅(Sentry PILOT 또는 임시 웹훅). §11.5의 "먼저 try/catch 5줄"이 최소 조치.
- **수용 기준**: [ ] 한 작업 실패가 다른 작업을 막지 않고 alert로 기록된다. [ ] cron 실패가 외부 채널로 통지된다.

#### DOC-01 — 서비스명 모순 (`Re:Taste` vs `Tasted : IT`) (P1)
- **재현/확인**: `2026-08-05-tastedit-product-direction-v2-design.md:1`(제목 "# Tasted : IT …"), `:19`("서비스명: `Tasted : IT`")가 코드·전 UI·법무 문서의 `Re:Taste`와 모순. (이전 판은 `:20`으로 인용 — 이번 보완에서 `:1·:19`로 정정.)
- **위치**: `docs/superpowers/specs/2026-08-05-tastedit-product-direction-v2-design.md:1,19` vs README·`app/root.tsx:18`·`privacy.tsx`.
- **영향**: 사업 — 브랜드 미결정 상태로 공개 진입.
- **수정안**: 운영 결정으로 서비스명 확정(결정 D-2) 후 v2 스펙과 잔여 표기를 정합화.
- **수용 기준**: [ ] 확정 서비스명이 코드·문서·법무에서 단일하다.

#### ARC-04 — 투표 되돌리기 시 stale 스냅샷 고착 (P2)
- **재현/확인**: `recompute.server.ts:103-108`은 입력 해시가 같은 기존 스냅샷을 찾으면 `isStale`만 해제하고 `computedAt`을 갱신하지 않는다. `getLatestRatingSnapshot`(`:148-153`)은 `isStale` 필터 없이 `computedAt desc`만 본다. A→B→A 되돌리기 시 최신 계산 결과(스냅샷1, 오래된 timestamp) 대신 스냅샷2(B 기준, 더 최신 timestamp)가 계속 표시된다.
- **위치**: `app/features/ratings/recompute.server.ts:103-108,148-153`.
- **영향**: 정합 — "새 평가 반영 중" 라벨을 단 채 잘못된 점수가 무기한 고정.
- **수정안**: 재사용 스냅샷의 `computedAt`도 현재 시각으로 갱신하거나, `getLatestRatingSnapshot`이 `isStale=false` 중 최신을 고르도록 조건 추가.
- **수용 기준**: [ ] 되돌리기 후 표시 점수가 최신 계산과 일치한다.

#### ARC-05 — 일괄 승인이 필터 없는 300건 윈도우로 재검증 (P2)
- **재현/확인**: 로더는 필터를 쓰지만 승인 경로는 `candidate.server.ts:46`의 `.limit(300)` 윈도우로 후보를 재조회(`bulk-review.server.ts:136-149`)해 화면에 보인 후보가 "검수 대기 후보가 아닙니다"로 스킵될 수 있다(:149). 요약 카운트도 300 캡에 걸린다.
- **위치**: `app/features/candidates/candidate.server.ts:46`, `app/features/candidates/bulk-review.server.ts:136-149`.
- **영향**: 운영 — 필터 상태에서 화면 후보를 승인 못 할 수 있고, 실제 대기량이 숨겨진다.
- **수정안**: 승인 action이 선택된 후보 ID로 직접 조회. 요약 카운트를 `count(*)`로 분리. 상한 잔존 화면에 "상위 N건만 표시" 명시.
- **수용 기준**: [ ] 필터 상태의 모든 화면 후보를 승인할 수 있다. [ ] 대기 건수가 300 초과 시 실제 수치가 표시된다.

#### ARC-06 — 병합 후 재계산 미트리거 + 부수 데이터 소실 (P2)
- **재현/확인**: `place-merge.server.ts:21-43`의 batch가 votes·saves·categories·links·suggestions·corrections·redirect를 옮기지만 `markRatingStale`/`enqueueRatingRecompute` 호출이 없다([확인] :21-43 전체에 부재). target의 기존 스냅샷은 `isStale=false`인 채 유지되고, source의 `flavorRatings`·`goldenPickEvents`·`placeDailyMetrics`·`ratingSnapshots`는 이관되지 않아 HIDDEN 장소에 남아 소실.
- **위치**: `app/features/places/place-merge.server.ts:21-43`.
- **영향**: 정합 — 병합 후 투표가 이동했는데 점수가 "검증된 최신"으로 오표시. 리뷰어 데이터·메트릭 소실.
- **수정안**: 병합 batch 후 target에 대해 rating stale 표시 + 재계산 큐. flavor/golden/metrics 이관 문 추가.
- **수용 기준**: [ ] 병합 후 target 점수가 재계산된다. [ ] source의 리뷰어 데이터·메트릭이 target으로 이관된다.

#### ARC-07 — 관리자·리뷰어 도메인 에러가 전부 500 화면 (P2)
- **재현/확인**: `admin-place-operations.tsx:31-63`의 action은 도메인 함수가 throw하면 라우트 ErrorBoundary가 없어 `root.tsx:45` 전역 500 화면으로 떨어진다. `:60`은 잘못된 intent에 `throw new Response(400)`. `reviewer-ratings.tsx:44-45`도 유사(`:48,:52` throw Response).
- **위치**: `app/routes/admin-place-operations.tsx:31-63`, `app/routes/reviewer-ratings.tsx:44-52`.
- **영향**: UX — 운영자가 작업 실패 시 맥락 없는 500을 만나 무엇이 잘못됐는지 알 수 없다.
- **수정안**: action을 try/catch로 감싸 도메인 오류를 인라인 메시지(actionData.error)로 반환. 검증 실패는 400 대신 필드 오류 맵으로.
- **수용 기준**: [ ] 도메인 오류가 화면 내 인라인으로 표시된다. [ ] 500 전역 화면으로 떨어지지 않는다.

#### ARC-08 — 같은 값 재투표가 조작 신호를 만든다 (P2)
- **재현/확인**: `vote.server.ts:43-52`가 이전 값과 동일해도 무조건 `eventType: previous ? "CHANGE" : "CREATE"`로 CHANGE 이벤트를 기록(값 비교 없음, :36-41에서 previous를 조회하나 value 비교 안 함). `integrity.server.ts:44-46`이 24시간 CHANGE 5회면 `REPEATED_VOTE_CHANGE` 케이스 생성. 같은 버튼 5번 누른 정상 사용자가 조작 검토 대상.
- **위치**: `app/features/ratings/vote.server.ts:43-52`, `app/features/ratings/integrity.server.ts:44-46`.
- **영향**: 정합 — 무고한 사용자가 조작 신호를 만든다. 무결성 시스템 오탐.
- **수정안**: `previous.value === input.value`면 이벤트 미기록(무연산 반환). 버튼도 이미 누른 값이면 비활성.
- **수용 기준**: [ ] 같은 값 재투표가 CHANGE 이벤트를 만들지 않는다. [ ] 정상 반복 클릭이 조작 신호로 잡히지 않는다.

#### ARC-09 — 카테고리 카운트 전역인데 결과는 bbox 필터 (P2)
- **재현/확인**: `place.server.ts:207-218` `listPublicCategoryGroups`가 bbox 무관 전역 `count(distinct places.id)`를 낸다. `home.tsx:81` 카테고리 선택 후 결과는 bbox 필터를 거친다. "치킨 25"를 눌러도 현재 화면에 없으면 0곳, `fitBounds`가 없어 빈 지도.
- **위치**: `app/features/places/place.server.ts:207-218`, `app/routes/home.tsx:81`.
- **영향**: UX — "눌렀는데 아무것도 없다"만 보인다.
- **수정안**: 카테고리 카운트를 bbox 기준으로, 전역 개수는 괄호 보조. 0곳이면 자동 이동 대신 명시 배너(§9.1).
- **수용 기준**: [ ] 칩 개수와 선택 후 결과 개수가 일치한다. [ ] 0곳일 때 배너가 뜨고 지도는 사용자 동의 전 이동하지 않는다.

#### QLT-05 — 통합 테스트가 프로덕션 wrangler 재사용 (P2)
- **재현/확인**: `vitest.workers.config.ts:13` `wrangler: { configPath: "./wrangler.jsonc" }`가 프로덕션 설정을 주입 — `wrangler.jsonc:12` `"ai": { "binding": "AI" }`(원격 프록시)와 `:17` 운영 `database_id`. 관찰된 "Cloudflare 계정 조회·AI binding 원격 과금 경고"의 출처로 추정.
- **위치**: `vitest.workers.config.ts:13`, `wrangler.jsonc:12,17`.
- **영향**: 운영·비용 — 미래 테스트가 `env.AI`를 실수로 호출하면 실 과금(COWORK §6 위반).
- **수정안**: 테스트 전용 wrangler 설정(AI binding 제거, 로컬 D1 id) 분리.
- **수용 기준**: [ ] 통합 테스트가 AI binding·운영 DB id를 참조하지 않는다.

#### QLT-06 — 운영 D1에 QA 시드 실행을 런북이 지시 (P2)
- **재현/확인**: `week1-data-runbook.md:55`가 `wrangler d1 execute DB --remote --file scripts/seed-discovery-ratings.sql`을 지시([확인] 이번 실행 원문 대조). `--remote`는 운영 D1이며 이 시드는 `qa-discovery-*` 가짜 사용자·투표·Golden Pick을 넣어 공개 추천률에 반영된다. 제거 절차가 없다.
- **위치**: `docs/operations/week1-data-runbook.md:55`, `scripts/seed-discovery-ratings.sql`.
- **영향**: 데이터 무결성 — 운영 추천률이 QA 가짜 데이터로 오염될 위험.
- **수정안**: 런북에서 `--remote` QA 시드 지시 제거. QA 시드는 `--local`로만. 이미 오염됐다면 제거 스크립트 제공.
- **수용 기준**: [ ] 런북이 운영 D1에 QA 시드를 지시하지 않는다.

#### QLT-07 — 런북–코드 드리프트(AI 수치) (P2)
- **재현/확인**: `ai-operations-runbook.md:7`이 프롬프트 `place-category-v1`이라 하나 코드는 `ai-classification.server.ts:12` `place-category-v3`. `:17-18` "한 번에 100곳·하루 500건" vs 코드 배치 10(`:13`) + 뉴런 쿼터(`ai-usage-policy.ts:1-2`).
- **위치**: `docs/operations/ai-operations-runbook.md:7,17-18` vs `app/features/candidates/ai-classification.server.ts:12-13`, `ai-usage-policy.ts:1-2`.
- **영향**: 운영 — 장애 대응 시 런북을 믿으면 오판.
- **수정안**: 런북 수치를 코드 상수와 동기화(프롬프트 버전·배치·쿼터). 상수를 단일 출처로 참조하는 문서 생성 검토.
- **수용 기준**: [ ] 런북의 프롬프트·배치·한도가 코드와 일치한다.

#### QLT-08 — 배포 런북 secret 목록이 낡음 (P2)
- **재현/확인**: `cloudflare-deploy.md:7,26-27`이 `SESSION_SECRET`(코드 미사용 — 불투명 세션)과 `ADMIN_EMAIL`만 지시. 실제 필요한 `NAVER_MAPS_CLIENT_ID`·`DATA_GO_KR_SERVICE_KEY`·`RESEND_API_KEY`·`RESEND_FROM_EMAIL`·`APP_BASE_URL`(README:24-29)이 없다. 이 런북만 따르면 지도·동기화·메일이 죽은 배포.
- **위치**: `docs/operations/cloudflare-deploy.md:7,26-27` vs `README.md:22-29`.
- **영향**: 운영 — 런북대로 배포하면 핵심 기능이 죽는다.
- **수정안**: secret 목록을 실제 필요한 5종으로 교체. `SESSION_SECRET` 제거.
- **수용 기준**: [ ] 런북 secret 목록이 코드가 요구하는 env와 일치한다.

#### UX-04 — 다이얼로그 포커스 트랩·복원 없음 (P2)
- **재현/확인**: `PlaceDetailSheet.tsx:20` `role="dialog" aria-modal="true"`, `MapPlaceDetail.tsx:21` `role="dialog"`인데 포커스 트랩·복원·배경 inert가 없다([확인] 코드에 트랩 로직 부재). `aria-modal` 선언과 실제 동작이 불일치.
- **위치**: `app/components/places/PlaceDetailSheet.tsx:20`, `app/components/map/MapPlaceDetail.tsx:21`.
- **영향**: 접근성 — 키보드·스크린리더 사용자가 시트 밖으로 포커스가 새고, 닫은 뒤 포커스가 복원되지 않는다.
- **수정안**: 공통 `Sheet` 컴포넌트(§9.8)에 포커스 트랩 + Esc 닫기 + 열기 트리거로 복원 + 배경 inert.
- **수용 기준**: [ ] 시트 열림 시 포커스가 시트 안에 갇힌다. [ ] Esc로 닫히고 포커스가 트리거로 복원된다.

#### UX-05 — 폼 오류에 `role=alert`/`aria-invalid`/`aria-describedby` 없음 (P2)
- **재현/확인**: `aria-invalid`/`aria-describedby`가 코드베이스 0건([확인] grep). 오류가 `login.tsx:33`·`reviewer-apply.tsx:49`·`place-suggest.tsx:23`·`reset-password.tsx:8`에서 시각 텍스트로만 표시. 예외는 `admin-import.tsx`의 `aria-live`뿐.
- **위치**: `app/routes/login.tsx:33`, `reviewer-apply.tsx:49`, `place-suggest.tsx:23`, `reset-password.tsx:8`.
- **영향**: 접근성 — 스크린리더 사용자가 폼 오류를 인지하지 못한다.
- **수정안**: 공통 `FormField`(§9.8)로 label+input+error+aria 배선. 오류에 `role="alert"`, 필드에 `aria-invalid`+`aria-describedby`.
- **수용 기준**: [ ] 폼 오류가 스크린리더로 즉시 읽힌다. [ ] 오류 필드가 프로그램적으로 식별된다.

#### UX-06 — 403 전용 화면 없음 (P2)
- **재현/확인**: `guards.server.ts:8-11`이 403 Response를 throw하면 `root.tsx:45` 전역 ErrorBoundary가 "잠시 길을 잃었습니다"(일반 오류 문구)로 표시. 일반 회원이 관리자 경로 진입 시 권한 부족을 알 수 없다.
- **위치**: `app/features/auth/guards.server.ts:8-11`, `app/root.tsx:45`.
- **영향**: UX — 권한 거부와 일반 오류가 구분되지 않는다.
- **수정안**: 403 전용 상태 화면("접근 권한이 없어요" + 로그인/홈 안내). ErrorBoundary가 status===403을 분기.
- **수용 기준**: [ ] 403이 전용 화면으로 표시된다. [ ] 일반 500과 문구가 다르다.

#### UX-07 — `/maps/:slug` "내 주변" 버튼이 좌표를 버림 + 탭이 URL 상태 파괴 (P2)
- **재현/확인**: `map-category.tsx:27`의 `<button onClick={() => navigator.geolocation.getCurrentPosition(() => undefined)}>내 주변</button>` — 좌표를 받아 아무것도 안 한다. 같은 줄 `<Link to="?view=map">`은 쿼리 전체를 치환해 `q`·`bbox`·`selected`를 날린다.
- **위치**: `app/routes/map-category.tsx:27`.
- **영향**: UX(AI slop "Dead CTA") — 버튼이 죽어 있고 탭 전환이 상태를 파괴한다.
- **수정안**: "내 주변"이 좌표로 bbox를 갱신(홈과 동일 정책). 뷰 탭 링크를 현재 파라미터를 보존하는 상대 갱신으로.
- **수용 기준**: [ ] "내 주변"이 실제로 지도를 이동시킨다. [ ] 뷰 전환이 `q`·`bbox`·`selected`를 보존한다.

#### UX-08 — 대비 미달 2건 (P2)
- **재현/확인**: 직접 계산(§5.4). `.place-image{color:#777}` on `#e8e8e3` = 3.64:1(AA 미달), `.map-place-index{color:#8290a0}` on `#fff` = 3.26:1(AA 미달).
- **위치**: `app/app.css`(`.place-image`, `.map-place-index`).
- **영향**: 접근성 — 저시력 사용자가 placeholder·인덱스 텍스트를 읽기 어렵다.
- **수정안**: `#777`→`--text-secondary`(#555, 대비 7.46), `#8290a0`→더 어두운 톤(§9.8 토큰).
- **수용 기준**: [ ] 자동 대비 검사에서 두 조합이 AA(4.5:1) 이상.

#### UX-09 — 랜딩(`/`)에 `h1` 없음 (P2, PR-16에서 조기 처리)
- **재현/확인**: `home.tsx:70-104`에 `h1`이 없다. 라이브 CDP 3폭 전부 `h1: null`([확인] 이번 실행 재확인).
- **위치**: `app/routes/home.tsx:70-104`.
- **영향**: 접근성·SEO — 문서 개요와 스크린리더 진입점 상실.
- **수정안**: 지도 영역에 시각적으로 숨긴 `<h1 className="sr-only">광주·전남 맛 지도</h1>`(§9.1).
- **수용 기준**: [ ] 3폭 전부 `h1`이 정확히 1개.

#### UX-10 — skip-link 대상 `#main` 누락 라우트 4개 (P2)
- **재현/확인**: `admin-candidates.tsx:166`·`admin-places.tsx:17`·`admin-import.tsx:91`·`admin-data-sync.tsx:22`의 `<main>`에 `id="main"`이 없다([확인] 이번 실행 원문 대조 — 4개 모두 className만). skip-link(`root.tsx:12` `href="#main"`) 대상이 없어 건너뛰기가 무효.
- **위치**: 위 4개 라우트의 `<main>`.
- **영향**: 접근성 — 관리자 화면에서 skip-link가 작동하지 않는다.
- **수정안**: 4개 `<main>`에 `id="main"` 추가.
- **수용 기준**: [ ] 전 라우트의 `<main>`이 `id="main"`을 갖는다.

#### UX-11 — 디자인 토큰 형해화 (P2)
- **재현/확인**: 직접 계수 — `--s1~--s12` spacing 토큰 사용 0회, 고유 hex 66종 산재(§5.4·§9.8). `var(--signal)` 4회만.
- **위치**: `app/app.css`.
- **영향**: 유지보수 — semantic 토큰 층 부재로 색·간격 변경이 산탄식.
- **수정안**: 3층 토큰(§9.8) 도입. 하드코딩 hex·px를 lint로 차단.
- **수용 기준**: [ ] 신규 코드에 하드코딩 hex·px 0건.

#### UX-12 — 이중 스타일 시스템(Tailwind vs 수제 클래스) (P2)
- **재현/확인**: `app.css:1` `@import "tailwindcss"` + 수제 클래스 공존. 같은 오류 배너가 `.operation-error`(`app.css:26`)와 `border-rose-500 bg-rose-50`(`reviewer-apply.tsx:49`) 두 구현.
- **위치**: `app/app.css:1,26`, `app/routes/reviewer-apply.tsx:49`.
- **영향**: 유지보수 — 같은 UI가 두 방식으로 분기해 일관성·수정 비용 악화.
- **수정안**: 공통 `Banner`(status/warn/error 3변형, §9.8)로 통합.
- **수용 기준**: [ ] 오류 배너 구현이 1개.

#### DOC-02 — 관리자 감사 로그 조회 화면 P0 선언인데 코드 없음 (P2)
- **재현/확인**: `2026-08-05-tastedit-product-direction-v2-design.md:364`가 "관리자 감사 로그 조회 화면과 운영자 처리 이력을 제공한다"를 요건으로 두나 `app/routes/`에 해당 화면 0건([확인]). 기록 write는 8개 모듈에 존재(`adminAuditLogs`)하나 조회 UI가 없다.
- **위치**: `docs/superpowers/specs/2026-08-05-tastedit-product-direction-v2-design.md:364` vs `app/routes/`(부재).
- **영향**: 문서-코드 불일치 — 선언된 P0 기능 미구현.
- **수정안**: 감사 로그 조회 화면 구현 또는 스펙에서 단계 재분류(결정 기록).
- **수용 기준**: [ ] 스펙의 P0 화면 상태가 코드 현실과 일치한다.

#### DOC-03 — 인증 방식 3중 불일치 (P2)
- **재현/확인**: `retaste-master-design.md:84` "Better Auth + D1 세션", `next-product-decisions.md:43`(D-02) "이메일 매직링크", 실제 구현은 이메일+비밀번호(PBKDF2, `password.server.ts`). 셋이 다르다.
- **위치**: `docs/superpowers/specs/2026-08-05-retaste-master-design.md:84`, `docs/decisions/2026-08-05-next-product-decisions.md:43` vs `app/features/auth/password.server.ts`.
- **영향**: 문서-코드 불일치 — 결정 문서가 코드에 뒤처져 신뢰 불가.
- **수정안**: 실제 구현(이메일+비밀번호)을 decisions·master에 반영(ADR 갱신). 폐기된 Better Auth·매직링크 표기 제거.
- **수용 기준**: [ ] 인증 방식이 세 문서·코드에서 단일하다.

#### SEC-12 — 공급망 undici GHSA-4cwx-7wf7-3272 (P3, dev 전용 강등)
- **재현/확인**: `pnpm-lock.yaml` undici 7.28.0 ← miniflare ← wrangler/vite-plugin/vitest-pool-workers(전부 devDependencies). 프로덕션 Worker는 workerd 내장 fetch. 런타임 미도달로 Low.
- **위치**: `pnpm-lock.yaml`(undici 7.28.0 그래프).
- **영향**: 공급망(Low) — dev 툴체인 전용. 런타임 미도달.
- **수정안**: `pnpm.overrides`로 `undici@^7.29.0` 강제(최신 miniflare도 7.28.0 의존이라 wrangler 업그레이드로는 해소 안 됨 — §7.5). 업스트림 패치 후 override 제거.
- **수용 기준**: [ ] 로컬 dev·테스트 회귀 없이 undici가 패치 버전으로 고정된다.

#### SEC-13 — 미사용 인증 우회 코드 `upsertBetaUser` 잔존 (P3)
- **재현/확인**: `login.server.ts:15-20`의 `upsertBetaUser`가 존재하고 내부에서 조건부 `role: "ADMIN"`을 부여. 라우트 참조 0건([확인] 이번 실행 grep).
- **위치**: `app/features/auth/login.server.ts:15-47`.
- **영향**: 보안(Low) — 죽은 코드지만 향후 실수로 배선되면 관리자 승격 경로.
- **수정안**: 미사용 확인 후 삭제.
- **수용 기준**: [ ] `upsertBetaUser`가 코드베이스에 없다.

#### SEC-14 — QA 시드 고정 세션 ID로 ADMIN 세션 (P3, dev 전용)
- **재현/확인**: `seed-admin-qa.sql:1-7`이 `qa-admin-session` 등 고정 세션 ID로 ADMIN 세션 생성. 호출은 `playwright.config.ts:20`의 `--local`뿐([확인]).
- **위치**: `scripts/seed-admin-qa.sql:1-7`, `playwright.config.ts:20`.
- **영향**: 보안(Low, dev 전용) — `--local` 누락 시 운영 D1에 고정 ADMIN 세션 주입 위험.
- **수정안**: 시드 스크립트에 환경 가드(운영 DB면 거부) 또는 실행 래퍼로 `--local` 강제.
- **수용 기준**: [ ] QA 시드가 운영 D1에서 실행되지 않도록 가드된다.

#### SEC-15 — Flavor Print 템플릿–카테고리 정합성 미검증 (P3)
- **재현/확인**: `flavor-print.server.ts:32-33`이 템플릿 `status === "ACTIVE"`만 확인하고 템플릿이 대상 장소의 카테고리에 속하는지 검증하지 않는다.
- **위치**: `app/features/ratings/flavor-print.server.ts:32-33`.
- **영향**: 정합(Low) — 잘못된 카테고리 템플릿으로 Flavor Print 제출 가능.
- **수정안**: 제출 시 `templateId`의 categoryId가 장소 primary 카테고리와 일치하는지 검증.
- **수용 기준**: [ ] 카테고리 불일치 템플릿 제출이 거부된다.

#### ARC-10 — Naver SDK 로드 실패가 세션 내 영구화 (P3)
- **재현/확인**: `naver-map-sdk.ts:2` 모듈 레벨 `let sdkPromise`가 한 번 reject되면 세션 내내 실패 promise가 재사용돼 재시도가 안 된다.
- **위치**: `app/features/maps/naver-map-sdk.ts:2`.
- **영향**: 신뢰성(Low) — 일시적 네트워크 실패가 지도를 세션 내 영구 비활성으로.
- **수정안**: 실패 시 `sdkPromise`를 리셋해 재시도 가능하게. `.map-error`에 재시도 버튼(§9.1).
- **수용 기준**: [ ] SDK 로드 실패 후 재시도로 복구된다.

#### ARC-11 — 이메일/정정 토큰을 GET loader에서 소비 (P3, PR-5에서 처리)
- **재현/확인**: `verify-email.tsx:6`·`verify-correction.tsx:2`가 loader(GET)에서 토큰을 소비([확인]). 메일 클라이언트·보안 스캐너 프리페치가 클릭 전 소진 가능.
- **위치**: `app/routes/verify-email.tsx:6`, `app/routes/verify-correction.tsx:2`.
- **영향**: 신뢰성(Low) — 프리페치로 정상 인증 링크가 소진.
- **수정안**: 토큰 소비를 action(POST)으로 이전(SEC-03 PR-5와 함께).
- **수용 기준**: [ ] 링크 프리페치가 토큰을 소비하지 않는다.

#### ARC-12 — schema.ts ↔ migration FK 드리프트 2건 (P3)
- **재현/확인**: `drizzle/0007:12` `cached_from_id REFERENCES ai_classification_runs(id)`와 `0002:1` `parent_id REFERENCES categories(id)`가 `schema.ts:563`(`cachedFromId: text(...)` — FK 없음)·`:61`(`parentId: text("parent_id")` — FK 없음)에 반영 안 됨([확인]).
- **위치**: `drizzle/0007_ai_operations.sql:12`, `drizzle/0002_category_taxonomy.sql:1` vs `app/db/schema.ts:61,563`.
- **영향**: 유지보수(Low) — 런타임 영향 없으나 drizzle-kit 재생성 시 diff.
- **수정안**: `schema.ts`에 두 FK `references()` 추가로 마이그레이션과 동기화.
- **수용 기준**: [ ] drizzle-kit generate가 빈 diff.

#### QLT-09 — 커버리지 측정·임계값 설정 없음 (P3)
- **재현/확인**: `vitest.config.ts`·`vitest.workers.config.ts`에 coverage 설정 0건([확인] grep). 124+59 테스트가 있어도 커버리지 회귀 감지 불가.
- **위치**: `vitest.config.ts`, `vitest.workers.config.ts`.
- **영향**: 품질(Low) — 조직 표준(80%)과 대조할 수치 산출 불가.
- **수정안**: `@vitest/coverage-v8` 추가 + 임계값 설정 + CI 리포트.
- **수용 기준**: [ ] 커버리지 수치가 산출되고 임계 미달 시 CI 실패.

#### QLT-10 — `pnpm deploy` 표기 오류 + `packageManager` 미고정 (P3)
- **재현/확인**: `cloudflare-deploy.md:35` `pnpm deploy`가 pnpm 내장 워크스페이스 명령과 충돌해 스크립트가 실행되지 않을 수 있다[추론]. `package.json`에 `packageManager` 미고정.
- **위치**: `docs/operations/cloudflare-deploy.md:35`, `package.json`.
- **영향**: 운영(Low) — 배포 명령 오작동, pnpm 버전 드리프트.
- **수정안**: 스크립트명을 `deploy` 외 이름으로 변경 또는 `pnpm run deploy` 명시. `packageManager` 고정.
- **수용 기준**: [ ] 배포 명령이 의도한 스크립트를 실행한다. [ ] pnpm 버전이 고정된다.

#### UX-13 — 9–11px 초소형 타이포 클러스터 (P3)
- **재현/확인**: `app.css`의 `.brand span{9px}`, 지역 small 9px, 시트 내 10px 다수([확인] §5.4).
- **위치**: `app/app.css`.
- **영향**: 접근성(Low) — 초소형 텍스트 가독성.
- **수정안**: 위계 5단에서 9~11px 제거, 최소 12px(§9.8).
- **수용 기준**: [ ] 9~11px 텍스트 0건.

#### UX-14 — reduced-motion 커버리지 구멍 (P3)
- **재현/확인**: `app.css:50` `.place-detail-sheet` 애니메이션이 reduced-motion 예외(`:19,:47,:73`의 다른 reduced-motion 블록에 미포함)([확인]).
- **위치**: `app/app.css:50` vs `:19,:47,:73`.
- **영향**: 접근성(Low) — reduced-motion 사용자에게 시트 애니메이션이 남는다.
- **수정안**: reduced-motion 블록에 `.place-detail-sheet` 애니메이션 무효화 추가.
- **수용 기준**: [ ] reduced-motion에서 모든 비필수 애니메이션이 비활성.

#### UX-15 — 죽은 CSS·미등록 파일 (P3)
- **재현/확인**: `app/welcome/welcome.tsx`가 존재하나 `routes.ts`·`root.tsx` 참조 0건([확인] 이번 실행 — welcome.tsx EXISTS, 참조 no match). `.hero`·`.category-grid` 등 죽은 CSS.
- **위치**: `app/welcome/welcome.tsx`, `app/app.css`(미참조 규칙).
- **영향**: 유지보수(Low) — 죽은 코드가 "생성 후 점검 부재"의 잔재(§10.5 slop 근본원인).
- **수정안**: 미등록 파일·미참조 CSS 제거. `knip` 등으로 회귀 방지.
- **수용 기준**: [ ] 미참조 파일·CSS 0건.

---

## 14. 검증 완료 / 미완료 목록

### 14.1 이 오딧에서 직접 검증한 것

**코드 판독(스냅샷 직접 열람)** — `AGENTS.md`, `COWORK.md`, `README.md`, `package.json`, `wrangler.jsonc`, `app/routes.ts`, `app/root.tsx`, `app/app.css`(전문), `app/routes/home.tsx`, `place-detail.tsx`, `map-category.tsx`, `place-correction.tsx`, `place-list.tsx`(부분), `app/components/map/PlaceMap.tsx`(전문), `app/components/places/PlaceDetailSheet.tsx`(전문), `app/features/auth/session.server.ts`, `guards.server.ts`, `login.ts`, `password.server.ts`, `app/features/maps/map-state.ts`, `place-marker-policy.ts`, `app/features/places/place.server.ts`(핵심 구간), `app/features/ratings/integrity.server.ts`, `rating-badges.server.ts`, `app/features/candidates/ai-usage-policy.ts`, `workers/app.ts`, `playwright.config.ts`, `drizzle/` 목록. 그 외 파일은 위임 조사 결과를 §14.3의 조건으로 채택했다.

**직접 계산·계수** — `app.css` 고유 hex 66종, spacing 토큰 사용 0회, `var(--signal)` 4회, CSS 45,751 bytes. WCAG 대비율 14쌍(§5.4).

**라이브 실측(CDP + HTTP)** — 27개 렌더 조합의 오버플로·콘솔·랜드마크·마커·터치타깃·meta, 지오로케이션 2 시나리오(서울/광주)의 URL·zoom·status 전이, 응답 헤더, `robots.txt`/`sitemap.xml` 404, QA 세션 부재.

**외부 공식 자료(2026-08-07 조회)** — GitHub Security Advisory 1건, npm 공식 레지스트리 31개 패키지, GitHub Releases(react-router), Cloudflare 공식 문서 4개 페이지(D1 Worker API 본문 인용 포함), Naver Maps 공식 문서 2개 페이지, GitHub API로 PR #41 메타데이터·변경 파일.

### 14.2 검증하지 못한 항목 (구현 역할 관점)

| 항목 | 이유 |
|---|---|
| **ARC-02 (시트 저장 크래시)의 실행 재현** | 라이브 서버에 QA 세션 fixture가 없어(§8.1 실측) 로그인 상태를 만들 수 없었다. 계정 생성은 이메일 발송을 유발하므로 "이메일 발송 미승인" 범위 제약에 걸린다. **[추론]으로 남긴다** |
| **Cloudflare Workers Logs가 요청 URL 쿼리를 기록하는지** | SEC-03·SEC-04의 핵심 전제인데 실 배포 로그를 볼 수 없다. 공식 문서 페이지 존재만 확인했다. **실 배포 로그 1건 확인으로 즉시 판정 가능** |
| **`refer/ReTaste_Codex_MVP_개발명세서.docx`, `ReTaste_MVP_사업계획서.docx`** | .docx 판독 도구 없음. master design이 "세부 수학 모델과 데이터 정의는 개발명세서를 따르되"라고 위임하므로, 수학 모델 원 정의와 코드의 정합은 미검증 |
| **프로덕션 배포 여부·`week1-beta` 태그** | 스냅샷이 git 저장소가 아니라 태그·커밋 이력 확인 불가. 원격 D1 조회는 범위 밖 |
| **Cloudflare 대시보드 설정** (WAF, Rate Limiting 규칙, Bot Fight Mode, Access, 로그 보존기간, D1 백업) | 리포지토리에 흔적이 없어 존재 여부를 판단할 수 없다. SEC-01의 "Cloudflare 레벨 방어 가정"에 대한 확정 답변 불가 |
| **네이버 지도 콘솔의 서비스 URL 제한 설정** | 외부 콘솔. Client ID 노출 위험도(L 등급)의 전제 |
| **Resend 계정의 rate limit·SPF/DKIM/DMARC 상태** | 외부 서비스. SEC-02의 실제 피해 규모를 좌우 |
| **빌드 청크 957 kB / 741 kB의 실제 구성** | 빌드를 재실행하지 않았다(기수집 증거만 전제). import 그래프 추론에 그침 |
| **`pnpm audit` moderate 5건의 개별 패키지·경로** | 재실행하지 않았고 lockfile 그래프로 high 1건만 추적했다 |
| **커버리지 수치** | 측정 설정 자체가 없어 산출 불가(QLT-09) |
| **20곳 CSV의 실제 영업 상태·주소 수동 검수 수행 여부** | 저장소에 검수 로그가 없다(`data/SOURCES.md`는 "검수 필요"라고만 명시) |
| **`place_daily_metrics.directionClicks`·`saveActions`를 기록하는 코드** | 찾지 못했다. `detailViews`만 확인 |
| **모바일 Safari의 dvh·sticky·backdrop-filter 실동작** | Chrome headless로만 측정했다 |
| **실 Naver SDK 렌더 경로의 접근성**(SDK가 생성하는 줌 컨트롤 등) | SDK 런타임 산출물이며 코드로 판정 불가 |
| **PR #41 서버가 실제로 다른 워크트리 소속인지** | 서버 프로세스 계보를 조사하지 않았다. 시드 부재는 실측했으나 원인이 워크트리 재사용인지는 [추론] |

### 14.3 위임 조사 결과의 취급

이 오딧은 스냅샷의 276개 파일 전체를 한 컨텍스트에서 읽을 수 없어, 5개 축(제품문서 / 아키텍처 / 보안 / 품질·운영 / UI·UX)을 병렬 조사로 분담했다. **위임 결과를 그대로 옮기지 않았다.** 채택 기준은 다음과 같다.

- P0·P1로 승격한 항목은 **전부 내가 직접 해당 파일을 열어 재확인**했다(§14.1 목록).
- 재확인 과정에서 위임 결과를 **수정한 사례**: 위임 조사는 undici 대응으로 "wrangler 업데이트 권장"을 제시했으나, npm 레지스트리 직접 조회 결과 **최신 miniflare(5.20260801.0-alpha)도 여전히 undici 7.28.0을 의존**해 그 처방이 통하지 않음을 확인하고 `pnpm.overrides`로 교체했다(§7.5).
- 위임 조사 하나는 네트워크 권한 제약으로 라이브 조사에 실패했다. 그 결과는 채택하지 않고 **내가 직접 공식 레지스트리·advisory·문서를 조회해 §11과 §15를 다시 작성**했다.
- 재확인하지 못한 P2·P3 항목은 근거 위치를 명시했으니 수정 착수 전 해당 파일을 확인할 것.

### 14.4 남은 인간 검수와 프로덕션 증거

이 문서의 어떤 PASS 표기도 사람의 승인을 대신하지 않는다. 공개 베타 전에 다음이 **사람의 판단으로** 필요하다.

1. **법무 검토** — 위치정보 처리(SEC-04), 개인정보 처리방침·인벤토리 갱신(SEC-06), 탈퇴 정책(SEC-05), 14세 미만 처리. 이 문서의 규제 관련 서술은 전부 [추론]이며 법률 자문이 아니다.
2. **운영 결정** — 서비스명 확정(DOC-01), 계약 주체·개인정보 보호책임자 확정(`privacy.tsx:11,16`), 운영 문의 이메일 확정(QLT-04의 전제).
3. **프로덕션 증거** — 실 배포 후 Workers Logs 1건을 열어 URL 쿼리 기록 여부를 확정(SEC-03·SEC-04의 미검증 전제 해소). 원격 D1 마이그레이션 + 권한 회귀 QA 수행 기록.
4. **데이터 검수** — 20곳 CSV의 영업 상태·주소 확인 로그를 남길 것(`data/SOURCES.md`가 요구하나 기록이 없다). 단계 2 요건인 300곳까지의 검수 계획.
5. **시각 검수** — 이 문서의 UI 판정은 코드 + 헤드리스 측정 기반이다. 실기기(iOS Safari, Android Chrome)에서의 시각·터치 검수는 별도로 필요하다.
6. **독립 리뷰** — 이 보고서 자체는 구현 역할(Claude)의 산출물이며, 의뢰 계약상 별도 provider(Codex)의 독립 리뷰를 거쳐야 완료로 선언된다. 1차 독립 리뷰(round 1, `644d016a…`)가 FAIL이었고 차단 항목 7건을 §14.5대로 반영했다. 재검수가 필요하다.

### 14.5 1차 독립 리뷰 차단 항목 7건 반영 기록 (보완 실행 role-run-id `6a0d0eb1-0414-4697-9d02-dd52fa9aa855`, 2026-08-07)

이 보완 실행은 **원 작성·확정 실행(다른 role-run-id)의 자기보고를 승인 근거로 쓰지 않고**, 반영 대상 라인을 스냅샷에서 직접 재열람해 교정했다. 반영 내역:

| # | 1차 리뷰 차단 항목 | 반영 |
|---|---|---|
| 1 | finding 상세가 55건 중 10건뿐 | §13을 §13.1(장문 10건)+§13.2(나머지 45건, 동일 5필드 계약)로 확장. §12.6과 1:1 대응. `§13:1178`의 "P2·P3는 §3 표로 충분" 임의 면제 철회 |
| 2 | SEC-05 사실 판정 과장·모순 | "구현 자체 불가능"→"하드 삭제만 FK가 차단, 익명화는 현 스키마로 가능"으로 §2·§3·§7.4·§7.6·§12·§13 전부 교정. 익명화/하드 삭제 마이그레이션 필요성·수용 기준 분리 |
| 3 | SEC-03 처방이 URL bearer 위험 미제거 | 위협 모델(opaque-id도 bearer) 명시. 기본 처방(로그 스크러빙·no-referrer·단일사용·짧은 TTL·HTTPS)과 구조 선택지(URL 완전 제거 vs 교환+즉시 리다이렉트+HttpOnly 세션 바인딩) 분리. 수용 기준 강화 |
| 4 | release boundary·로드맵 미완결 | §12.6에 55개 ID 전부를 PR·결정·비조치에 1:1 매핑. P1 SEC-10·SEC-11·QLT-04·DOC-01 완료 PR/결정 추가(PR-12·13b·13c·결정 D-2). QLT-04를 P3 묶음에서 P1로 승격. §2 release boundary와 정합 |
| 5 | Critical 등급 근거 미달 | SEC-01·SEC-02를 Critical→**High**로 교정. 재현하지 않은 절차를 결과처럼 쓰지 않도록 "미실행 재현 절차"로 명시 분리. 우선순위(P0)와 심각도(High)를 별개 축으로 설명(§3 서두·§7.6) |
| 6 | 화면별 개선안이 전체 흐름 미포함 | §9.10 `/places`, §9.11 `/me`, §9.12 리뷰어 신청, §9.13 리뷰어 평가, §9.14 관리자 운영 화면군 6종, §9.15 오프라인·네트워크 실패를 각각 6필드 계약으로 추가 |
| 7 | 라이브 375/768/1440 독립 검증 미완 | 구현 역할이 27조합 CDP 실측을 재재실행해 동일 결과 재확인(`cdp-results-verify-6a0d0eb1.json`: 오버플로 0·콘솔 0·OG 0·랜딩 h1 null·장소 title 3폭 동일). 라이브 서버 `http://127.0.0.1:5173/` HTTP 200 유지 확인. **단 독립 시각 검수는 검수 역할의 몫이며 구현 역할의 재실측이 이를 대신하지 않는다** — §1.2에 `localhost` IPv6 접속 거부 대비 `127.0.0.1` 사용 안내 추가(리뷰어 접속 실패 원인 대응) |

**이 보완 실행이 재열람으로 직접 검증한 라인 (표본)**: `place.server.ts:104-110·118-121·207-218·300-306`, `0000_week1.sql:50-55`, `account.server.ts:46-53·63·74-80`, `session.server.ts:10`, `vote.server.ts:36-52`, `integrity.server.ts:38-48`, `golden-pick.server.ts:30-44`, `place-merge.server.ts:21-43`, `bulk-review.server.ts:136-149`, `candidate.server.ts:46`, `admin-place-operations.tsx:31-63`, `reviewer-ratings.tsx:18-27`, `place-list.tsx`(전문), `me.tsx`(전문), `reviewer-apply.tsx`(전문), `admin-places.tsx`(전문), `admin-reviewers.tsx`(전문), `root.tsx`(전문), `privacy.tsx:9-16`, `privacy-data-inventory.md:12-22`, `signup.tsx:19·28`, `forgot-password.tsx:8`, `place-correction.tsx:4`, `map-category.tsx:27`, `verify-email.tsx:6`, `verify-correction.tsx:2`, `schema.ts:23-24·61·125-127·393·475·563`, `drizzle/0002:1`·`0007:12`, `flavor-print.server.ts:32-33`, `naver-map-sdk.ts:2`, `login.server.ts:15-20`, `seed-admin-qa.sql:1-7`, `playwright.config.ts:19-24`, `ai-classification.server.ts:12-13`, `ai-usage-policy.ts:1-2`, `week1-data-runbook.md:24-27·55`, `ai-operations-runbook.md:7·17-18`, `cloudflare-deploy.md:7·26-27·35`, `README.md:22-29`, v2 design `:1·:19·:364`, master design `:84`, decisions `:43`. `.github`·`public/_headers` 부재와 `welcome.tsx` 미참조, `upsertBetaUser`·`coverage`·`onLine/serviceWorker` grep 무결과도 이번 실행에서 직접 재확인. 라인은 전부 원문과 일치했다(교정한 것은 인용 라인 자체가 아니라 SEC-05 판정·SEC-03 처방·심각도·매핑·화면 계약의 서술).

---

## 15. 공식 출처 목록

전부 **2026-08-07에 직접 조회**했다. npm 레지스트리(`registry.npmjs.org`)는 패키지 버전·발행일·라이선스의 공식 1차 출처다.

| # | 제목 | URL | 확인일 | 뒷받침하는 판단 |
|---|---|---|---|---|
| 1 | GitHub Security Advisory GHSA-4cwx-7wf7-3272 (CVE-2026-13697, undici) | https://github.com/advisories/GHSA-4cwx-7wf7-3272 | 2026-08-07 | 영향 범위 `>=7.0.0 <7.29.0` / 패치 7.29.0 / high / 공개일 2026-08-03 — SEC-12 등급 판정의 근거 |
| 2 | npm registry — `undici` | https://registry.npmjs.org/undici | 2026-08-07 | 최신 8.10.0(2026-08-03). 프로젝트 고정은 7.28.0(취약 범위 내) |
| 3 | npm registry — `miniflare` | https://registry.npmjs.org/miniflare | 2026-08-07 | **최신 5.20260801.0-alpha도 undici 7.28.0 의존** — "wrangler 업그레이드로 해소"가 오늘 기준 통하지 않음을 확정. §7.5 override 처방의 직접 근거 |
| 4 | npm registry — `wrangler` | https://registry.npmjs.org/wrangler | 2026-08-07 | 4.119.0(2026-08-05) → miniflare 5.20260801.0-alpha 의존 확인 |
| 5 | Cloudflare Docs — D1 Worker API (`D1Database`) | https://developers.cloudflare.com/d1/worker-api/d1-database/ | 2026-08-07 | "D1 operates in auto-commit… Batched statements are SQL transactions… aborts or rolls back the entire sequence" — §6.4의 batch 원자성 판정 근거(본문 직접 인용) |
| 6 | Cloudflare Docs — Workers AI Pricing (Neurons) | https://developers.cloudflare.com/workers-ai/platform/pricing/ | 2026-08-07 | 뉴런 단위 과금 체계 확인 — `ai-usage-policy.ts`의 뉴런 기반 쿼터 설계가 플랫폼 모델과 정합함을 뒷받침 |
| 7 | Cloudflare Docs — Workers Observability | https://developers.cloudflare.com/workers/observability/ | 2026-08-07 | Workers Logs 기능 존재 확인 — §11.5 KEEP 판정. 단 URL 쿼리 기록 여부는 미확정(§14.2) |
| 8 | Cloudflare Docs — Web Analytics | https://developers.cloudflare.com/web-analytics/ | 2026-08-07 | 쿠키리스 RUM 옵션 존재 — §11.7 ADOPT 근거 |
| 9 | Naver Maps JS API v3 — 마커 클러스터 문서 | https://navermaps.github.io/maps.js.ncp/docs/tutorial-marker-cluster.example.html | 2026-08-07 | 공식 MarkerClustering 지원 확인 — §11.3에서 "가능하지만 채택하지 않는" 근거(제품 요구가 행정구역 라벨이므로) |
| 10 | GitHub Releases — react-router | https://api.github.com/repos/remix-run/react-router/releases | 2026-08-07 | 8.3.0(2026-07-22)이 최신 8.x — 프로젝트가 최신 라인에 있음을 확인 |
| 11 | npm registry — `react` / `react-dom` | https://registry.npmjs.org/react | 2026-08-07 | 19.2.8(2026-07-21) 최신 — §11.8 업그레이드 불필요 판정 |
| 12 | npm registry — `zod` | https://registry.npmjs.org/zod | 2026-08-07 | 4.4.3(2026-05-04) 최신 = 프로젝트 선언 버전 — §11.4 KEEP 근거 |
| 13 | npm registry — `drizzle-orm` / `drizzle-zod` | https://registry.npmjs.org/drizzle-orm | 2026-08-07 | 0.45.2(2026-03-27) 최신 / drizzle-zod 0.8.3(2025-08-06) — §11.4 PILOT 조건(유지보수 상태 확인)의 근거 |
| 14 | npm registry — `@base-ui/react` 및 `@base-ui-components/react` | https://registry.npmjs.org/@base-ui/react | 2026-08-07 | 신 패키지 1.7.0(2026-08-04), 구 패키지 deprecated("Package was renamed to @base-ui/react") — §11.1 현시점 REJECT 근거 |
| 15 | npm registry — `@radix-ui/react-dialog`, `react-aria-components`, `@ark-ui/react`, `@headlessui/react` | https://registry.npmjs.org/@radix-ui/react-dialog 외 | 2026-08-07 | 각 1.1.23 / 1.20.0 / 5.38.0 / 2.2.10, 라이선스 MIT·Apache-2.0 — §11.1 비교표 |
| 16 | npm registry — `@tanstack/react-table`, `@tanstack/react-virtual`, `react-window` | https://registry.npmjs.org/@tanstack/react-table 외 | 2026-08-07 | 9.0.0(2026-08-04) / 3.14.9 / 2.3.0 — §11.2 비교표. 메이저 직후임을 확인 |
| 17 | npm registry — `supercluster`, `maplibre-gl` | https://registry.npmjs.org/supercluster | 2026-08-07 | supercluster 8.0.1이 **2023-04-27 이후 릴리스 없음**(ISC) / maplibre-gl 6.2.0(2026-08-06, BSD-3) — §11.3 REJECT 근거 |
| 18 | npm registry — `axe-core`, `@axe-core/playwright`, `pa11y`, `eslint-plugin-jsx-a11y` | https://registry.npmjs.org/axe-core 외 | 2026-08-07 | axe-core 4.13.0(2026-08-05, MPL-2.0) / @axe-core/playwright 4.12.1 / pa11y 9.1.1(**LGPL-3.0-only**) / jsx-a11y 6.10.2(**2024-10-26 정체**) — §11.6 ADOPT·REJECT·PILOT 판정 |
| 19 | npm registry — `playwright` | https://registry.npmjs.org/playwright | 2026-08-07 | 1.62.1(2026-07-30) = 프로젝트 버전 — §11.6 KEEP |
| 20 | npm registry — `web-vitals`, `@sentry/cloudflare`, `@opentelemetry/api` | https://registry.npmjs.org/web-vitals 외 | 2026-08-07 | 6.1.0(2026-08-05, Apache-2.0) / 10.69.0(2026-07-29, MIT) / 1.9.1(2026-03-25) — §11.5·§11.7 |
| 21 | npm registry — `typescript`, `tailwindcss`, `valibot`, `arktype` | https://registry.npmjs.org/typescript 외 | 2026-08-07 | TS 7.0.2(2026-07-08) / Tailwind 4.3.3 / valibot 1.4.2 / arktype 2.2.3 — §11.4·§11.8 |
| 22 | GitHub API — `taejunyun1/Tasted_it` PR #41 (메타데이터·변경 파일) | https://api.github.com/repos/taejunyun1/Tasted_it/pulls/41 | 2026-08-07 | 상태 open·미병합, head `406b1b3`, 변경 6파일(`location-policy.ts` 신규 포함) — §1.3 델타 분리의 근거 |

**출처 22건 중 공식 1차 자료 22건** (의뢰 요구는 최소 12건). 블로그·요약 매체는 인용하지 않았다.

---

## 부록 A. 이 오딧이 명시적으로 하지 않은 판단

- 각 결함의 **수정 공수 시간 추정**을 하지 않았다. PR 크기(소/중)만 표기했다. 실제 공수는 이 코드베이스에 익숙한 사람이 산정해야 한다.
- **자동 테스트 PASS를 근거로 어떤 승인도 선언하지 않았다.** typecheck·build·unit PASS는 §8.6 표에서 "게이트 통과"로만 기록했고 제품 승인과 분리했다.
- **HTTP 200과 서버 프로세스 존재를 정상 동작의 증거로 쓰지 않았다.** 라이브 실측은 전부 구체적 값(DOM 상태, URL 전이, 헤더 목록)으로 기록했다.
- **시각 디자인의 전면 재설계를 제안하지 않았다.** 현재 흑백 + 단일 녹색 accent + 각진 편집 그리드 방향은 결정의 흔적이 뚜렷하며(§10.5), 개선안은 전부 이 방향 **안에서**의 정합성·접근성·토큰화다.
- **라이브러리 도입을 기본값으로 두지 않았다.** 7개 도메인 중 5개가 KEEP이며, 각 도메인에서 "고정된 문제"를 먼저 적고 그것이 라이브러리로 풀리는지를 따로 판정했다.
