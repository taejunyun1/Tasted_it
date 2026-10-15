# 학생 가입·교차 확인 및 RSI 결과 보존 검증

요구는 Issue #297의 사용자 요청에서 도출했다. 운영 A~D 초대는 보존하고 합성 계정의 전체 흐름을 격리된 Workers/D1에서 시험한다.

| 보장 | 시험 | 결과 |
|---|---|---|
| 네 계정이 실제 signup→verify-email→login→student/join route를 통과한다. 인증 전 로그인·인증 토큰 재사용·초대 재수락을 거부한다. | `tests/integration/student-onboarding-flow.test.ts` | 2개 PASS |
| 점포·리뷰·QA 제출 후 지정된 다른 계정만 확인한다. 재확인·타인 작업 열람을 거부하고 점포/검수 원문과 작성자 비추천 평가를 보존한다. | 같은 파일의 전체 흐름 시험 | PASS |
| 네트워크 실패 시 여섯 경로 결과를 유지하고, 정기 결과를 보존하며 실패와 저장 오류를 Cron에 전달한다. | `tests/unit/rsi-self-check.test.ts` | RED 4개 재현 후 GREEN 8개 |
| 정기 감사는 실제 로컬 D1에 1개 기록하며 리디렉션·쿠키·토큰·개인정보 원문을 포함하지 않는다. 비활성화와 토큰 없는 HTTP 요청에는 쓰기가 없다. | `tests/integration/rsi-scheduled-audit.test.ts` | 3개 PASS |
| RSI는 maintenance와 분리되고 D1 효과는 정기 운영 감사에 한정된다. | `tests/unit/cloudflare-live-self-check.test.ts` | 2개 PASS |
| 초대 창을 유지한 채 다른 창에서 회원가입·인증·로그인하고 돌아와 로그인 상태를 확인한 후 수락·제출·교차 확인한다. | `tests/e2e/student-workspace.spec.ts` 및 로컬 실제 브라우저 | A/B 수동 전체 흐름 PASS, 네 계정 자동 시험은 PR CI에서 실행 |

## 실행 증거

- RED: `pnpm test tests/unit/rsi-self-check.test.ts` — 4 failed / 4 passed. `ab4fcce`에 재현 시험을 보존했다. 네트워크 예외로 전체 결과 유실, 감사 호출 0회, 실패·감사 실패가 정상 반환되는 문제를 각각 재현했다.
- GREEN: 같은 RSI 시험과 Cloudflare 계약 시험 10개 PASS. 최초 단계의 전체 D1 금지 단언은 [결정 기록](../decisions/2026-10-15-rsi-result-evidence.md)의 정기 감사 한정 예외에 맞춰 갱신했다. on-demand D1 금지는 유지한다.
- `pnpm test` — 149파일, 941개 PASS.
- `pnpm test:integration` — 78파일, 398개 PASS.
- `pnpm run typecheck`, `pnpm run build` — PASS.
- `pnpm audit --prod` — 0건. 전체 도구 포함 audit는 기존 28건(낮음 3·보통 16·높음 8·치명 1)이며 의존성·lockfile 변경은 없다.

## 범위와 한계

전체 흐름 시험은 실제 route·비밀번호 해시·검증 토큰·로그인 세션·D1 조건부 쓰기를 사용한다. 외부 Resend 전송만 fake로 대체하며 실제 수신함 전달 성공을 주장하지 않는다. 운영 A~D 토큰을 실행하거나 라이브 시드를 넣지 않는다. 비율 기반 coverage는 측정하지 않았으며 새 계측 의존성을 추가하지 않았다.

브라우저 시험도 학생 세션을 주입하지 않고 네 계정을 실제 양식에서 가입·인증·로그인한다. 로컬 전용 entrypoint `tests/e2e/local-email-worker.ts`는 Resend 호출을 합성 메일함으로 바꾸고 loopback 호스트만 허용한다. 메시지는 5분·32개 한도이며 읽은 즉시 제거한다. `wrangler.e2e.jsonc`의 가짜 D1 ID와 시험 키만 사용하며 production entrypoint·bundle에는 포함하지 않는다. 실제 브라우저 A/B 흐름에서 신규 등록 확인과 서로 다른 계정의 2개 이력을 확인했다.

PR/병합 main CI, 실제 Worker version, 운영 초대 사전/사후 비교와 정기 RSI 결과는 Issue #297 및 위키에 기록한다. 새 정기 실행 전에는 실제 RSI 성공을 PENDING으로 유지한다.
