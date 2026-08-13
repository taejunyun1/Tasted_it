# 장소 영업 실재성 자동검증 인수인계

- 작성일: 2026-08-13
- 상태: 사용자 요청으로 Task 4 구현 검수 전 중단
- 브랜치: `codex/tj_place-liveness-verification`
- worktree: `/Users/jaysong/Documents/tastedit-tj_place-liveness-verification`
- 원격: `origin` = `https://github.com/taejunyun1/Tasted_it.git`
- 기준 브랜치: `origin/main`
- 최신 원격 반영 커밋: `2b487f3`
- PR: 아직 생성하지 않음

## 다음 CLI의 첫 원칙

계속하기 전에 반드시 다음 파일을 다시 읽는다.

- `/Users/jaysong/Documents/tastedit-tj_place-liveness-verification/AGENTS.md`
- `/Users/jaysong/Documents/tastedit-tj_place-liveness-verification/COWORK.md`
- `/Users/jaysong/Documents/tastedit-tj_place-liveness-verification/docs/superpowers/specs/2026-08-12-place-liveness-verification-design.md`
- `/Users/jaysong/Documents/tastedit-tj_place-liveness-verification/docs/superpowers/plans/2026-08-12-place-liveness-verification.md`
- `/Users/jaysong/Documents/tastedit-tj_place-liveness-verification/.superpowers/sdd/2026-08-12-place-liveness-verification/progress.md`

`COWORK.md`를 읽을 수 없으면 구현을 시작하지 않는다. `jay_` 계열 브랜치나 다른 사람 worktree를 재사용하지 말고 현재 `tj`용 worktree/브랜치에서 이어간다.

## 확인된 저장소 상태

현재 GitHub 인증 계정은 `deximple`이고, `taejunyun1/Tasted_it`에 `WRITE` 권한이 있는 것으로 확인했다. 이 정보는 시간 의존적이므로 다음 CLI에서 `gh api user`와 `gh repo view`로 다시 확인한다.

PR #88, `codex/tj_food-venue-filter`, 는 `main`에 병합되어 있다. `라이브카페` 등 비음식 유흥업소 필터는 이 브랜치 범위에 섞지 않는다.

이 브랜치는 `origin/main`의 `dff5699`에서 시작했다. 원래 사용자 메시지의 승인 문서 경로와 커밋 `5608191`은 이 머신에서 직접 확인되지 않아, 첨부 텍스트를 기반으로 승인된 설계와 계획 문서를 복원했다.

## 완료된 커밋

- `76532ac` `2026-08-12 장소 영업검증 승인 문서 복원`
  - 승인된 설계/계획 문서를 `docs/superpowers/specs`, `docs/superpowers/plans`에 복원.
- `bcc7ef7` `2026-08-12 장소 영업검증 스키마 추가`
- `7b176c6` `2026-08-13 장소 영업검증 migration 계약 보강`
  - Task 1 완료. `place_liveness_states` schema/migration과 migration 계약 테스트 보강. 독립 리뷰 재검수 통과.
- `396b8df` `2026-08-12 카카오 장소검증 어댑터 추가`
- `0f06e02` `2026-08-13 카카오 응답 본문 timeout 보완`
  - Task 2 완료. 서버 전용 Kakao Local adapter, mock 기반 unit test, Env/.dev.vars.example 추가. body JSON 파싱 timeout 문제 수정 후 리뷰 통과.
- `52295b9` `2026-08-12 장소 일치와 영업판정 규칙 구현`
- `2b487f3` `2026-08-13 Kakao ID 즉시 일치와 지점명 정규화 보완`
  - Task 3 완료. 순수 판정 함수와 거리 계산 export, duplicate policy test 보강. 동일 Kakao ID 즉시 일치와 no-space 지점명 정규화 수정 후 리뷰 통과.

원격 브랜치 `origin/codex/tj_place-liveness-verification`는 `2b487f3`까지 push되어 있다.

## 중단 시점

