# 공공데이터 장소 후보·어드민 검수 구현 계획

**목표:** 광주·전남의 영업 중 음식점 인허가 데이터만 비공개 후보로 수집하고, 어드민 승인 후 네이버 지도와 검색에 공개하며 휴·폐업 전환 시 자동 숨김한다.

**구조:** 공공데이터 원천 테이블과 공개 `places`를 분리한다. 서버 전용 API 클라이언트가 주소 조건으로 페이지를 수집해 D1에 멱등 upsert하고, 관리자 전용 후보 서비스가 승인·반려를 트랜잭션으로 처리한다. 사용자 지도와 후보 지도는 기존 네이버 지도 SDK를 공유하되 서로 다른 서버 쿼리를 사용한다.

**기술:** React Router 8, Cloudflare Workers/D1, Drizzle ORM, NAVER Maps JavaScript API, Zod, Vitest Workers, Playwright.

## Task 1: 상태·응답 정규화 단위 로직

**파일:**
- 생성: `app/features/candidates/public-data.ts`
- 생성: `tests/unit/public-data.test.ts`

1. 서비스키 단일 인코딩, API 응답 파싱, 상태 정규화, 지역 판정 테스트를 먼저 작성한다.
2. 실패를 확인한다.
3. 최소 구현으로 테스트를 통과시킨다.
4. 단위 테스트와 타입 검사를 실행한다.

## Task 2: D1 스키마와 마이그레이션

**파일:**
- 수정: `app/db/schema.ts`
- 생성: `drizzle/0001_public_data_candidates.sql`
- 수정: `tests/unit/schema-contract.test.ts`
- 수정: `tests/integration/apply-migrations.ts`

1. 후보·연결·동기화 실행·감사 로그 계약 테스트를 작성한다.
2. Drizzle 테이블과 SQL 마이그레이션을 추가한다.
3. 로컬 D1 마이그레이션과 계약 테스트를 실행한다.

## Task 3: 후보 저장소와 승인·반려 서비스

**파일:**
- 생성: `app/features/candidates/candidate.server.ts`
- 생성: `tests/integration/candidate.server.test.ts`

1. 영업 중 대기 후보만 조회되는 테스트, 승인 트랜잭션 테스트, 반려 테스트, 폐업 시 장소 숨김 테스트를 작성한다.
2. 후보 upsert, 목록 조회, 승인·반려, 연결 장소 숨김을 구현한다.
3. Workers 통합 테스트를 실행한다.

## Task 4: 공공데이터 배치 동기화

**파일:**
- 생성: `app/features/candidates/sync.server.ts`
- 생성: `tests/unit/public-data-client.test.ts`
- 생성: `tests/integration/candidate-sync.test.ts`
- 수정: `app/cloudflare-env.d.ts`
- 수정: `.dev.vars.example`

1. 주소 조건 URL, 페이지 커서, 중복 제거, 오류 처리를 테스트한다.
2. 네 API 출처와 `전남광주통합특별시` 주소 조건의 최대 5페이지 배치를 구현하고 광주 5개 구와 전남 시·군으로 내부 분류한다.
3. 키와 원본 응답이 로그·클라이언트에 노출되지 않는지 확인한다.

## Task 5: 어드민 후보 목록·네이버 지도·검수 UI

**파일:**
- 생성: `app/routes/admin-candidates.tsx`
- 생성: `app/routes/admin-data-sync.tsx`
- 생성: `app/components/map/CandidateMap.tsx`
- 수정: `app/routes.ts`
- 수정: `app/app.css`
- 생성: `tests/e2e/admin-candidates.spec.ts`

1. 관리자 접근, 폐업 후보 미노출, 승인·반려 흐름의 브라우저 테스트를 작성한다.
2. 후보 목록/지도 전환, 검색·출처 필터, 상세 검수 폼을 구현한다.
3. 폰트는 본문 400~500, 버튼·레이블 500~600, 핵심 제목만 700으로 제한한다.
4. 동기화 진행·결과 화면을 구현한다.

## Task 6: Scheduled Worker와 운영 설정

**파일:**
- 수정: `workers/app.ts`
- 수정: `wrangler.jsonc`
- 수정: `docs/operations/week1-data-runbook.md`

1. 예약 실행이 미완료 배치를 이어가는 동작을 테스트 가능한 함수로 분리한다.
2. 일일 cron과 `ctx.waitUntil`을 연결한다.
3. Cloudflare secret 등록·최초 동기화·폐업 점검 절차를 문서화한다.

## Task 7: 전체 검증과 전달

1. `pnpm test`, `pnpm test:integration`, `pnpm typecheck`, `pnpm build`를 실행한다.
2. 로컬 브라우저에서 후보 지도와 승인 후 공개 지도를 확인한다.
3. 변경 범위만 커밋하고 기능 브랜치를 push한다.
4. `main` 대상 PR을 열고 diff와 필수 검사를 확인한다.
5. 검사 통과 후 squash merge하고 원격 기능 브랜치를 삭제한다.
6. 최신 `origin/main`에서 프로덕션 배포 후 공개 URL과 동기화 상태를 점검한다.
