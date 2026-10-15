# 에이전트 자검 루프 — Cloudflare 우선

> 2026-10-15 명칭 보완: 이 문서는 에이전트 작업의 라이브 재확인 절차이며, Worker에서 자동 자기 수정을 구현했다는 뜻이 아니다. [에이전트 절차 수준 RSI 결정](../../decisions/2026-10-15-rsi-agent-improvement.md)과 [구현·효과 평가 계획](./2026-10-15-rsi-agent-improvement.md)은 PROPOSED다. 기존 Cloudflare 관측 원칙과 실행 제한은 유지한다.

- **상태:** ACCEPTED — 이 Pull Request가 병합되면 적용
- **추적:** [GitHub Issue #280](https://github.com/taejunyun1/Tasted_it/issues/280)
- **런타임 SSOT:** 라이브 Worker `https://retaste-beta.retaste-beta.workers.dev`
- **운영 대상:** [`docs/operations/cloudflare-deploy.md`](../../operations/cloudflare-deploy.md)의 Worker `retaste-beta` · D1 `retaste-production`

## 1. 결정

에이전트는 자기 작업을 로컬 테스트만으로 닫지 않는다. 런타임·사용자 경로를 건드릴 수 있으면 **이미 있는 Cloudflare**로 관찰하고 고친다.

쓰는 것:

- 라이브 Worker에서 도는 RSI. 실행기는 [`2026-09-08-rsi-cloudflare.md`](./2026-09-08-rsi-cloudflare.md)
- Workers Observability 읽기 (오류·5xx. PII 원문 복사 금지)
- 운영 계정 SSOT (`docs/operations/cloudflare-deploy.md`)
- Worker 코드를 바꾸면 `pnpm exec wrangler deploy --dry-run`

넣지 않는 것:

- 로컬 Node를 RSI 루프로 사용 (`pnpm run verify:cloudflare-live`는 smoke일 뿐)
- Workers AI, Queue, Durable Object, Workers Builds
- RSI 전용 주기 외의 새 cron / 기존 `Promise.all`에 자검 추가
- 원격 D1 쓰기, 라이브 시드, 비밀값 출력
- 이 루프만으로 `pnpm run deploy`

로컬 `pnpm dev`는 재현용이다. 사용자에게 보이는 완료 주장은 라이브 Worker RSI와 Observability가 받쳐야 한다.

## 2. 루프

한 바퀴에 마찰 하나만 고친다.

1. **관찰.** `git status`, 라이브 탐색, Observability에서 `$metadata.service=retaste-beta` 오류. 로컬 200과 라이브 404/302/5xx가 갈리면 라이브를 우선한다.
2. **가설.** 코드 회귀, 시드 없는 로컬, 포트 혼선, 배포되지 않은 `main`, GitHub private 404를 갈라낸다.
3. **수정.** 최소 패치. 원격 D1·배포가 필요하면 별도 PR 범위로 뺀다.
4. **재탐색.** 같은 Worker RSI와 Observability를 다시 본다. 로컬 Node만 통과한 상태를 완료로 쓰지 않는다.
5. **기록.** 이슈/PR에 라이브 상태 코드와 관측 요약만 남긴다. 상호·이메일·토큰·운영 주소 원문을 위키에 쓰지 않는다.

## 3. 1회차 증거 (2026-09-08)

- 라이브 GET: `/` `/places` `/login` `/privacy` `/robots.txt` 200, `/admin` 302 `/login`.
- Observability 최근 24h: `retaste-beta` `$metadata.error` 이벤트 0.
- 로컬 잔여 `.playwright-mcp/`는 커밋 대상이 아니어서 ignore에 넣는다.

## 4. Rollback

문서와 스크립트 revert. 라이브 Worker·원격 D1은 이 루프가 변경하지 않는다.
