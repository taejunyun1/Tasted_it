# RSI 주기와 범위 확장

> 2026-10-22 명칭·진행 보완: 기존 Stage는 운영 헬스체크 확장 단계다. 자기 수정과 개선 효과 평가는 별도 [RSI 구현 계획 R1–R6](./2026-10-15-rsi-agent-improvement.md)에서 정한다. R1은 #320으로 로컬 기반만 구현됐다. 이 계획의 작성·병합은 아래 Stage의 HOLD나 한정 GO를 확대하지 않는다.

> 2026-10-15 추가 한정 보완: [공개 fetch와 관리 재검사 결정](../../decisions/2026-10-15-rsi-public-fetch.md)을 포함한 PR 병합 시 Stage 3 중 기존 ADMIN 세션·동일 origin POST를 통한 기존 익명 6경로 수동 재검사만 GO다. 정기와 수동 감사는 구분하며 새 토큰·cron·경로 확대는 없다. 나머지 Stage 3과 Stage 1·4는 HOLD다.

> 2026-10-15 한정 보완: [결과 보존 결정](../../decisions/2026-10-15-rsi-result-evidence.md)과 해당 병합 PR은 Stage 2의 정기 결과 보존·실패 상태 전달만 GO로 전환한다. 기존 `admin_audit_logs`에 회당 결과 1개를 남기는 D1 예외이며 새 테이블·공급자·경로·cron은 없다. Stage 1·3·4는 HOLD를 유지한다. 아래 표의 초기 Stage 2 범위와 D1 금지는 이 한정 보완에 대해서만 대체된다.

- **상태:** ACCEPTED — 이 Pull Request가 병합되면 주기·단계 표가 적용. 이후 단계 구현은 별도 PR
- **추적:** [GitHub Issue #286](https://github.com/taejunyun1/Tasted_it/issues/286)
- **실행기:** [`2026-09-08-rsi-cloudflare.md`](./2026-09-08-rsi-cloudflare.md)
- **운영 대상:** [`docs/operations/cloudflare-deploy.md`](../../operations/cloudflare-deploy.md)의 Worker `retaste-beta`

## 1. 이번 PR에서 고정하는 주기

| 구분 | 식 | 하는 일 |
|---|---|---|
| maintenance | `17 18 * * *` | 기존 5개 예약 작업만 |
| RSI | `47 */6 * * *` | 공개 6경로 GET만. 6시간마다 |

`scheduled()`는 `controller.cron`이 RSI 식일 때만 `runScheduledRsiSelfCheck`를 돌린다. maintenance 시각에 RSI를 다시 돌리지 않는다.

에이전트 루프는 로컬 Node가 아니다. 배포 뒤·런타임 경로를 건드린 뒤에는 Observability의 `RSI_SELF_CHECK`를 읽거나 온디맨드 `GET /internal/rsi-self-check`를 트리거한다. 주기 실행은 Cloudflare cron이다.

끄려면 `RSI_CLOUDFLARE_ENABLED=false`. 주기를 되돌리려면 RSI cron 식을 빼고 재배포한다.

## 2. 지금 범위 (Stage 0)

익명 GET 계약만.

- 200: `/` `/places` `/login` `/privacy` `/robots.txt`
- 302 `/login`: `/admin`

쓰지 않는 것: HTML 본문 단언, 로그인 세션, D1, NAVER, 이메일, Workers AI, Queue, Durable Object, Workers Builds, 새 binding.

## 3. 추후 확장 (구현은 각 단계 PR)

한 단계 = 한 PR. 앞 단계가 라이브에서 안정되기 전에 다음을 구현하지 않는다.

| 단계 | 상태 | 넣는 것 | 넣지 않는 것 |
|---|---|---|---|
| 0 | 이번 PR | 6시간 cron 분리, 기존 6경로 | 경로 추가 |
| 1 | HOLD | 익명 공개 GET 추가 후보 `/terms` `/signup` `/courses`. sitemap과 같은 200 계약만 | 인증, POST, D1 |
| 2 | HOLD | RSI 실패를 Observability에서 더 잘 보이게 (`RSI_SELF_CHECK` `ok:false` 조회 절차만 문서·계약) | 새 알림 공급자, 새 테이블 |
| 3 | HOLD | 온디맨드 토큰이 있을 때 배포 직후 1회 트리거 절차 | 토큰 값을 저장소에 넣기 |
| 4 | HOLD | 로그인 이후 경로. 별도 세션/권한 설계와 Security 게이트 | 관리자 쓰기, 검수 자동화 |

Stage 1–4는 이 문서가 ACCEPTED여도 **구현 승인이 아니다**. 각 PR이 해당 단계를 `GO`로 바꿀 때만 코드를 넣는다.

## 4. 확장하지 않는 것

별도 ADR과 운영 PR 없이 RSI로 하지 않는다.

- 원격 D1 읽기/쓰기, 라이브 시드
- NAVER·공공데이터·이메일·Workers AI 호출
- 검수 큐 드레인, 일괄 공개, Clock I
- 기존 maintenance `Promise.all`에 작업 추가
- RSI 외에 세 번째 cron, Queue, Durable Object

## 5. Rollback

- 주기: wrangler에서 RSI cron 제거 또는 kill switch false 후 재배포
- 플랜: 문서 revert. 아직 구현하지 않은 단계는 코드 rollback이 없다