사용자가 주간 사용량 한도 때문에 "Task 시작 전까지만 하고 핸드오프 문서 작성"을 요청했다. Task 4 작업자가 이미 일부 파일을 만들었으나, 중단 지시에 따라 커밋/푸시 없이 멈췄다.

현재 untracked 파일:

- `/Users/jaysong/Documents/tastedit-tj_place-liveness-verification/app/features/places/place-liveness.server.ts`
- `/Users/jaysong/Documents/tastedit-tj_place-liveness-verification/tests/integration/place-liveness.server.test.ts`

이 두 파일은 Task 4의 부분 구현이다. 현재 상태를 완료로 간주하지 말고, 다음 CLI가 직접 코드 리뷰와 검증을 해야 한다. 작업자 보고 기준으로 focused integration test 234개, `pnpm run typecheck`, `git diff --check`는 통과했다고 했지만, controller가 독립 재실행하거나 리뷰하지 않았다.

## Task 4 이어받기

Task 4 목표:

- `claimDuePlaceLivenessTargets`
- `loadPlaceLivenessEvidence`
- `applyPlaceLivenessDecision`

위 세 함수를 `app/features/places/place-liveness.server.ts`에 구현하고, Workers/D1 통합 테스트를 `tests/integration/place-liveness.server.test.ts`에 둔다.

다음 CLI의 첫 실행 명령:

```bash
cd /Users/jaysong/Documents/tastedit-tj_place-liveness-verification
git status --short --branch
git fetch origin --prune
git log --oneline --decorate -10
sed -n '1,260p' AGENTS.md
sed -n '1,260p' COWORK.md
sed -n '1,260p' .superpowers/sdd/2026-08-12-place-liveness-verification/progress.md
sed -n '1,220p' .superpowers/sdd/2026-08-12-place-liveness-verification/task-4-brief.md
sed -n '1,380p' app/features/places/place-liveness.server.ts
sed -n '1,340p' tests/integration/place-liveness.server.test.ts
pnpm run test:integration -- tests/integration/place-liveness.server.test.ts
pnpm run typecheck
git diff --check
```

Task 4 검수 포인트:

- claim은 상태 행이 없는 오래된 `PUBLISHED` 장소도 한 번만 선점해야 한다.
- 동시 claim에서 같은 `placeId`가 두 호출에 동시에 나오면 안 된다.
- lease token 불일치 저장은 `STALE_LEASE`로 끝나야 하고 기존 상태를 덮어쓰면 안 된다.
- `loadPlaceLivenessEvidence`는 최근 90일 reviewer photo, vote, save와 연결 business license의 `normalized_status=OPEN`, `last_seen_at`만 비식별 집계해야 한다.
- `applyPlaceLivenessDecision`은 `HIDE`일 때만 `places.status`를 바꾸고, 자동 숨김의 `places`, `place_revisions`, `admin_audit_logs`, `place_revalidation_cases` 기록을 한 D1 `batch` 안에서 처리해야 한다.
- 중간 실패 시 부분 적용을 남기지 않는지 테스트로 확인한다.
- 2회 미검색 case는 중복 생성하지 않아야 한다.
- evidence/log에 회원 식별자, 요청 URL, 상호, 주소, 전화번호, 원본 provider body를 남기지 않는다.

부분 구현에서 특히 다시 볼 지점:

- `applyPlaceLivenessDecision`이 lease token 검증과 batch side effect를 과하게 복잡하게 처리했을 가능성이 있다. 단순하고 검증 가능한 조건부 update 흐름인지 확인한다.
- business license의 `OPEN` 집계가 설계의 120일 보호 조건과 어떻게 연결되는지 확인한다. 순수 함수는 `recentOpenSourceAt`을 받아 120일 조건을 판단하므로, 서비스가 오래된 OPEN을 그대로 "최근" 증거처럼 넘기지 않는지 봐야 한다.
- Drizzle D1에서 `insert(...).select(...)`, `exists(...)`, `batch` 조합이 실제 typecheck와 integration에서 모두 통과하는지 확인한다.

