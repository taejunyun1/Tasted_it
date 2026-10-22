# RSI 자검 — Cloudflare Worker 실행

> 2026-10-22 명칭·진행 보완: 이 문서의 실행 코드는 고정 6경로 **운영 정기 헬스체크**다. 기존 RSI 식별자는 호환을 위해 유지하지만 자기개선 효과의 증거로 사용하지 않는다. [에이전트 절차 수준 RSI 구현 계획](./2026-10-15-rsi-agent-improvement.md)은 PR #305 병합 시 채택되는 설계다. R1의 로컬 기반은 #320에서 구현됐으며 후속 단계의 구현·운영 실행은 별도 PR의 한정 GO를 따른다. 기존 주기와 승인 범위는 유지한다.

> 2026-10-15 보완: [결과 보존 결정](../../decisions/2026-10-15-rsi-result-evidence.md)을 포함한 PR 병합 후 정기 실행만 기존 운영 감사 테이블에 결과 1개를 기록한다. 아래 초기 읽기 전용 범위의 한정 예외이며, 점검 실패·origin 누락·감사 저장 실패는 Cron 실패로 전달한다. 온디맨드·kill switch false에는 D1 쓰기가 없다. 공개 경로·cron·외부 서비스는 늘리지 않는다.

- **상태:** ACCEPTED — 이 Pull Request가 병합되면 적용
- **추적:** [GitHub Issue #282](https://github.com/taejunyun1/Tasted_it/issues/282)
- **선행:** [Issue #280](https://github.com/taejunyun1/Tasted_it/issues/280) / [PR #281](https://github.com/taejunyun1/Tasted_it/pull/281) `67c3e5e`
- **런타임 SSOT:** 라이브 Worker `https://retaste-beta.retaste-beta.workers.dev`
- **운영 대상:** [`docs/operations/cloudflare-deploy.md`](../../operations/cloudflare-deploy.md)의 Worker `retaste-beta` · D1 `retaste-production`

## 1. 결정

RSI(에이전트 재귀 자검)는 로컬 `node scripts/verify-cloudflare-live.mjs`가 아니라 **Cloudflare Worker**에서 실행한다.

쓰는 것:

- RSI 전용 cron `47 */6 * * *` — `controller.cron`이 그 식일 때만 실행
- 온디맨드 `GET /internal/rsi-self-check` (`x-rsi-check-token`)
- kill switch `RSI_CLOUDFLARE_ENABLED`
- Workers Observability의 `RSI_SELF_CHECK` 로그 (호스트·경로·상태. PII 원문 없음)
- 주기·확장 단계: [`2026-09-08-rsi-scope-expansion.md`](./2026-09-08-rsi-scope-expansion.md)

넣지 않는 것:

- 기존 `Promise.all([...])`에 RSI 추가
- maintenance cron에서 RSI를 한 번 더 실행
- Workers AI, Queue, Durable Object, Workers Builds
- 원격 D1 읽기/쓰기, 라이브 시드
- 비밀값·토큰을 로그/위키/응답 본문에 출력

로컬 스크립트는 노트북 smoke일 뿐이다. 자검 루프가 아니다.

## 2. 루프

한 바퀴에 마찰 하나만 고친다.

1. **관찰.** 라이브 Worker가 공개 6경로를 GET한 결과와 Observability `$metadata.service=retaste-beta`의 `RSI_SELF_CHECK` / `$metadata.error`. 로컬 200과 라이브 404/302/5xx가 갈리면 라이브를 우선한다.
2. **가설.** 코드 회귀, 배포되지 않은 `main`, kill switch, 토큰 미설정, GitHub private 404를 갈라낸다.
3. **수정.** 최소 패치. 원격 D1·배포가 필요하면 별도 PR 범위로 뺀다.
4. **재탐색.** 같은 Worker RSI와 Observability를 다시 본다. 로컬 Node 스크립트만 통과한 상태를 완료로 쓰지 않는다.
5. **기록.** 이슈/PR에 라이브 상태 코드와 관측 요약만 남긴다. 상호·이메일·토큰·운영 주소 원문을 위키에 쓰지 않는다.

## 3. 격리와 한도

- 기존 5개 예약 작업 실패가 RSI를 건너뛰게 하지 않는다. RSI 실패가 그 5개를 reject하지 않는다.
- 스케줄 RSI는 `APP_BASE_URL`이 있을 때만 돈다. 없으면 skip.
- 경로당 GET timeout 8초. 쓰기는 없다.
- RSI cron 6시간 + 수동 온디맨드. 공개 6경로 GET만. maintenance는 일 1회 유지.
- `RSI_CLOUDFLARE_ENABLED=false`면 즉시 중단.

## 4. Rollback

- 코드 revert 또는 `RSI_CLOUDFLARE_ENABLED`를 `"false"`로 두고 재배포.
- 원격 D1은 이 루프가 변경하지 않는다.
- Worker version rollback은 배포 런북을 따른다.
