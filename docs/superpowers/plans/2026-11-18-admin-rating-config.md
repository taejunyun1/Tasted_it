# B15 평가 설정 실효 조회·합성 비교 구현 계획

> 담당: Jay/Codex, Issue #452. 기존 B15 설계와 DEC-03의 읽기·합성 비교 단위를 구현한다. 사용자가 요청한 연속 구현 방식으로 진행하며 별도 활성화 승인을 만들지 않는다.

**목표:** 코드의 점수 산식, 실제 DB 소비 필드, 선택된 메타데이터를 구분하고 합성 표본에서만 변경안을 비교한다.
**구조:** 현재 rating-v2.0 계산의 고정 정책을 공유하고 같은 계산 경로에 엄격한 합성 후보를 넣는다. ADMIN GET은 설정 최대50건만 읽고 원시표·점수·job을 쓰지 않는다.
**스택:** 기존 React Router/Drizzle/D1/Zod/Vitest/Playwright. migration·의존성·외부 호출 추가 없음.
**기준:** `docs/plans/2026-11-14-admin-control-plane.md` B15, `docs/decisions/2026-11-13-cst-implementation-policy.md` DEC-03.

## 경계

- 최소8·Beta(2,2)·리뷰어30% 및 신뢰/유사도 현행 출력 보존.
- DB minimumVisibleSamples는 신뢰 비교 gate에 사용되므로 모든 DB값을 미적용이라고 부르지 않는다.
- 후보값은 합성 계산의 입력 제한 안에서만 허용한다. 정책 승인·설정 저장·실제 영향 예측으로 표시하지 않는다.
- 현재 getter와 SQL CAS/trigger의 미래 날짜 선택 문제는 전체 경계를 함께 고쳐야 하므로 이 조회 단위에서 부분 변경하지 않는다. 선택된 미래/미지원 메타데이터를 경고한다. 설정 활성화/복원은 정책 필요 상태로 남긴다.
- #397 HOLD, 실제 recompute/원시표/snapshot 쓰기0, 운영 API/메일0.

## 필수 검토

미래/종료/알 수 없는 버전과 DB소비 차이, 악성/과대/중복 query, 7/8표 공개경계·리뷰어 상한, 권한·private/no-store, 합성 계산 후 실제 데이터 무변경을 확인한다.

### 1. 합성 계산

- [x] `rating-v2.ts`의 현행 정책을 export하고 런타임 진입은 고정한다.
- [x] `rating-config-preview.ts`에 strict 8필드/총400표 입력과 현재/후보 비교를 추가한다.
- [x] 새 unit시험이 실패하는 것을 확인 후 구현하고 기존 rating-v2 시험과 함께 통과시킨다.

### 2. 읽기 서비스·ADMIN

- [x] `admin-rating-config.server.ts`에서 최대50건·선택상태·실효 필드별 소비를 제공한다. JSON 원문은 반환하지 않는다.
- [x] `/admin/rating-config`의 ADMIN GET/no-store와 합성 query를 구현한다. POST405, 활성화 버튼 없음.
- [x] registry A15 및 평가 운영 화면에 연결하고 잘못된 ‘DB최소표=점수공개’ 표기를 바로잡는다.
- [x] Workers D1 통합시험으로 권한/미래선택경고/DB필드소비/입력거절/무변경을 검증한다.

### 3. 검증·인계

- [x] 변경 unit/integration·typecheck/build, 로컬 fake 기반 desktop/mobile/320px·키보드 검증.
- [x] diff/비밀값·audit 확인 후 전용 브랜치를 push/PR. 부모가 병합·배포·SSOT/위키 및 live RSI를 담당한다. (기능검증 완료, 커밋/PR 인계 후 부모 진행)