Task 4를 확정할 때:

```bash
pnpm run test:integration -- tests/integration/place-liveness.server.test.ts
pnpm run typecheck
git diff --check
git add app/features/places/place-liveness.server.ts tests/integration/place-liveness.server.test.ts app/db/schema.ts
git commit -m "2026-08-12 장소 영업검증 상태 저장 구현"
```

그 뒤 `superpowers:subagent-driven-development` 절차대로 Task 4 독립 리뷰를 반드시 수행하고, 발견 사항이 있으면 최대 5회 fix loop로 처리한다.

## 남은 작업

- Task 4: D1 대상 선점, 증거 집계, 원자적 상태 저장. 부분 파일 존재, 미검수/미커밋.
- Task 5: `runScheduledPlaceMaintenance` 내부 예약 실행 연결과 장애 격리.
- Task 6: 추천 후보 제외 연결. 일반 지도/상세에는 `SUSPECTED`를 계속 보여야 한다.
- Task 7: 관리자 검수 UI, 보호/롤백 동작, E2E. UI 변경이므로 실제 desktop/mobile 확인 증거를 PR에 남긴다.
- Task 8: 운영 문서, 전체 검증, 최종 독립 리뷰, PR 생성.

## 변경 금지와 운영 경계

- 사용자 요청 경로에서 Kakao Local을 호출하지 않는다.
- 새 dependency, 새 cron trigger, 새 Cloudflare binding을 추가하지 않는다.
- `workers/app.ts` 최상위 `Promise.all` 항목을 늘리지 않는다. Task 5는 기존 `runScheduledPlaceMaintenance` 내부에서 순차/격리 실행한다.
- 실제 Kakao API, remote D1, 운영 migration, 배포, paid/live lane은 별도 사용자 승인 전 실행하지 않는다.
- `KAKAO_PLACE_VERIFICATION_ENABLED=false`, `KAKAO_PLACE_VERIFICATION_MODE=OBSERVE`가 기본 안전값이다.
- `OBSERVE`는 판정만 저장하고 추천 제외/숨김을 적용하지 않는다.
- `RECOMMEND`는 2회 미검색부터 추천 제외만 적용한다.
- `HIDE`는 3회 미검색과 14일/90일/120일 보호 조건을 모두 만족할 때만 임시 숨김한다.
- 공급자 `ERROR`는 `NOT_FOUND`로 변환하지 않고 연속 미검색 횟수에 포함하지 않는다.

## 최종 PR 전 검증

모든 Task가 끝나면 최소 다음을 실행한다.

```bash
pnpm test
pnpm run test:integration
pnpm run typecheck
pnpm run build
pnpm run test:e2e -- tests/e2e/admin-place-liveness.spec.ts
git diff --check
git status --short
```

실패는 신규 회귀와 기존 baseline을 분리해서 PR에 기록한다. 실제 공급자와 remote D1은 호출하지 않는다.

PR 본문에는 반드시 다음을 명시한다.

- migration `0025`
- 외부 API 비용/쿼터와 개인정보 최소화
- `KAKAO_PLACE_VERIFICATION_ENABLED`, `KAKAO_PLACE_VERIFICATION_MODE`
- 관찰 모드 기본값과 `OBSERVE -> RECOMMEND -> HIDE` 승격 조건
- kill switch와 추천 제외 해제/장소 revision rollback
- 실제 Kakao 1곳 contract smoke와 운영 D1 migration/deploy는 실행하지 않았다는 점

## 현재 상태 요약

이 handoff 작성 시점에 PR은 없고, 원격 브랜치는 Task 3 완료 지점까지 올라가 있다. 로컬 worktree에는 Task 4 부분 구현 파일 두 개와 이 handoff 문서가 추가되어 있다. Task 4 파일은 이어서 검수/수정하거나, 다음 CLI가 명시적으로 판단한 뒤 폐기하고 처음부터 다시 작성한다.
