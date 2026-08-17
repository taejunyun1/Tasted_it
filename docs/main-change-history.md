# Re:Taste `main` 변경 이력 SSOT

- **문서 역할:** `main` 변경 이력의 탐색·요약·영향 인덱스 SSOT
- **상태:** ACCEPTED — [PR #157](https://github.com/taejunyun1/Tasted_it/pull/157) 병합 시 적용
- **마지막 확인:** 2026-08-17 01:37 KST
- **확인한 원격 기준:** [`562d5f4`](https://github.com/taejunyun1/Tasted_it/commit/562d5f42ec2cd765f0df6617b887aeee9f9664b2)
- **이번 기준선 범위:** [`b44b8f5`](https://github.com/taejunyun1/Tasted_it/commit/b44b8f5b621771717dc4b4fa71d5feb46934df41) 제외부터 `562d5f4` 포함까지
- **원본 저장소:** [`taejunyun1/Tasted_it`](https://github.com/taejunyun1/Tasted_it)

이 문서는 원격 `main`에 무엇이, 왜, 어떤 영향과 함께 들어왔는지 찾는 공식 인덱스다. 현재 파일 상태의 원본은 `origin/main`, 승인·운영 범위의 원본은 병합 Pull Request, 여러 변경을 연결해 읽는 기준은 이 문서다. 상세 권한 경계는 [`main 변경 이력 인덱스 SSOT 지정`](./decisions/2026-08-16-main-change-history-ssot.md)을 따른다.

> **정확성 규칙:** 위 기준 커밋과 현재 `origin/main`이 다르면 이 문서를 최신으로 간주하지 않는다. 먼저 누락된 커밋과 병합 PR을 대조하고 이력을 갱신한다. 이 문서만으로 배포, 원격 D1 migration, 운영 데이터 변경 또는 외부 API 호출의 실제 완료를 주장하지 않는다.

## 기준선 이후 등록된 변경

| 상태 | 변경과 영향 | 근거 |
| --- | --- | --- |
| Proposed | 검수 파이프라인 옆에 영업 재검증·정정·병합 탭을 복구한다. 기존 서버 가드를 유지하고 동일 상호 일괄 자동 병합은 넣지 않는다. 배포·원격 D1·NAVER 실호출은 이 PR에 없다. | [Issue #165](https://github.com/taejunyun1/Tasted_it/issues/165) · [PR #175](https://github.com/taejunyun1/Tasted_it/pull/175) |
| Proposed | 검수 1단계에 회원 장소 제안 승인 UI를 복구한다. SUBMITTED 제안을 지도 확인·사유 입력 후 초안 승인하면 `PLACE_SUGGESTION` work item이 5단계 큐에 합류한다. 배포·원격 D1·NAVER 실호출은 이 PR에 없다. | [Issue #164](https://github.com/taejunyun1/Tasted_it/issues/164) · [PR #173](https://github.com/taejunyun1/Tasted_it/pull/173) |
| Proposed | 운영 Cloudflare 계정 SSOT를 정정한다. 두 운영자 로그인은 계정 `7543330c65069ee2df1b7b353fb0201c`에서 Worker `retaste-beta`와 D1 `retaste-production`을 본다. 가정 계정·개인 계정은 쓰기 대상이 아니다. Jay 채팅 승인 후 `origin/main` `5c4285f` 배포 결과를 기록한다. | [Issue #162](https://github.com/taejunyun1/Tasted_it/issues/162) · [Issue #166](https://github.com/taejunyun1/Tasted_it/issues/166) · [PR #174](https://github.com/taejunyun1/Tasted_it/pull/174) |
| Proposed | 검수 1–5단계 요청/응답 계약과 오류 카탈로그를 추가해 알려진 검수 실패가 전역 500 대신 화면 400이 되게 한다. 로그인 `returnTo`는 `/admin`·`/admin/*`를 허용하고, 운영 대시보드는 `PLACE_REVIEW_*` 공개/보류/제외를 집계한다. 배포·원격 D1·NAVER 실호출은 이 PR에 없다. | [Issue #170](https://github.com/taejunyun1/Tasted_it/issues/170) · [Issue #167](https://github.com/taejunyun1/Tasted_it/issues/167) · [Issue #171](https://github.com/taejunyun1/Tasted_it/issues/171) · [PR #172](https://github.com/taejunyun1/Tasted_it/pull/172) |
| Proposed / TJ `GO` | 관리자 HOLD 오딧과 후속 실행 플랜을 문서화한다. 오딧이 비운 라이브 재현·원격 D1·NAVER 실호출·코드/커밋/배포·잔여 이슈 정리를 #161–#168·#170·#171에 포함한다. 제품 코드·migration·운영 데이터는 바꾸지 않는다. 이 PR 병합은 문서 채택이며 배포·원격 쓰기를 승인하지 않는다. | [Issue #160](https://github.com/taejunyun1/Tasted_it/issues/160) · [PR #169](https://github.com/taejunyun1/Tasted_it/pull/169) |
| Ready / CI PASS | 변경 이력 SSOT·권한 경계·PR 템플릿을 도입하고 README/운영 런북의 NAVER 상한 설명을 정합화한다. 제품 코드·migration·운영 설정은 바꾸지 않는다. 기존 typecheck 오류는 #159에서 수정됐고, 최신 기준선에서 로컬 typecheck·전체 단위 테스트·build와 PR CI가 모두 통과했다. 병합 squash SHA는 다음 기준점 정합성 확인에서 기록한다. | [Issue #156](https://github.com/taejunyun1/Tasted_it/issues/156) · [PR #157](https://github.com/taejunyun1/Tasted_it/pull/157) · [Issue #158](https://github.com/taejunyun1/Tasted_it/issues/158) · [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159) · [PR CI](https://github.com/taejunyun1/Tasted_it/actions/runs/31959115738) |

## 기준선 요약

| 항목 | 값 |
| --- | --- |
| 기간 | 2026-08-14 20:40 KST ~ 2026-08-17 01:31 KST |
| 병합 PR / `main` 커밋 | 31 / 31 |
| 순변경 | 197 files, +15,001 / -1,742 lines |
| 커밋별 누적 변경 | +15,917 / -2,658 lines |
| 신규 migration | 7 files: `0029`, `0030`, `0031` 2개, `0032`, `0033`, `0034` |
| 주요 영역 | 음식점 분류, 추천 계층, NAVER 근거 검증, 장소 검수 파이프라인, 운영 감사, 지도·관리자 UX |
| 운영 완료 증거 | 이 문서에서는 확인하지 않음. 각 PR 및 별도 운영 기록 필요 |

### 현재 검증 상태

- 이전 기준선 `5b56dd3`의 [push CI run 31946826546](https://github.com/taejunyun1/Tasted_it/actions/runs/31946826546)과 갱신 전 [PR #157 CI](https://github.com/taejunyun1/Tasted_it/actions/runs/31951020332)는 `PlaceReviewPipeline.tsx:85`의 같은 `TS2339`로 실패했다.
- [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159)는 idle fetcher의 `formData` 접근을 제거하고 순차 요청별 응답 ID를 검증하도록 수정했다. 최신 `origin/main` `562d5f4`의 [push CI run 31958857659](https://github.com/taejunyun1/Tasted_it/actions/runs/31958857659)는 typecheck와 전체 단위 테스트를 통과했다.
- 따라서 현재 기준선과 최신 [PR #157 CI run 31959115738](https://github.com/taejunyun1/Tasted_it/actions/runs/31959115738)의 **CI 상태는 PASS**다. PR #157은 `562d5f4`를 반영했으며, 현재 병합 판단은 **Ready**다.

### 가장 큰 변동

1. **분류와 추천 계약 정리:** 음식점 자동 제외와 복원, 추천 적격성·행동 가치 계층, 장소 분류 v5와 코스 추천 v2가 추가됐다.
2. **외부 근거 전환:** Workers AI 실행 경로를 제거하고 NAVER API HUB 기반 근거 검증 워크벤치로 전환했다. 호출 제한, 저장 최소화, kill switch를 함께 기록했다.
3. **공개 전 검수 강화:** 공공데이터 원천부터 NAVER·카테고리·중복·선택 공개까지 5단계 서버 강제형 파이프라인을 추가하고 레거시 우회 화면을 통합했다.
4. **운영 안전성 보강:** 읽기 전용 통합 감사, 공개 장소 회수/복구 이력, 10건 순차 NAVER 검증, 오류 화면 내 처리를 추가했다.
5. **사용자·관리자 UX 개선:** 모바일 추천 지도 바텀 시트, 장소 위치 선택 카드, 카테고리 모달/일괄 적용, 운영 탭 분리를 반영했다.

## 상세 변경 이력

모든 시각은 `Asia/Seoul` 기준이다. 커밋의 `+/-`는 해당 squash commit의 GitHub 통계이며 바이너리 파일의 크기 변화는 줄 수에 포함되지 않는다.

### 2026-08-17

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 15:22 | 관리자 / 운영 탭 | 검수 옆에 영업 재검증·정정·수동 병합 탭을 복구한다. 동일 상호 후보는 보여 주되 일괄 자동 병합은 하지 않는다. | 코드·테스트·E2E 증거. migration·환경 변수·원격 D1·NAVER 실호출 없음. 배포는 병합 후 `origin/main`. | [Issue #165](https://github.com/taejunyun1/Tasted_it/issues/165) · [PR #175](https://github.com/taejunyun1/Tasted_it/pull/175) |
| 14:22 | 운영 / Cloudflare | 두 운영자 로그인이 같은 owner 계정에서 Worker/D1를 본다는 결론으로 오딧·플랜·런북을 정정한다. 원격 migration은 대기 없음. Jay 채팅 승인 후 `origin/main` `5c4285f`를 계정 `7543330c…`에 배포한 결과를 기록한다. | 문서 4파일. 제품 코드·migration apply·D1 create·NAVER 실호출 없음. Worker 버전 `194a3423-7964-4c58-98d5-0f2d0d822d0d`. rollback은 직전 버전 `d899f619-3df5-49a1-85f6-c5d3b9de87bf`. | [Issue #162](https://github.com/taejunyun1/Tasted_it/issues/162) · [Issue #166](https://github.com/taejunyun1/Tasted_it/issues/166) · [PR #174](https://github.com/taejunyun1/Tasted_it/pull/174) |
| 13:52 | 관리자 / 제안 승인 | 검수 1단계에 회원 장소 제안 목록과 지도 확인 승인 UI를 복구한다. 승인된 DRAFT만 기존 5단계 큐에 합류한다. | 코드·테스트·E2E 증거. migration·환경 변수·배포·원격 D1·NAVER 실호출 없음. | [Issue #164](https://github.com/taejunyun1/Tasted_it/issues/164) · [PR #173](https://github.com/taejunyun1/Tasted_it/pull/173) |
| 13:40 | 관리자 / 검수 계약 | 검수 단계별 송수신·예외 규칙, 관리자 `returnTo`, 운영 대시보드 파이프라인 지표를 코드로 고정한다. 알려진 검수 오류는 화면 400으로 남긴다. | 코드·테스트 12파일. migration·환경 변수·배포·원격 D1·NAVER 실호출 없음. | [Issue #170](https://github.com/taejunyun1/Tasted_it/issues/170) · [Issue #167](https://github.com/taejunyun1/Tasted_it/issues/167) · [Issue #171](https://github.com/taejunyun1/Tasted_it/issues/171) · [PR #172](https://github.com/taejunyun1/Tasted_it/pull/172) |
| 13:05 | 관리자 / 오딧 | 관리자 HOLD 오딧과 후속 실행 플랜을 추가한다. 라이브 로그인 재현, 원격 D1 목록, NAVER 실호출, 코드/커밋/배포, Codex 잔여 이슈 정리를 후속 이슈 #161–#168에 포함한다. 상태는 `PROPOSED`이며 TJ 컨펌 전 후속 착수하지 않는다. | 문서 3파일. 제품 코드·migration·환경 변수·배포·원격 D1·NAVER 호출 없음. | [Issue #160](https://github.com/taejunyun1/Tasted_it/issues/160) · [PR #169](https://github.com/taejunyun1/Tasted_it/pull/169) |
| 01:31 | NAVER / CI 안정화 | React Router v8 fetcher가 idle일 때 존재하지 않는 `formData`를 읽던 타입 오류를 제거했다. 각 순차 요청에 고유 ID를 부여하고 현재 요청과 일치하는 응답만 반영해 지연 응답의 교차 소비도 차단했다. | 코드·테스트 3파일, +15/-4. route action·DB·migration·환경 변수·의존성·배포 변화 및 실제 NAVER 호출 없음. | [Issue #158](https://github.com/taejunyun1/Tasted_it/issues/158) · [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159) · [`562d5f4`](https://github.com/taejunyun1/Tasted_it/commit/562d5f42ec2cd765f0df6617b887aeee9f9664b2) |

### 2026-08-16

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 21:21 | 안정화 / CI | `admin-place-operations`의 `autoWorkItem`이 `unknown[]`로 추론되던 대상 오류를 정리했다. 다만 현재 `main` CI는 별도 `PlaceReviewPipeline.tsx:85` 오류로 여전히 실패하므로 전체 typecheck 복구로 해석하지 않는다. | 코드 1파일, +8/-1. 데이터·API·설정 변화 없음. 잔여 CI 실패는 [#158](https://github.com/taejunyun1/Tasted_it/issues/158)에서 추적한다. | [PR #155](https://github.com/taejunyun1/Tasted_it/pull/155) · [`5b56dd3`](https://github.com/taejunyun1/Tasted_it/commit/5b56dd321c85619b347518fd23ec13e1ed45ad16) |
| 21:04 | NAVER / 검수 | 최대 10건을 단건 순차 처리해 Worker 1102 위험을 낮추고, 수동·자동 흐름을 분리했다. 확인된 NAVER 매핑 카테고리는 검수 작업에 반영한다. | 코드·테스트 7파일, +164/-18. 기존 NAVER 호출 경계를 사용하며 신규 migration 없음. | [PR #154](https://github.com/taejunyun1/Tasted_it/pull/154) · [`c171382`](https://github.com/taejunyun1/Tasted_it/commit/c171382) |
| 07:42 | NAVER / 검수 UX | 화면에서는 최대 25곳을 선택하되 서버는 앞 10곳만 처리하고 나머지 선택을 유지한다. 자동 3단계 이동을 제거하고 관리자가 결과 확인 후 직접 이동하게 했다. | 외부 호출은 요청당 최대 10건. 신규 비밀값·migration·일괄 데이터 변경 없음. | [PR #152](https://github.com/taejunyun1/Tasted_it/pull/152) · [`1b34d2e`](https://github.com/taejunyun1/Tasted_it/commit/1b34d2e) |
| 07:28 | NAVER / 성능 | 화면과 서버의 NAVER 검증 한도를 모두 10건으로 고정하고 계약 테스트를 추가해 Worker CPU 리소스 초과를 완화했다. | 일일 20,000회 상한은 유지하고 요청당 처리량만 축소. 재발 시 비동기 큐 검토가 남았다. | [PR #151](https://github.com/taejunyun1/Tasted_it/pull/151) · [`9d3bf10`](https://github.com/taejunyun1/Tasted_it/commit/9d3bf10) |

### 2026-08-15

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 22:47 | 관리자 오류 처리 | 비음식점 자동 제외 배치 예외를 전체 오류 페이지 대신 현재 화면 오류 메시지로 반환한다. | 코드·테스트 2파일, +13/-2. DB·외부 API 변화 없음. | [PR #149](https://github.com/taejunyun1/Tasted_it/pull/149) · [`22899fd`](https://github.com/taejunyun1/Tasted_it/commit/22899fd) |
| 22:39 | NAVER / 화면 전환 | 성공 직후 서버 redirect를 제거하고 현재 화면에 결과를 유지한 뒤 클라이언트가 3단계로 이동하도록 바꿨다. 직전 #145의 즉시 redirect 방식을 안전한 전환으로 교정했다. | migration·운영 데이터·추가 NAVER 호출 없음. | [PR #147](https://github.com/taejunyun1/Tasted_it/pull/147) · [`d208921`](https://github.com/taejunyun1/Tasted_it/commit/d208921) |
| 22:29 | NAVER / 화면 전환 | NAVER 검수 성공 뒤 카테고리 확정 3단계로 이동하고 페이지를 1로 초기화하되 필터를 보존하도록 했다. | UI 흐름과 회귀 테스트만 변경. 이후 #147과 #152가 전환 방식을 보완했다. | [PR #145](https://github.com/taejunyun1/Tasted_it/pull/145) · [`9af4788`](https://github.com/taejunyun1/Tasted_it/commit/9af4788) |
| 22:11 | 원천 검수 / 자동 제외 | 현재 페이지 전체 선택을 토글로 통합하고 최대 25곳의 확실한 비음식점만 `EXCLUDED/AUTO_NON_FOOD`로 기록한다. 원천·장소 데이터와 기존 공개 상태는 삭제하지 않는다. | 기존 복원 흐름으로 되돌릴 수 있는 감사 이력이 생긴다. 신규 migration·외부 호출 없음. | [PR #143](https://github.com/taejunyun1/Tasted_it/pull/143) · [`4a107dc`](https://github.com/taejunyun1/Tasted_it/commit/4a107dc) |
| 21:35 | 관리자 IA / 레거시 정리 | 공개 후 운영·후보 승인 우회 화면을 제거하고 `/admin/place-operations` 1~5단계로 통합했다. 기존 후보 경로는 권한 확인 후 1단계로 redirect한다. | 16파일, +89/-1,155로 레거시 UI를 크게 축소. 데이터 자체는 변경하지 않는다. | [PR #141](https://github.com/taejunyun1/Tasted_it/pull/141) · [`c27bead`](https://github.com/taejunyun1/Tasted_it/commit/c27bead) |
| 21:14 | 검수 파이프라인 UI | 원천 → NAVER → 카테고리 → 중복 → 선택 공개의 5단계 화면과 blocking overlay, 단계 탐색, 카드·툴바를 추가했다. 중복 미판정은 자동 공개하지 않는다. | 기존 NAVER 키·한도를 사용한다. 신규 공급자·binding·의존성 없음. | [PR #139](https://github.com/taejunyun1/Tasted_it/pull/139) · [`8e8a68c`](https://github.com/taejunyun1/Tasted_it/commit/8e8a68c) |
| 20:28 | 검수 파이프라인 기반 | 검수 작업·중복 결정·초기 backfill을 위한 `0034_place_review_pipeline.sql`, 5단계 게이트, 서버 페이지네이션과 작업 생성 로직을 추가했다. | 원격 D1에는 `0034` 적용 필요. rollback은 기존 migration 수정이 아니라 forward-fix를 사용한다. | [PR #137](https://github.com/taejunyun1/Tasted_it/pull/137) · [`a62af55`](https://github.com/taejunyun1/Tasted_it/commit/a62af55) |
| 19:48 | 설계 / 계획 | 648건 이상을 다루는 5단계 검수, 25건 일괄 처리, 동시 공개 claim, backfill·forward-fix·배포 게이트를 설계하고 구현을 3개 PR로 분리했다. | 문서 2파일만 추가. 이 PR 자체는 migration·NAVER 호출·배포를 실행하지 않았다. | [PR #136](https://github.com/taejunyun1/Tasted_it/pull/136) · [`82f602d`](https://github.com/taejunyun1/Tasted_it/commit/82f602d) |
| 19:23 | 모바일 지도 UX | 홈 추천 목록을 모바일 바텀 시트로 바꾸고 장소 선택 시 peek로 접으며 지도 중심·마커 선택을 동기화했다. 데스크톱 좌측 패널 구조는 유지한다. | DB·외부 서비스 변화 없음. 데스크톱/모바일 증거와 E2E를 추가했다. | [PR #134](https://github.com/taejunyun1/Tasted_it/pull/134) · [`47f1070`](https://github.com/taejunyun1/Tasted_it/commit/47f1070) |
| 16:26 | 관리자 IA | 긴 장소 운영 화면을 근거 감사, NAVER 검증, 영업 재검증, 장소 제안, 정보 정정, 중복·이력 탭으로 분리하고 URL에 탭 상태를 보존한다. | migration·외부 호출·설정 변화 없음. | [PR #133](https://github.com/taejunyun1/Tasted_it/pull/133) · [`f916feb`](https://github.com/taejunyun1/Tasted_it/commit/f916feb) |
| 16:16 | NAVER / 중복 운영 | 앱 내부 NAVER 일일 상한을 200에서 20,000으로 높이고 사용량을 표시한다. 프랜차이즈를 제외하고 동일 정규화 상호와 동일 주소 또는 100m 이내인 장소만 관리자 확인으로 병합한다. | `wrangler.jsonc` 기본값이 20,000으로 변경. 배포만으로 자동 병합되지는 않으며 관리자 작업이 필요하다. | [PR #131](https://github.com/taejunyun1/Tasted_it/pull/131) · [`80f6270`](https://github.com/taejunyun1/Tasted_it/commit/80f6270) |
| 15:58 | 장소 제안 UX | 공통 input CSS 충돌을 피하도록 주소 라디오를 카드 버튼으로 바꾸고, 주소 변경 시 이전 위치 확정을 해제한다. | 저장 구조·외부 API 호출 방식 변화 없음. | [PR #129](https://github.com/taejunyun1/Tasted_it/pull/129) · [`1f3bec3`](https://github.com/taejunyun1/Tasted_it/commit/1f3bec3) |
| 15:46 | NAVER / 공개 회수 | 상호·주소/100m·구체 카테고리가 모두 확인된 후보만 자동 분류한다. 공개 장소 회수는 `PUBLISHED`를 `HIDDEN`으로 바꾸고 실행시각 감사 로그로 같은 실행만 복구한다. | `0033_naver_place_liveness.sql` 필요. NAVER 일일 한도 공유, 화면 실행 최대 25곳. | [PR #127](https://github.com/taejunyun1/Tasted_it/pull/127) · [`201da3f`](https://github.com/taejunyun1/Tasted_it/commit/201da3f) |
| 15:03 | 관리자 카테고리 UX | 긴 기본 select를 blocking 모달/모바일 시트로 바꾸고 선택한 최대 25개 후보에 같은 카테고리를 일괄 적용한다. | 기존 승인 action 형식을 유지해 서버·DB 계약 변화 없음. | [PR #126](https://github.com/taejunyun1/Tasted_it/pull/126) · [`c729ee0`](https://github.com/taejunyun1/Tasted_it/commit/c729ee0) |
| 14:03 | 외부 근거 / 운영 전환 | Workers AI binding·실행 경로·사용량 UI를 제거하고 NAVER API HUB 기반 근거 워크벤치로 전환했다. 동기화/관리자 선택은 실행당 최대 25곳이며 응답 원문·장소 ID·사진·리뷰를 저장하지 않는다. | `0031_remove_workers_ai.sql`은 AI 실행 이력을 삭제하는 파괴 migration이다. `NAVER_API_HUB_KEY_ID/KEY`와 원격 적용·배포 절차가 필요하며 실제 실행 완료는 이 문서에서 미확인이다. | [PR #125](https://github.com/taejunyun1/Tasted_it/pull/125) · [`f8613c1`](https://github.com/taejunyun1/Tasted_it/commit/f8613c1) |
| 13:29 | 분류 v5 / 코스 v2 | 제외 → 구체 업태 → 일반 fallback → 신뢰/수동 검토를 병행 저장하는 분류 v5와 KST 시간대·영업시간·메뉴 궁합 기반 코스 v2를 추가했다. | `0031_place_category_v5_profiles.sql`, `0032_place_course_context.sql` 필요. 두 기능 플래그 기본값은 `false`; 공개 일괄 변경 없음. | [PR #122](https://github.com/taejunyun1/Tasted_it/pull/122) · [`dc2005e`](https://github.com/taejunyun1/Tasted_it/commit/dc2005e) |
| 11:44 | NAVER / 활성화 안전 | NAVER 지역검색 플래그를 운영 활성화하고, 꺼진 상태에서는 100건 개별 실패를 만들지 않고 배치 전체를 중단하도록 했다. | 당시 일일 상한은 200이었으며 #131에서 20,000으로 변경됐다. 원문 응답·provider ID는 저장하지 않는다. | [PR #121](https://github.com/taejunyun1/Tasted_it/pull/121) · [`dcf7b42`](https://github.com/taejunyun1/Tasted_it/commit/dcf7b42) |
| 03:15 | 관리자 QA | 비활성 NAVER 상태를 실행 전에 차단해 정확한 안내를 보여주고, 최근 발행 날짜를 KST로 고정해 SSR 수화 불일치를 제거했다. | 데이터·실제 NAVER 호출·flag 변경 없음. | [PR #119](https://github.com/taejunyun1/Tasted_it/pull/119) · [`fe5be20`](https://github.com/taejunyun1/Tasted_it/commit/fe5be20) |
| 02:48 | NAVER 카테고리 검증 | 상호와 정규화 주소 또는 100m 좌표 일치를 요구하는 NAVER Local Search 검증, 최소 결과 저장, 관리자 preview/apply, 공개 장소 재분류를 추가했다. | `0030_naver_local_category_verification.sql`, NAVER secrets, `NAVER_LOCAL_SEARCH_ENABLED` kill switch가 추가됐다. 당시 안전 기본 상한은 200. | [PR #117](https://github.com/taejunyun1/Tasted_it/pull/117) · [`c0d707d`](https://github.com/taejunyun1/Tasted_it/commit/c0d707d) |
| 01:05 | 음식점 분류 | 원천 업태의 정종·대포집·소주방·포차 신호를 포차 카테고리로 우선하고, 구체 업태와 AI가 충돌하면 수동 검토로 보낸다. 관리자 최종 선택을 항상 허용한다. | 기존 분류·검수 로직과 테스트 변경. 신규 migration 없음. | [PR #116](https://github.com/taejunyun1/Tasted_it/pull/116) · [`e3593d5`](https://github.com/taejunyun1/Tasted_it/commit/e3593d5) |
| 01:03 | 주소 정규화 | `전남광주` 축약 주소를 광주광역시 주소로 정규화하고 지도 검색과 서버 승인에 같은 표준 주소를 사용한다. | 기존 승인 실패를 수정하며 migration·환경 변수·추가 외부 API 변화 없음. | [PR #114](https://github.com/taejunyun1/Tasted_it/pull/114) · [`3868d20`](https://github.com/taejunyun1/Tasted_it/commit/3868d20) |
| 00:06 | 운영 감사 | 평가·사진·Golden Pick·보존기간·추천 적격성을 bounded D1 snapshot으로 읽는 ADMIN 전용 감사 화면과 runbook을 추가했다. | 읽기 전용이며 이메일·전화·세션·원문 주소·R2 key·원문 JSON을 DTO/UI에 내보내지 않는다. migration·자동 수정 없음. | [PR #112](https://github.com/taejunyun1/Tasted_it/pull/112) · [`cdac614`](https://github.com/taejunyun1/Tasted_it/commit/cdac614) |

### 2026-08-14

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 22:42 | 추천 계층 | 홈·목록의 추천 적격성, 행동별 취향 가치, `DIRECT/ADJACENT/EXPLORATION` 관계를 공통 계층으로 분리했다. 기존 순서와 공개 `FAMILIAR` 응답은 유지했다. | 내부 리팩터링이며 DB·환경 변수·AI 호출 변화 없음. | [PR #111](https://github.com/taejunyun1/Tasted_it/pull/111) · [`56b05f2`](https://github.com/taejunyun1/Tasted_it/commit/56b05f2) |
| 21:53 | 사업 모델 감사 | 수익 준비도를 약 30/100으로 평가하고 첫 유료 후보를 수동 Revisit로 두는 고고도 플랜을 기록했다. | 문서 상태는 `PROPOSED`. 결제·PSP·캠페인 구현 또는 과금 승인이 아니다. | [PR #108](https://github.com/taejunyun1/Tasted_it/pull/108) · [`469dbdb`](https://github.com/taejunyun1/Tasted_it/commit/469dbdb) |
| 21:53 | 추천 계획 | x-algorithm 코드를 이식하지 않고 자격/점수 분리, 행동 가치, 취향 일치와 탐색 할인 패턴만 참조하는 계획을 추가했다. | 문서만 변경. Phoenix·벡터 검색·Queue·광고 blender는 HOLD. | [PR #107](https://github.com/taejunyun1/Tasted_it/pull/107) · [`c6282f9`](https://github.com/taejunyun1/Tasted_it/commit/c6282f9) |
| 20:40 | 음식점 분류 / 일괄 적용 | 식육·숯불구이를 `고기·구이`로 우선 재분류하고 확실한 비음식 업종을 자동 제외한다. 공개 장소 100곳씩 preview/apply하고 관리자가 복원할 수 있다. | `0029_auto_not_restaurant_exclusion.sql` 필요. 카테고리와 제외 결과는 감사 이력으로 추적한다. | [PR #110](https://github.com/taejunyun1/Tasted_it/pull/110) · [`e254970`](https://github.com/taejunyun1/Tasted_it/commit/e254970) |

## Migration·설정·외부 연동 변동 인벤토리

### D1 migration

| 파일 | 도입 PR | 목적 | 운영 주의 |
| --- | --- | --- | --- |
| `0029_auto_not_restaurant_exclusion.sql` | [#110](https://github.com/taejunyun1/Tasted_it/pull/110) | 자동 비음식점 제외·분류 적용 기반 | 적용 후 관리자 preview/apply가 별도로 필요 |
| `0030_naver_local_category_verification.sql` | [#117](https://github.com/taejunyun1/Tasted_it/pull/117) | NAVER 카테고리 최소 검증 결과 저장 | secrets·kill switch·quota 확인 필요 |
| `0031_place_category_v5_profiles.sql` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | 분류 v5 shadow 프로필 | `PLACE_CATEGORY_V5_ENABLED=false` 기본 |
| `0031_remove_workers_ai.sql` | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | Workers AI 실행 이력 제거 | 파괴 변경. 백업·승인·정확한 적용 순서 확인 필요 |
| `0032_place_course_context.sql` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | 코스 추천 v2 컨텍스트 | `COURSE_CONTEXT_V2_ENABLED=false` 기본 |
| `0033_naver_place_liveness.sql` | [#127](https://github.com/taejunyun1/Tasted_it/pull/127) | NAVER 공개 장소 재검증·회수 이력 | 같은 실행시각 감사 로그로만 복구 |
| `0034_place_review_pipeline.sql` | [#137](https://github.com/taejunyun1/Tasted_it/pull/137) | 5단계 검수 작업·중복 결정·backfill | 기존 migration 수정 금지, 문제는 forward-fix |

`0031` 접두사가 두 파일에 중복된 것이 현재 `main`의 사실이다. 이 문서는 원격 적용 순서나 적용 완료를 추정하지 않는다. 운영 전에는 정확한 파일명과 `wrangler d1 migrations list` 결과, 병합 PR의 승인 범위를 대조해야 한다.

### 런타임 설정과 공급자

| 항목 | 최종 확인값 / 상태 | 변경 근거 | 주의 |
| --- | --- | --- | --- |
| `NAVER_LOCAL_SEARCH_ENABLED` | `true` in `wrangler.jsonc` | [#121](https://github.com/taejunyun1/Tasted_it/pull/121) | 장애 시 `false`로 중단 후 재배포 |
| `NAVER_LOCAL_SEARCH_DAILY_LIMIT` | `20000` in `wrangler.jsonc` | [#131](https://github.com/taejunyun1/Tasted_it/pull/131) | API Hub 전체 사용량과 앱 기록 사용량은 다를 수 있음 |
| `NAVER_API_HUB_KEY_ID`, `NAVER_API_HUB_KEY` | Worker secrets 필요 | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | 값은 문서·로그·PR에 노출 금지 |
| Workers AI binding | 제거 | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | `0031_remove_workers_ai.sql`의 원격 적용 여부 별도 확인 |
| `PLACE_CATEGORY_V5_ENABLED` | `false` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | shadow 검수 전 공개 변경 금지 |
| `COURSE_CONTEXT_V2_ENABLED` | `false` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | off이면 기존 코스 추천 유지 |

## 갱신 절차

### 변경 PR 작성자

1. Issue 또는 Draft PR에 담당자, 범위, 소유 파일을 먼저 기록한다.
2. Draft PR 번호를 확보한 뒤 이 문서의 최신 날짜 아래에 항목을 추가한다.
3. 변경 이유, 사용자/운영 영향, migration·환경 변수·외부 연동, 검증, rollback, PR 링크를 빠짐없이 적는다.
4. 같은 날의 후속 수정은 별도 행으로 남기고, 무엇을 대체하거나 보완했는지 명시한다.
5. 독립 이력 가치가 없는 변경은 PR 템플릿에 미기록 사유를 적는다.

### 기준 커밋 정합성 확인

```bash
git fetch origin
git rev-parse origin/main
git log --first-parent --date=iso-local --format='%h %ad %s' <기록된-커밋>..origin/main
git diff --stat <기록된-커밋>..origin/main
gh pr list --repo taejunyun1/Tasted_it --state merged --base main --limit 100
```

누락이 없을 때만 `마지막 확인`, `확인한 원격 기준`, 기준선 통계를 갱신한다. GitHub API나 로컬 원격 참조를 확인하지 못했으면 `HOLD / UNVERIFIED`로 기록하고 기준 커밋을 전진시키지 않는다.

## 읽는 법과 제한

- **코드가 실제로 존재하는가?** `origin/main` 커밋과 파일을 확인한다.
- **무엇이 승인됐는가?** 링크된 병합 PR의 본문과 승인 SSOT를 확인한다.
- **원격 migration·배포가 실행됐는가?** PR의 운영 댓글, Cloudflare/D1 증거 또는 별도 운영 기록을 확인한다.
- **이 문서가 최신인가?** 기록된 SHA와 현재 `origin/main`을 비교한다.
- **로컬 `worklog/`과 다른가?** `worklog/`는 로컬 실행 참고 기록이므로 저장소 이력은 이 문서와 원본 Git/PR을 따른다.

---

# Re:Taste `main` Change History SSOT

- **Document role:** SSOT for discovering, summarizing, and tracing changes on `main`
- **Status:** ACCEPTED when [PR #157](https://github.com/taejunyun1/Tasted_it/pull/157) is merged
- **Last verified:** 2026-08-17 01:37 KST
- **Verified remote baseline:** [`562d5f4`](https://github.com/taejunyun1/Tasted_it/commit/562d5f42ec2cd765f0df6617b887aeee9f9664b2)
- **Baseline range:** after [`b44b8f5`](https://github.com/taejunyun1/Tasted_it/commit/b44b8f5b621771717dc4b4fa71d5feb46934df41), through `562d5f4`
- **Source repository:** [`taejunyun1/Tasted_it`](https://github.com/taejunyun1/Tasted_it)

This is the official index for understanding what entered remote `main`, why it changed, and what it affected. `origin/main` is authoritative for current files, merged Pull Requests are authoritative for approval and operational scope, and this document is authoritative for navigating changes across them. See the [SSOT decision](./decisions/2026-08-16-main-change-history-ssot.md) for the full boundary.

> **Accuracy rule:** If the recorded baseline differs from current `origin/main`, do not treat this document as current. Reconcile missing commits and merged PRs first. This document alone never proves that a deployment, remote D1 migration, production-data operation, or external API call was executed.

## Changes Registered After the Baseline

| Status | Change and impact | Evidence |
| --- | --- | --- |
| Ready / CI PASS | Introduces the history SSOT, authority boundary, and PR template; reconciles the NAVER limit explanation in README and the operations runbook. It changes no product code, migration, or runtime setting. #159 fixed the pre-existing typecheck failure, and local typecheck, full unit tests, build, and PR CI all pass on the updated baseline. Record the squash SHA during the next baseline reconciliation. | [Issue #156](https://github.com/taejunyun1/Tasted_it/issues/156) · [PR #157](https://github.com/taejunyun1/Tasted_it/pull/157) · [Issue #158](https://github.com/taejunyun1/Tasted_it/issues/158) · [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159) · [PR CI](https://github.com/taejunyun1/Tasted_it/actions/runs/31959115738) |

## Baseline Summary

| Item | Value |
| --- | --- |
| Period | 2026-08-14 20:40 KST to 2026-08-17 01:31 KST |
| Merged PRs / `main` commits | 31 / 31 |
| Net change | 197 files, +15,001 / -1,742 lines |
| Cumulative per-commit change | +15,917 / -2,658 lines |
| New migrations | 7 files: `0029`, `0030`, two `0031` files, `0032`, `0033`, `0034` |
| Major areas | restaurant classification, recommendation layers, NAVER evidence, place-review pipeline, operations audit, map/admin UX |
| Production execution evidence | Not verified here; inspect each PR and separate operations records |

### Current Verification Status

- The previous `5b56dd3` [push CI run 31946826546](https://github.com/taejunyun1/Tasted_it/actions/runs/31946826546) and the pre-sync [PR #157 CI](https://github.com/taejunyun1/Tasted_it/actions/runs/31951020332) failed on the same `TS2339` at `PlaceReviewPipeline.tsx:85`.
- [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159) removed access to idle fetcher `formData` and validates a response ID for each sequential request. The [push CI run 31958857659](https://github.com/taejunyun1/Tasted_it/actions/runs/31958857659) for current `origin/main` `562d5f4` passes typecheck and the full unit suite.
- The current baseline and the latest [PR #157 CI run 31959115738](https://github.com/taejunyun1/Tasted_it/actions/runs/31959115738) both have **PASS** status. PR #157 incorporates `562d5f4` and is now **Ready** for merge review.

### Major Changes

1. **Classification and recommendation contracts:** added automatic non-food exclusion and restoration, recommendation eligibility/action-value layers, category v5, and course recommendation v2.
2. **External evidence transition:** removed Workers AI execution and moved to a NAVER API HUB evidence workbench with quotas, minimal persistence, and kill switches.
3. **Stronger pre-publication review:** added a server-enforced five-step pipeline from public source through NAVER, category, duplicate review, and explicit publication; consolidated legacy bypass screens.
4. **Operational safety:** added read-only integrated audit, publication recall/restore history, sequential ten-item NAVER verification, and in-screen error handling.
5. **User and admin UX:** added a mobile recommendation-map bottom sheet, place-location cards, category modal/batch apply, and operations tabs.

## Detailed History

All timestamps use `Asia/Seoul`. `+/-` values are GitHub squash-commit statistics; binary size changes are not represented as lines.

### 2026-08-17

| Time | Area | Change and rationale | Data/operations impact | Evidence |
| --- | --- | --- | --- | --- |
| 01:31 | NAVER / CI stabilization | Removed the type error caused by reading unavailable `formData` while a React Router v8 fetcher is idle. Each sequential request now has a unique ID and only a matching response is applied, preventing delayed cross-request consumption. | Three code/test files, +15/-4. No route-action, DB, migration, environment, dependency, deployment, or real NAVER-call change. | [Issue #158](https://github.com/taejunyun1/Tasted_it/issues/158) · [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159) · [`562d5f4`](https://github.com/taejunyun1/Tasted_it/commit/562d5f42ec2cd765f0df6617b887aeee9f9664b2) |

### 2026-08-16

| Time | Area | Change and rationale | Data/operations impact | Evidence |
| --- | --- | --- | --- | --- |
| 21:21 | Stabilization / CI | Fixed the targeted `autoWorkItem` `unknown[]` inference in `admin-place-operations`. Current `main` CI still fails on a separate `PlaceReviewPipeline.tsx:85` error, so this is not treated as full typecheck recovery. | One code file, +8/-1. No data, API, or configuration change. The remaining CI failure is tracked in [#158](https://github.com/taejunyun1/Tasted_it/issues/158). | [PR #155](https://github.com/taejunyun1/Tasted_it/pull/155) · [`5b56dd3`](https://github.com/taejunyun1/Tasted_it/commit/5b56dd321c85619b347518fd23ec13e1ed45ad16) |
| 21:04 | NAVER / Review | Split up to ten checks into sequential single-item operations, separated manual and automatic flows, and applied verified NAVER category mappings to review work. | Seven code/test files, +164/-18. Reuses existing NAVER boundaries; no migration. | [PR #154](https://github.com/taejunyun1/Tasted_it/pull/154) · [`c171382`](https://github.com/taejunyun1/Tasted_it/commit/c171382) |
| 07:42 | NAVER / Review UX | Allows selecting 25 places while processing only the first ten, preserves the remaining selection, and requires a manual transition after reviewing results. | At most ten external calls per request. No new secret, migration, or bulk data change. | [PR #152](https://github.com/taejunyun1/Tasted_it/pull/152) · [`1b34d2e`](https://github.com/taejunyun1/Tasted_it/commit/1b34d2e) |
| 07:28 | NAVER / Performance | Fixed both UI and server limits at ten and added a contract test to reduce Worker 1102 CPU exhaustion. | Keeps the 20,000 daily cap; only per-request throughput changed. Async queue remains the fallback if 1102 recurs. | [PR #151](https://github.com/taejunyun1/Tasted_it/pull/151) · [`9d3bf10`](https://github.com/taejunyun1/Tasted_it/commit/9d3bf10) |

### 2026-08-15

| Time | Area | Change and rationale | Data/operations impact | Evidence |
| --- | --- | --- | --- | --- |
| 22:47 | Admin error handling | Returns automatic non-food exclusion failures inside the current screen instead of an error page. | Two code/test files, +13/-2. No DB or external API change. | [PR #149](https://github.com/taejunyun1/Tasted_it/pull/149) · [`22899fd`](https://github.com/taejunyun1/Tasted_it/commit/22899fd) |
| 22:39 | NAVER / Transition | Removed the immediate server redirect, kept results visible, and moved to step 3 safely on the client, correcting #145. | No migration, production-data change, or extra NAVER call. | [PR #147](https://github.com/taejunyun1/Tasted_it/pull/147) · [`d208921`](https://github.com/taejunyun1/Tasted_it/commit/d208921) |
| 22:29 | NAVER / Transition | Moved successful verification to category step 3, reset pagination, and preserved filters. | UI flow and regression tests only; later refined by #147 and #152. | [PR #145](https://github.com/taejunyun1/Tasted_it/pull/145) · [`9af4788`](https://github.com/taejunyun1/Tasted_it/commit/9af4788) |
| 22:11 | Source review / Exclusion | Unified page selection as a toggle and records only clear non-food venues as `EXCLUDED/AUTO_NON_FOOD`, without deleting sources, places, or public state. | Adds auditable, restorable exclusion using existing paths; no migration or external call. | [PR #143](https://github.com/taejunyun1/Tasted_it/pull/143) · [`4a107dc`](https://github.com/taejunyun1/Tasted_it/commit/4a107dc) |
| 21:35 | Admin IA / Legacy | Consolidated post-publication operations and candidate approval into `/admin/place-operations` steps 1–5; old candidate routes now redirect after auth. | 16 files, +89/-1,155, removing substantial legacy UI without changing data. | [PR #141](https://github.com/taejunyun1/Tasted_it/pull/141) · [`c27bead`](https://github.com/taejunyun1/Tasted_it/commit/c27bead) |
| 21:14 | Review pipeline UI | Added the source → NAVER → category → duplicate → selected-publication UI, blocking overlay, navigation, cards, and toolbar; undecided duplicates cannot auto-publish. | Uses existing NAVER keys and limits; no new provider, binding, or dependency. | [PR #139](https://github.com/taejunyun1/Tasted_it/pull/139) · [`8e8a68c`](https://github.com/taejunyun1/Tasted_it/commit/8e8a68c) |
| 20:28 | Review pipeline foundation | Added `0034_place_review_pipeline.sql`, stage gates, database pagination, work-item creation, duplicate decisions, and initial backfill. | Remote D1 requires `0034`; use forward-fix rather than editing the migration. | [PR #137](https://github.com/taejunyun1/Tasted_it/pull/137) · [`a62af55`](https://github.com/taejunyun1/Tasted_it/commit/a62af55) |
| 19:48 | Design / Plan | Designed the five-stage pipeline for 648+ rows, 25-item batches, concurrent publication claims, backfill, forward-fix, and deployment gates. | Two documentation files only; no migration, NAVER call, or deploy executed by this PR. | [PR #136](https://github.com/taejunyun1/Tasted_it/pull/136) · [`82f602d`](https://github.com/taejunyun1/Tasted_it/commit/82f602d) |
| 19:23 | Mobile map UX | Replaced the mobile recommendation list with a bottom sheet; selection collapses it to peek and synchronizes map center and marker. Desktop layout remains. | No DB or provider change; adds desktop/mobile evidence and E2E. | [PR #134](https://github.com/taejunyun1/Tasted_it/pull/134) · [`47f1070`](https://github.com/taejunyun1/Tasted_it/commit/47f1070) |
| 16:26 | Admin IA | Split the long operations page into audit, NAVER, liveness, suggestion, correction, and duplicate/history tabs with URL state. | No migration, external call, or configuration change. | [PR #133](https://github.com/taejunyun1/Tasted_it/pull/133) · [`f916feb`](https://github.com/taejunyun1/Tasted_it/commit/f916feb) |
| 16:16 | NAVER / Duplicate ops | Raised the internal daily limit from 200 to 20,000 and added admin-reviewed merging only for non-franchises with normalized same name plus same address or 100m proximity. | `wrangler.jsonc` now uses 20,000. Deploy does not merge anything automatically. | [PR #131](https://github.com/taejunyun1/Tasted_it/pull/131) · [`80f6270`](https://github.com/taejunyun1/Tasted_it/commit/80f6270) |
| 15:58 | Place suggestion UX | Replaced radio inputs with card buttons to avoid shared-input CSS conflicts and clears confirmation when the address changes. | No storage or external-call contract change. | [PR #129](https://github.com/taejunyun1/Tasted_it/pull/129) · [`1f3bec3`](https://github.com/taejunyun1/Tasted_it/commit/1f3bec3) |
| 15:46 | NAVER / Publication recall | Auto-classifies only when name, address/100m, and concrete category agree; recalls `PUBLISHED` to `HIDDEN` and restores only the matching run timestamp. | Requires `0033_naver_place_liveness.sql`; shares the NAVER daily quota and caps a screen run at 25. | [PR #127](https://github.com/taejunyun1/Tasted_it/pull/127) · [`201da3f`](https://github.com/taejunyun1/Tasted_it/commit/201da3f) |
| 15:03 | Admin category UX | Replaced the long select with a blocking modal/mobile sheet and applies one category to up to 25 selected candidates. | Keeps the existing action payload and server/DB contract. | [PR #126](https://github.com/taejunyun1/Tasted_it/pull/126) · [`c729ee0`](https://github.com/taejunyun1/Tasted_it/commit/c729ee0) |
| 14:03 | External evidence / Ops | Removed Workers AI binding/execution/usage UI and moved to a NAVER API HUB evidence workbench with 25-item runs and minimal persistence. | `0031_remove_workers_ai.sql` destructively removes AI run history. Requires API HUB secrets and separately verified remote execution. | [PR #125](https://github.com/taejunyun1/Tasted_it/pull/125) · [`f8613c1`](https://github.com/taejunyun1/Tasted_it/commit/f8613c1) |
| 13:29 | Category v5 / Course v2 | Added exclusion → concrete source → general fallback → confidence/manual-review category v5 and KST/hour/menu compatibility course v2. | Requires `0031_place_category_v5_profiles.sql` and `0032_place_course_context.sql`; both flags default to `false`. | [PR #122](https://github.com/taejunyun1/Tasted_it/pull/122) · [`dc2005e`](https://github.com/taejunyun1/Tasted_it/commit/dc2005e) |
| 11:44 | NAVER / Safe enablement | Enabled regional search in production configuration and stops the whole batch safely when disabled rather than recording 100 failures. | The cap was 200 at this point and was superseded by #131. Raw responses and provider IDs remain unstored. | [PR #121](https://github.com/taejunyun1/Tasted_it/pull/121) · [`dcf7b42`](https://github.com/taejunyun1/Tasted_it/commit/dcf7b42) |
| 03:15 | Admin QA | Blocks a disabled NAVER run before execution with precise guidance and fixes recent-publication dates to KST to avoid hydration mismatches. | No data, real NAVER call, or flag change. | [PR #119](https://github.com/taejunyun1/Tasted_it/pull/119) · [`fe5be20`](https://github.com/taejunyun1/Tasted_it/commit/fe5be20) |
| 02:48 | NAVER category evidence | Added Local Search matching by name plus normalized address or 100m, minimal evidence storage, admin preview/apply, and published-place reclassification. | Added `0030_naver_local_category_verification.sql`, NAVER secrets, and a kill switch; initial safe cap was 200. | [PR #117](https://github.com/taejunyun1/Tasted_it/pull/117) · [`c0d707d`](https://github.com/taejunyun1/Tasted_it/commit/c0d707d) |
| 01:05 | Restaurant classification | Prioritizes source categories such as sake house, pub, and pocha; conflicts between concrete source and AI require manual review, while admin choice remains authoritative. | Existing classification/review code and tests only; no migration. | [PR #116](https://github.com/taejunyun1/Tasted_it/pull/116) · [`e3593d5`](https://github.com/taejunyun1/Tasted_it/commit/e3593d5) |
| 01:03 | Address normalization | Normalizes abbreviated `전남광주` addresses to Gwangju Metropolitan City and uses the same address for map search and server approval. | Fixes approval failures without migration, environment, or extra API changes. | [PR #114](https://github.com/taejunyun1/Tasted_it/pull/114) · [`3868d20`](https://github.com/taejunyun1/Tasted_it/commit/3868d20) |
| 00:06 | Operations audit | Added an ADMIN-only bounded D1 snapshot and runbook for ratings, photos, Golden Pick, retention, and recommendation eligibility. | Read-only; excludes email, phone, sessions, raw address, R2 keys, and raw JSON. No migration or automatic repair. | [PR #112](https://github.com/taejunyun1/Tasted_it/pull/112) · [`cdac614`](https://github.com/taejunyun1/Tasted_it/commit/cdac614) |

### 2026-08-14

| Time | Area | Change and rationale | Data/operations impact | Evidence |
| --- | --- | --- | --- | --- |
| 22:42 | Recommendation layers | Shared recommendation eligibility, action values, and `DIRECT/ADJACENT/EXPLORATION` relations across home and lists while retaining existing order and public `FAMILIAR` output. | Internal refactor only; no DB, environment, or AI-call change. | [PR #111](https://github.com/taejunyun1/Tasted_it/pull/111) · [`56b05f2`](https://github.com/taejunyun1/Tasted_it/commit/56b05f2) |
| 21:53 | Business-model audit | Assessed monetization readiness at roughly 30/100 and proposed manual Revisit as the first paid candidate. | Document remains `PROPOSED`; it does not approve payments, PSP, campaigns, or public billing. | [PR #108](https://github.com/taejunyun1/Tasted_it/pull/108) · [`469dbdb`](https://github.com/taejunyun1/Tasted_it/commit/469dbdb) |
| 21:53 | Recommendation plan | Added a plan that references only eligibility/scoring separation, action values, taste match, and exploration discounts from x-algorithm without porting its code. | Documentation only; Phoenix, vector search, Queue, and ad blender remain HOLD. | [PR #107](https://github.com/taejunyun1/Tasted_it/pull/107) · [`c6282f9`](https://github.com/taejunyun1/Tasted_it/commit/c6282f9) |
| 20:40 | Classification / Batch apply | Prioritizes meat/charcoal source categories as grilled meat, auto-excludes clear non-food venues, and adds 100-place preview/apply with admin restoration. | Requires `0029_auto_not_restaurant_exclusion.sql`; category and exclusion changes are audited. | [PR #110](https://github.com/taejunyun1/Tasted_it/pull/110) · [`e254970`](https://github.com/taejunyun1/Tasted_it/commit/e254970) |

## Migration, Configuration, and Provider Inventory

### D1 migrations

| File | Introduced by | Purpose | Operational note |
| --- | --- | --- | --- |
| `0029_auto_not_restaurant_exclusion.sql` | [#110](https://github.com/taejunyun1/Tasted_it/pull/110) | Automatic non-food exclusion and category-application foundation | Admin preview/apply remains a separate action |
| `0030_naver_local_category_verification.sql` | [#117](https://github.com/taejunyun1/Tasted_it/pull/117) | Minimal NAVER category evidence | Verify secrets, kill switch, and quota |
| `0031_place_category_v5_profiles.sql` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | Category v5 shadow profiles | `PLACE_CATEGORY_V5_ENABLED=false` by default |
| `0031_remove_workers_ai.sql` | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | Remove Workers AI run history | Destructive; verify backup, approval, and exact order |
| `0032_place_course_context.sql` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | Course recommendation v2 context | `COURSE_CONTEXT_V2_ENABLED=false` by default |
| `0033_naver_place_liveness.sql` | [#127](https://github.com/taejunyun1/Tasted_it/pull/127) | NAVER re-verification and recall history | Restore only the matching run timestamp |
| `0034_place_review_pipeline.sql` | [#137](https://github.com/taejunyun1/Tasted_it/pull/137) | Five-stage work items, duplicate decisions, backfill | Never edit; use a forward-fix |

Two files currently share the `0031` prefix on `main`. This document does not infer remote execution order or completion. Before operations, compare exact filenames, `wrangler d1 migrations list`, and the merged PR approval scope.

### Runtime configuration and providers

| Item | Last verified value/state | Evidence | Note |
| --- | --- | --- | --- |
| `NAVER_LOCAL_SEARCH_ENABLED` | `true` in `wrangler.jsonc` | [#121](https://github.com/taejunyun1/Tasted_it/pull/121) | Set `false` and redeploy to stop on incident |
| `NAVER_LOCAL_SEARCH_DAILY_LIMIT` | `20000` in `wrangler.jsonc` | [#131](https://github.com/taejunyun1/Tasted_it/pull/131) | API Hub total usage may differ from app-recorded usage |
| `NAVER_API_HUB_KEY_ID`, `NAVER_API_HUB_KEY` | Worker secrets required | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | Never expose values in docs, logs, or PRs |
| Workers AI binding | Removed | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | Verify remote `0031_remove_workers_ai.sql` separately |
| `PLACE_CATEGORY_V5_ENABLED` | `false` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | No public change before shadow review |
| `COURSE_CONTEXT_V2_ENABLED` | `false` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | Off retains the previous course recommendation |

## Update Procedure

### Pull Request author

1. Record the owner, scope, and owned files in an Issue or Draft PR first.
2. Obtain the Draft PR number and add an entry under the latest date in this document.
3. Include rationale, user/operational impact, migrations, environment variables, external integrations, verification, rollback, and the PR link.
4. Keep follow-up fixes as separate rows and say what they supersede or refine.
5. For a change with no independent historical value, explain the omission in the PR template.

### Baseline reconciliation

```bash
git fetch origin
git rev-parse origin/main
git log --first-parent --date=iso-local --format='%h %ad %s' <recorded-commit>..origin/main
git diff --stat <recorded-commit>..origin/main
gh pr list --repo taejunyun1/Tasted_it --state merged --base main --limit 100
```

Advance the baseline only after confirming that no merged PR is missing. If GitHub or the remote ref cannot be verified, record `HOLD / UNVERIFIED` and do not advance it.

## How to Read This Document

- **Does the code exist?** Inspect the `origin/main` commit and file.
- **What was approved?** Read the linked merged PR and the approval SSOT.
- **Was a remote migration or deployment executed?** Inspect PR operations comments, Cloudflare/D1 evidence, or a separate operations record.
- **Is this current?** Compare the recorded SHA with current `origin/main`.
- **What if local `worklog/` differs?** `worklog/` is local reference evidence; repository history follows this index and the underlying Git/PR sources.
