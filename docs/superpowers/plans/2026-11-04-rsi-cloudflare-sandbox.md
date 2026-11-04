# RSI 후보 실행 백엔드를 Cloudflare Sandbox로 이전하는 검토

- **상태:** PROPOSED — 사람 승인과 PR 병합 시에만 다음 단계 결정. 구현 승인이 아니다.
- **작성일:** 2026-11-04
- **기준선:** `origin/main@d361cf9`
- **추적:** [Issue #331](https://github.com/taejunyun1/Tasted_it/issues/331)
- **대상 계정:** Cloudflare `7543330c65069ee2df1b7b353fb0201c`(retaste-beta 소유 계정, 현재 Workers **무료** 플랜)

## 1. 해결하려는 문제

R4(`codex/jay_rsi-r4`, PR #328)에서 한정 두 세대 자기수정의 **실제** 흐름이 두 번 모두 로컬 Docker 전송 계층(`RM_TRANSPORT/TIMEOUT`, `RSI_SANDBOX_CLEANUP`)에서 BLOCKED됐다. 근본 원인은 UNKNOWN이고, `RM_TRANSPORT`는 후보 실행용 고정 `DockerSandbox`의 생명주기(특히 cleanup)와 로컬 Docker 데몬 사이 전송 실패다. 합성·fake 경로는 전부 통과하므로 막힌 것은 실행 인프라일 뿐이다.

문제: **후보 코드를 격리 실행하는 백엔드가 로컬 Docker 데몬 상태에 종속**되어, 승격 판정에 필요한 실제 증거 수집이 인프라 장애로 반복 차단된다.

## 2. 비목표

- RSI self-check 루프(`47 */6 * * *`, `/internal/rsi-self-check`, `RSI_SELF_CHECK` 로그) 변경 없음. 그 루프에 대한 Durable Objects·Queue·세 번째 cron·Workers AI 금지 규칙은 그대로 유지한다.
- retaste-beta의 프로덕션 코드·binding·secret·D1·R2·cron 변경 없음.
- 모델 개선·운영 성공 주장 없음. 합성 한도(세대당 73,552·두 세대 147,104 MICRO_USD)와 PASS 게이트는 그대로.
- 유료 플랜 전환·배포·실제 실행은 이 문서의 병합 승인과 별도 PR 범위가 선행되어야 한다.

## 3. 대안 비교

| 대안 | 내용 | 장점 | 비용·위험 |
|---|---|---|---|
| A. 로컬 Docker 원인 조사 유지 | `RM_TRANSPORT/TIMEOUT` cleanup 전송 원인만 #327 조율 범위로 좁혀 조사 | 비용 0, 인프라 변경 0 | 이미 두 번 실패한 동일 계층. 근본 원인 UNKNOWN 상태에서 재발 가능. 조사 자체도 Docker 필요 |
| B. **CF Sandbox SDK** (권고안) | `@cloudflare/sandbox`로 후보 실행만 CF 컨테이너에서 수행, supervisor·원장·오라클은 로컬 유지 | 로컬 데몬 의존 제거. 컨테이너 수준 격리(Docker 이상). `exec`/`writeFile`/`destroy`가 `DockerSandbox` 생명주기와 형태가 유사 | Workers **Paid 전환 필요(무료 플랜 불가)**, Containers+Durable Objects 신규 binding(HOLD 예외). CF Sandbox는 활발 개발 중인 제품. 로컬 dev도 Docker 요구 → 로컬 데몬이 불안정하면 dev 검증도 제한 |
| C. Workers for Platforms dispatch | 후보 소스를 user worker로 dispatch | isolate 격리, outbound 제어 가능 | Paid 필요. 후보가 JS/TS로 제한, 기존 sandbox ABI(임의 명령 실행)와 불일치 — 현재 후보 실행은 셸 명령 단위라 재설계 폭이 큼 |
| D. 직접 Containers | raw Containers binding으로 직접 오케스트레이션 | 최대 제어 | Sandbox SDK가 이미 같은 기반 위의 생명주기·격리 추상 제공. 직접 구현은 유지 부채만 증가 |
| E. 변경 없음 | R4 actual을 무기한 HOLD | 위험 0 | 두 세대 실제 검증이라는 R4 목적 자체를 달성 불가. 이미 실패 증거만 쌓임 |

권고: **B**, 단 아래 게이트 증거를 PR이 채우고 사람이 승인한 뒤에만. B가 NO-GO면 A를 #327 범위 조율로 재개.

## 4. 권고 설계(B, PROPOSED)

- **분리 배포 단위:** `retaste-beta`와 무관한 전용 lab worker(가칭 `retaste-rsi-sandbox`)를 만든다. 계정은 같지만 배포·secret·관측을 완전 분리한다.
- **역할 한정:** lab worker는 후보 소스 수신 → sandbox에서 실행 → 요약 결과(종료 코드·시간·자원·한정 출력 digest) 반환만 한다. PASS 판정·승격·원장 쓰기는 로컬 supervisor가 그대로 소유한다.
- **SANDBOX_POLICY 동등성 요구:**
  - 격리: 컨테이너 인스턴스 1회성 사용, run 사이 상태 공유 없음(`destroy` 필수).
  - 입력: 후보 소스+fixture만 `writeFile`로 전달. 자격 증명·실 사용자 데이터·원장 쓰기 권한 0.
  - 네트워크: 후보 outbound 차단 또는 화이트리스트만 — Sandbox SDK에서 제공하는 제어 수단을 구현 단계에서 확인해 PR에 증거로 남긴다.
  - 자원: `instance_type: lite`, `max_instances: 1`, 기존 120초 실행·8초 요청 상한 동등 적용.
  - 증거: 실행 전후 불변 evidence blob 저장, 실패·정리 불확실성도 fail-closed(`UNKNOWN`을 성공으로 처리하지 않음).
- **통신:** supervisor(로컬) ↔ lab worker는 한정된 JSON 요청/응답. 인증 토큰, 요청 크기 상한, 원시 오류 문자열 비노출(코드만).
- **로컬 검증:** `wrangler dev`로 lab worker를 로컬에서 돌려 fake 후보 1회 실행 — 단 로컬 Docker가 필요하므로 데몬 상태가 dev 검증의 전제다.

## 5. 거버넌스 게이트 증거(§6·§7 응답)

- **변경 유형:** 새 Cloudflare binding·저장소(Containers, Durable Objects) + 외부 SaaS 확장 — `ADR + Operations 승인` 게이트. 이 문서가 ADR 역할을 한다.
- **HOLD 예외:** §5.3 HOLD의 Durable Objects를 실험실 백엔드 한정으로 예외 적용. 예외 범위: lab worker 1개·후보 실행 용도만. 종료 조건은 §7.
- **비용:** Workers 무료→**Paid 전환 필요**(월 기본 요금 + 컨테이너 사용분). 월 상한을 PR에 숫자로 명시하고 hard stop(상한 도달 시 binding/실행 차단 절차)을 같이 정의한다. 실제 요금 수치는 구현 PR에서 당시 Cloudflare 공시가로 기록한다.
- **개인정보:** 전송 데이터는 후보 소스·fixture·요약 메타뿐. 실 사용자 데이터·secret·학생 정보 0. 원시 모델 응답·오류 문자열 로그 금지.
- **관측:** lab worker도 Workers Observability 구조화 로그, `RSI_SANDBOX_EXEC` 식 태그. 실패는 조용한 성공 없이 코드로 노출.
- **kill switch:** lab worker 배포 제거 또는 supervisor의 백엔드 선택을 `docker`(기존)로 되돌리는 스위치. 복원 경로는 기존 `DockerSandbox` 유지다 — Docker 백엔드를 삭제하지 않는다.
- **로컬 fake:** unit 테스트는 기존처럼 mocked backend로 실행 — CF 호출 없이 통과해야 한다.
- **재검토:** 병합 후 첫 실제 flow 결과와 무관하게, 구현 PR 시점에 비용·안정성 재검토 조건을 다시 기록한다.

## 6. 알려진 위험·미해결

1. CF Sandbox 제품이 베타 단계 — API·요금이 바뀔 수 있다. 구현 PR에서 당시 문서 기준 재확인.
2. `wrangler dev`의 컨테이너 dev도 로컬 Docker를 요구 — 데몬이 불안정한 환경에서는 로컬 검증 자체가 막힐 수 있다(배포 실행은 CF 인프라라 무관).
3. outbound 차단 수단·cleanup 보장이 Sandbox SDK에 Docker 수준으로 있는지 미확인 — 구현 PR의 필수 증거.
4. 계정의 wrangler OAuth에 containers 관련 scope가 없을 수 있음 — 배포 권한도 승인 단계에서 확인.

## 7. 제거 조건

- R4/R5 실제 검증 완료로 lab 백엔드 필요가 소멸하거나,
- 월 비용 상한 도달·제품 불안정으로 유지 근거가 사라지면,
lab worker 삭제 + binding 해제 + Paid 전환 재검토를 별도 PR로 처리한다. 기존 `DockerSandbox`는 이 전체 기간 유지한다.

## 8. 다음 단계(승인 후에만)

1. Issue #331에 이 문서의 검토 결과(GO/CONDITIONAL GO/HOLD/NO-GO) 기록.
2. GO 시 별도 구현 PR: lab worker 스켈레톤 + supervisor의 backend 선택 지점 + unit fake + 비용 상한 명시.
3. 구현 PR 병합 후에도 실제 유료 전환·배포는 명시된 운영 범위가 있는 PR에서만.
