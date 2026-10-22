# RSI 연구 기반: 사건 계약과 로컬 이력

- 담당: Jay/Codex
- 추적: [Issue #319](https://github.com/taejunyun1/Tasted_it/issues/319), [구현 PR #320](https://github.com/taejunyun1/Tasted_it/pull/320), [설계 PR #305](https://github.com/taejunyun1/Tasted_it/pull/305)
- 범위: R1 사건·계보·원장·기억, R2 고정 평가, R3 로컬 합성 격리·broker·수신자 오류 한 건의 복구 감독기
- 상태: R1의 승인 기준은 [구현 PR #320](https://github.com/taejunyun1/Tasted_it/pull/320)의 병합 범위다. R3 로컬 합성 구현은 아래 별도 절에 기록하며 운영 GO나 자기개선 효과로 승격하지 않는다. 각 후속 단계의 승인 기준은 해당 병합 PR이다.

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
- R1은 코드의 전략 수정·모델 호출·실제 장애 복구를 구현하지 않는다. 아래 R3도 고정 fake를 사용하는 한정 합성 실험이며 자기개선 효과나 운영 복구의 증거가 아니다.
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

## R3: 합성 수신자 오류 한 건의 감독기

R3 Task 4는 [Issue #323](https://github.com/taejunyun1/Tasted_it/issues/323)의 Jay/Codex 소유 범위다. `LOCAL_SYNTHETIC`에서 관측→두 가설→실제 native RED→제안 바이트 검증→독립 native GREEN→네 회귀→합성 `PR_READY`를 기록한다. `PR_READY`는 열린 사건으로 유지한다. 실제 GitHub PR·CI·병합·배포·라이브 확인·사건 종료는 실행하지 않는다. R3의 병합·승인 상태는 해당 구현 PR이 기준이며 이 문서의 구현 설명만으로 운영 권한이 생기지 않는다.

수정 가능한 서비스 영역은 `app/features/operations/rsi-self-check.ts`의 `fetchPath` 초기화식뿐이다. 제안은 `{action:"PATCH",path,baseSourceDigest,find,replace}`로 받는다. `find`가 원본의 해당 식 안에서 정확히 한 번 일치해야 하며, 대체한 식 바깥의 모든 바이트를 유지한다. 허용식은 `input`·`globalThis`와 비계산형 `fetch`·`bind` 접근, 단일 수신자 인자를 받는 `bind` 호출뿐이다. 상태/리다이렉트 판정 약화, callback·대입·새 객체·동적 접근, 다른 파일, `.server.ts`, auth·workflow·감독기·평가기 변경은 거절한다. 감독기가 올바른 교체 바이트를 고르거나 삽입하지 않는다. 이 경계는 일반 앱 수리기가 아니며 새로운 원인과 패치 영역은 별도 승인 대상이다.

진단 출력은 `action:"DIAGNOSE"`, 서로 다른 원인 가설 최소 두 개, `PUBLIC_SIX_PATHS` 재현 선택과 관련 회귀 목록을 포함한다. 각 가설의 supporting/refuting evidence ID는 관측에 존재하거나 `UNKNOWN`이어야 한다. 확신 점수나 `PASS` 주장은 받지 않는다. 고정 필수 회귀는 정상, 일반 HTTP 실패, 인증 리다이렉트 실패, 인증 상태 실패다. 외부 장애를 정확하게 보고한 `NO_CHANGE/EXTERNAL_FAILURE`와 `greenVerified:false`는 정상 회귀 결과다. 외부 HTTP를 200으로 바꾸는 수정은 허용하지 않는다.

기본 fake 응답 `{action:"NO_CHANGE",reason:"LOCAL_FAKE"}`를 존중한다. 정상/외부 실패의 무수정 결과는 native 근거가 있을 때 `NO_CHANGE`로 끝난다. 실패가 남은 상태의 무수정 답은 `INCONCLUSIVE/NO_CHANGE_UNCONFIRMED`로 남기고 패치를 대신 만들지 않는다. 두 후보가 실패하면 `INCONCLUSIVE/CANDIDATE_LIMIT`, 재현 실패는 `INCONCLUSIVE/REPRODUCTION_FAILED`, 격리 backend/이미지 미검증은 `BLOCKED`다. 전체 상한은 두 후보·120초·모델 8요청이며 기존 broker가 73,552 MICRO_USD 최악 비용을 한 번 예약한다. 미확인 사용량은 전액을 소비하고 실패 이력을 초기화하지 않는다.

새 외부 실행 전에는 남은 시간이 해당 고정 실행과 cleanup 상한을 모두 덮어야 한다. 컨테이너 한 번의 create/inspect/final-inspect/rm은 각 5초이고 start는 agent 3초/native 15초이므로 합계는 23초/35초다. agent 검증에는 info/image 각 5초와 최초 local endpoint 조회 5초를 더해 38초, native 검증에는 info/두 image 조회 15초와 isolation/runtime probe 각 35초를 합쳐 85초를 확보한다. 모델 요청 전에는 30초를 확보한다. 각 await 뒤와 상태 승격 전후에도 동일한 전체 monotonic deadline과 kill switch를 재검사한다. 로컬 파일·문법 처리·내구 기록의 OS 정지는 별도의 실시간 보장이 아니며, 그 작업이 시간을 넘기면 후속 후보 실행이나 성공 승격을 허용하지 않는다. 실행 중인 컨테이너는 기존 3초/15초와 cleanup 경계로 끝내며 새 capability로 대체하지 않는다.

### 신뢰된 호출자의 순서

1. 전용 합성 디렉터리에서 `LocalRsiLedger.create`를 최초 한 번 호출한다. 원장 밖의 별도 0700 감독기 디렉터리에 `ControllerCheckpointStore.create(path,ledger.checkpoint)`를 저장한다. 이후 재개는 외부에 보관한 동일 기준값으로 `LocalRsiLedger.open`과 `ControllerCheckpointStore.open`을 사용한다. 디스크 최신 head를 자동 채택하지 않는다.
2. `loadSeedAgentSources()`는 두 전략 파일을 문자열로 읽는다. `compileAgentSources(sources)`는 정확한 두 경로의 닫힌 문법 bundle을 만들고 `agentHash`, 모듈 digest와 `compiledDigest`를 반환한다. 호스트에서 전략 module을 import·eval·실행하지 않는다. 변경된 전략의 유일한 import는 repair→`./diagnostic-policy`다.
3. `recoverSyntheticIncident({ledger,checkpointStore,observation,baseSource,agentSources,killSwitch,...})`를 호출한다. 입력은 감독기 소유이며 후보 JSON을 options로 넘기지 않는다. `scenarios`는 고정 fake 진단/패치 자료만 받는다. 진단·패치 결정은 같은 활성 전략 bundle을 실제 컨테이너에서 실행해 얻는다. 후보에게는 공개 소스·익명 합성 관측·허용 편집 영역·선택된 승인 lesson 정책만 전달하며 fixture·oracle·기대 정답·manifest는 전달하지 않는다.
4. native manifest는 고정 경로와 정규화 SHA-256 `605ad858ec0c49edda87c5b733d06bf04c954388bb619a1e81664400d20627ae`로 고정한다. 별도 격리 capability의 실제 `DOCKER_CLI` 실행을 사용한다. 소스/입력 hash, 로그 두 pipe의 EOF·오류 0, disposal·cleanup·실행 trace/응답 binding을 확인한다. 후보 JSON이나 주입 transport의 그럴듯한 영수증은 실행 권한이나 복구 근거가 아니다.
5. 모든 원장 mutation 뒤 checkpoint를 `pending` 독점 생성→fsync→rename→디렉터리 fsync로 보존한다. 오래된 기준값, 남은 pending, 불명확한 쓰기는 `BLOCKED/ACCOUNTING_UNCERTAIN`이다. 삭제·재생성·새 pool·새 capability로 실패를 우회하지 않는다. 불완전 native 결과는 `UNKNOWN` 근거와 실제로 도달한 단계까지 보존한다.

반환값에는 상태·계보·candidate 수·정산·외부 실행 근거의 immutable snapshot만 남는다. 원문 소스와 실제 Docker endpoint/home 경로를 기록하지 않는다. `actualRecovery`는 항상 `false`다. 네 CI 영수증은 `LOCAL_SYNTHETIC_CI`이며 네 native 회귀에 연결한 로컬 계약 자료다. 실제 unit/integration/build/Playwright CI를 실행했다는 주장이 아니다.

`lineage.controllerHash`는 고정 감독기·broker·원장·기억·sandbox·공통 backend·정책·package/lock bytes를 묶는다. `lineage.evaluatorHash`는 기존 R2 hash를 대체하지 않고 상위 closure로서 R2 evaluator/contracts/oracle, native executor/wrapper/guard/harness, 공통 backend, 두 평가 manifest·runtime/image·고정 한도를 포함한다. 변경 가능한 두 agent module은 별도 `candidateAgentHash`와 compiled digest에 묶는다.

### R4 연결과 검증

`compileAgentSources(g1Sources)`의 실제 `source`를 `DockerSandbox.verify().execute({schemaVersion:1,source,input:{schemaVersion:1,taskKind:"improve-agent",payload}})`에 전달하면 repair와 동일한 활성 hash/격리 ABI로 g1을 실행할 수 있다. 출력은 끝까지 untrusted data다. R4는 새로 생성된 정확한 두 module 바이트를 별도 검증·bundle하고, 새 세션의 repair 실행에 `agentSources:g2Sources,parentAgentHash:g1.agentHash`를 제공해야 한다. 세대 숫자만 올리는 것을 인정하지 않는다. 이 seed는 LOCAL_FAKE 응답을 전달하는 순수 전략이며 실제 모델 기여·자가수정·개선 효과를 증명하지 않는다.

```sh
pnpm exec vitest run tests/unit/rsi-controller.test.ts
RSI_CONTROLLER_PROBE=1 pnpm exec vitest run tests/unit/rsi-controller.test.ts
pnpm run typecheck
pnpm test
pnpm run build
pnpm audit --prod
pnpm audit
```

기본 시험은 호스트의 순수 계약·거절 분기와 주입 자료 시험이다. opt-in은 변경하지 않은 기존 검증 이미지에서 실제 전체 흐름, 정상/외부 실패 무수정, 무수정 거절·금지 패치·두 후보 중단, improve-agent ABI를 확인하고 `.superpowers/sdd/r3-implementation-plan/controller-receipts.jsonl`에 추가 기록한다. 최초 불완전 실행 뒤 남은 campaign은 중단한다. backend가 없으면 `BLOCKED`이며 skip을 실제 통과로 세지 않는다. native artifact 변경이나 불명확한 cleanup이 발견되면 자동 rebuild·manifest 갱신·재시도 대신 원래 증거를 보존하고 별도 범위를 보고한다.

이번 변경은 운영 앱 파일·provider·학생 자료·credential·Cloudflare binding·cron·workflow·의존성을 바꾸지 않는다. 제거는 해당 구현 PR의 범위 revert로 처리하며 합성 기록을 운영 기록으로 승격하거나 기존 운영 데이터를 복원하지 않는다.
