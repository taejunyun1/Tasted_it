# RSI 연구 기반: 사건 계약과 로컬 이력

- 담당: Jay/Codex
- 추적: [Issue #319](https://github.com/taejunyun1/Tasted_it/issues/319), [구현 PR #320](https://github.com/taejunyun1/Tasted_it/pull/320), [설계 PR #305](https://github.com/taejunyun1/Tasted_it/pull/305)
- 범위: R1/T1 사건·계보 계약, R1/T2 로컬 합성 원장·승인 기록 조회
- 상태: R1 로컬 합성 구현. [구현 PR #320](https://github.com/taejunyun1/Tasted_it/pull/320)의 병합 범위에만 한정 GO이며, R2–R6은 별도 단계다.

## 이번 단계에서 만드는 것

사건의 관측, 원인 가설, 재현, 패치, 검증, PR 준비, 병합, 라이브 확인을 서로 다른 상태로 기록한다. 정상·실패·미확인 결과를 구분하고, 앞 단계의 근거 없이 다음 단계로 건너뛰는 입력을 거절한다. 같은 배포·오류·실패 경로에서 반복된 관측은 같은 사건으로 묶고 개별 관측과 실행의 계보는 보존한다.

로컬 원장은 익명화된 계약에 맞는 합성 기록만 저장한다. 중복 실행과 오래된 상태에서의 동시 갱신을 차단하고, 프로세스를 다시 열어도 예약액과 사용액을 유지한다. 비용은 정수 단위로 계산하며 활성 예약액을 상한에 포함한다. 공급자 사용량이 불명확한 경우 최대 예약액을 소비한 것으로 남긴다.

기억 조회는 승인 근거가 있는 기록으로 고정된 snapshot K를 만들고, 오류·런타임·조건에 맞는 lesson을 최대 5개 선택한다. 선택한 snapshot과 lesson, 사용·거절 이유는 추적 가능한 값으로 남긴다. 모델 원문이나 새 이슈 댓글은 바로 학습 기록으로 사용하지 않는다.

## 합성 호출자의 사용 순서

실행 가능한 입력 예시는 [원장 시험](../../tests/unit/rsi-ledger.test.ts)과 [기억 시험](../../tests/unit/rsi-memory.test.ts)에 있다. 실행 CLI나 자동 연구 루프는 추가하지 않았다.

1. 최초에만 `LocalRsiLedger.create(path, config, nowUtc)`로 전용 디렉터리를 만든다. config의 campaign과 incident/campaign/day/month 상한은 변경 API 없이 고정한다. 정수 `MICRO_USD`는 합성 회계 단위이며 실제 승인 예산이 아니다.
2. 반환된 `checkpoint`를 원장과 분리된 신뢰 위치에 보관한다. 이후에는 같은 경로와 그 값으로 `LocalRsiLedger.open(path, trustedCheckpoint)`를 사용한다. 디스크에서 최신 hash를 자동으로 채택하지 않는다.
3. `reserve` 뒤에는 `authorized:false`인 중복을 재실행하지 않는다. 예약·정산·전이·종료 또는 새 중복 별칭을 저장한 뒤에는 바뀐 checkpoint를 매번 보존한다. 이 라이브러리는 `authorized:true`를 반환해도 모델을 호출하지 않는다.
4. `settle`은 신뢰된 호출자가 제공한 확인 영수증 또는 불명확한 정산을 받는다. 미정산·불명확한 사용량은 최대 예약액으로 계산한다. 미정산 예약은 일·월 경계를 지나도 남으며, 정산 비용은 예약·정산 기간에 보수적으로 귀속한다.
5. 사건 전이는 `transition`, 닫힌 사건의 이후 재발은 `closeIncident` 근거와 다음 epoch로 연결한다. 종료는 `RECOVERY_CONFIRMED`의 라이브 확인 참조와 `OPERATOR_CLOSED`의 별도 인가·종료 참조를 구분한다. 운영자 종료는 이전 실패·미확인 상태를 복구 성공으로 바꾸지 않으며, 모든 attempt의 종결·정산과 누적 예산은 유지한다. 상태·참조의 구조 검사는 실제 시험·승인·회복의 진위 검증을 대체하지 않는다.

`.writer-lock`이나 `.pending`이 남거나 checkpoint와 디스크가 다르면 호출을 멈추고 원장과 기준값을 보존한다. 자동 복구 API는 없다. lock 삭제, 최신 hash 수용, 디렉터리 재생성, 예약 0 초기화를 복구 절차로 사용하지 않는다. 쓰기 후 checkpoint 보관 전 crash도 중단 대상이다. 실제 복구 판단과 외부 checkpoint 내구 보관은 후속 감독기 범위다.

기억은 검토자가 `lessonDigest`, PR 번호·merge SHA를 승인 목록으로 먼저 고정하고 `createApprovedSnapshot`을 호출한다. 다음 실행은 별도로 보관한 expected hash와 현재 승인 목록을 `retrieveApprovedMemory`에 전달하고, 선택 결과에 `recordMemoryUse`를 한 번 결합한다. 후보가 만든 승인 목록을 신뢰 입력으로 사용하지 않는다. 승인·사용 기록은 호출자의 진술과 내용 binding이며 GitHub 승인 확인이나 실제 에이전트 행동의 증명이 아니다.

## 신뢰와 완료의 경계

- schema·digest·상태 전이는 입력과 기록의 정합성을 확인한다. 실제 시험 실행, 독립 평가, 배포 성공을 인증하는 장치는 아니다. 신뢰된 평가기와 실행기는 R2 이후의 작업이다.
- 로컬 원장은 동일 인터페이스를 검증하기 위한 합성 구현이다. 원격 `rsi-ledger` ref의 생성·writer 권한·실제 비용 호출을 승인하지 않는다.
- 로컬 POSIX 파일시스템의 mkdir·rename·fsync를 전제로 한다. partial file·남은 lock·경합은 합성 시험했지만 실제 전원 장애, Windows, 네트워크 파일시스템은 검증하지 않았다. 파일·symlink 검사는 같은 UID의 악성 프로세스를 격리하는 sandbox가 아니다. 원장 상위 디렉터리, 기준값, 시각과 영수증은 신뢰된 호출자가 보호해야 한다.
- 회당 파일은 최대 256 KiB, revision은 최대 10,000개다. 상한에서 중단하며 자동 압축·삭제는 없다. unsigned SHA256은 외부 기준값에 대한 변경 검출이며 작성자 인증이 아니다.
- 자유 서술 원문 대신 고정 분류, 식별자와 digest를 사용한다. 이 구조는 데이터 최소화이며 모든 비밀값을 탐지한다는 보장은 아니다. 실제 운영 증거를 입력하는 수집기는 별도 검토가 필요하다.
- 코드가 자신의 전략을 바꾸거나, 모델을 호출하거나, 실제 장애를 복구하는 단계는 아직 구현하지 않는다. R1 검증을 자기개선 효과의 증거로 발표하지 않는다.
- 기존 Worker 헬스체크, 두 cron, 학생 초대·좌석·배정과 중지된 알림은 이 구현과 독립적으로 유지한다.

## 로컬 검증

새 의존성 없이 기존 Node·pnpm·TypeScript·Zod·Vitest를 사용한다. 시험 자료는 임시 디렉터리의 합성 값이며 운영 데이터나 자격증명을 읽지 않는다.

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run tests/unit/rsi-contracts.test.ts tests/unit/rsi-ledger.test.ts tests/unit/rsi-memory.test.ts
pnpm run typecheck
pnpm test
pnpm run build
```

필수 PR CI 네 잡을 별도로 확인한다. 운영 Worker 코드와 경로를 변경하지 않으므로 이번 단계에는 운영 배포와 수동 RSI 요청이 없다. 기존 Worker의 정기 성공 기록은 운영 헬스체크의 증거로만 해석한다.

2026-10-22 의존성 점검에서 `pnpm audit --prod`는 0건이다. 개발 의존성을 포함한 `pnpm audit`는 기존 35건(critical 1·high 9·moderate 21·low 4)으로 실패했다. `package.json`과 잠금 파일은 이번 작업에서 변경하지 않는다. 예를 들어 [proxy-addr 권고](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)는 개발 도구의 Express 경로에 해당한다. 이 결과를 전체 감사 통과로 표시하지 않으며, 개발 도구 보안 갱신은 별도 변경으로 처리한다.

## 다음 단계와 복원

R2는 고정 재현·평가기, R3는 격리·broker와 한 사건 복구, R4는 전략 자기 수정, R5는 효과 시험, R6는 통제된 운영 연결이다. 각 단계의 소유 파일, 비용·개인정보·권한, 검증과 rollback은 후속 PR에서 정한다. 새 모델 호출, workflow dispatch, 운영 데이터 연결을 R1의 승인으로 수행하지 않는다.

R1을 제거할 때는 구현 PR을 revert한다. 로컬 합성 기록을 운영 증거나 예산 원장으로 승격하지 않는다. 실제 운영 서비스와 기존 감사·학생 기록에는 복원 작업이 필요하지 않다.
