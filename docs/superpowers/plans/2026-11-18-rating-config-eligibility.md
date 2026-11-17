# B15 현재 평가 설정 선택 일관성 보완

담당 Jay/Codex, Issue #463. #461의 조회·합성 비교와 분리한 기술 수정이다.

**목표:** 현재 조회·SQL CAS·자동 enqueue·job/snapshot fence가 같은 적격 설정만 사용한다. rating-v2.0의 수치·계산 출력·실제 설정 활성화는 바꾸지 않는다.

- 기존 active_until NULL의 open 의미를 유지한다. 지원 버전 rating-v2.0이고, 유효한 active_from이 요청 시각 이하인 설정만 선택한다. 종료값이 있는 설정을 새로 활성화하지 않는다.
- 적격 설정 없음은 getter의 ACTIVE_RATING_CONFIG_NOT_FOUND다. 미래/미지원 설정으로 fallback하지 않는다. 자동 publication은 snapshot을 stale로 만들고 job0·기존 operational alert로 명확히 남기며 소유자의 철회를 막지 않는다.
- 공통 SQL helper를 getter/4개 CAS/조회·commit·enqueue·job fence에 사용한다. trigger는 새0060에서 같은 조건으로 교체하며 이전 migration·원문/표/기존 점수를 수정하지 않는다.
- 새 migration은 `drizzle/0060_rating_config_eligibility.sql`이다. 다른 작업자의0053~0059와 순번을 조율했다. 실제 원격 실행은 부모의 병합 PR·rollout 범위다.

## 최소 구현 순서

- [x] 실제 D1에서 미래/현재/종료/미지원·적격 없음이 getter와 SQL에 일치하는 실패 시험을 먼저 실행한다.
- [x] 공통 적격 SQL/getter, admin-recompute/job-control/integrity CAS, 일반 enqueue/job claim/snapshot commit·read를 연결한다.
- [x] populated0060 upgrade/trigger 중복·무적격 stale+alert·철회 보존을 검증한다.
- [x] 기존 rating/admin job/integrity/공개 소비 회귀와 typecheck/build, 독립 리뷰만 수행한다.
- [x] 적격 없음 ADMIN503/명확한 안내를 확인한다. 새로운 정책값·재계산을 실제 운영에서 실행하지 않는다.

운영 복원은 적격성 gate를 유지한 코드 forward-fix를 우선한다. 이전 Worker 복귀가 필요하면 기존 maintenance fence를 유지하고 현재 설정 적격성을 확인한 뒤 수행한다. 날짜 검사가 없는 구코드를 무조건 재활성화하지 않는다. 적용된0060은 수정·삭제하지 않으며 trigger 변경은 다음 순번 forward migration으로만 한다. 배포/원격 D1/live RSI·SSOT/위키는 부모 담당이다. #397 HOLD.
