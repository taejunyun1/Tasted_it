# RSI 연구 기반: 사건 계약과 로컬 이력

- 담당: Jay/Codex
- 추적: [Issue #319](https://github.com/taejunyun1/Tasted_it/issues/319), [구현 PR #320](https://github.com/taejunyun1/Tasted_it/pull/320), [설계 PR #305](https://github.com/taejunyun1/Tasted_it/pull/305)
- 범위: R1 사건·계보·원장·기억, R2 고정 평가, R3 로컬 합성 격리·broker·수신자 오류 한 건의 복구 감독기, R4 고정 두 세대 감독기
- 상태: R4는 [PR #328](https://github.com/taejunyun1/Tasted_it/pull/328) `d690b3d`로 2026-11-05 02:33 KST 병합됐다. 아래 10/23 HOLD는 당시 실패 이력이다. 현재 재검증과 앱 의존성 변경 후의 native artifact 분리 작업은 아래 11/13 기록·[PR #362](https://github.com/taejunyun1/Tasted_it/pull/362)를 따른다. R1의 승인 기준은 [구현 PR #320](https://github.com/taejunyun1/Tasted_it/pull/320)의 병합 범위다. R3 로컬 합성 구현은 아래 별도 절에 기록하며 운영 GO나 자기개선 효과로 승격하지 않는다. 각 후속 단계의 승인 기준은 해당 병합 PR이다.

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

수리 전 원인 확인에는 별도의 `NATIVE_FETCH_INPUT_RECEIVER_V1` 계약을 적용한다. 승인된 merged-main `741e919aedabdeadd6d46619a35a0105bafdce66` 서비스 소스에서 초기화식 바깥 bytes의 SHA-256을 `365fba0ded44c6d6e6a07dafbe271be6d2ff72314d32e62bc8a5a565a079f2fb`로 고정하고, 초기화식 AST는 단일 direct `input.fetch.bind(input)` 호출이어야 한다. 바깥 source/callsite·shadowing·alias 변경, bare `input`/`globalThis`, 중첩 bind 및 다른 fault family는 native `FAIL/0`만으로 이 원인에 편입하지 않고 `REPRODUCTION_FAILED`로 보존한다. 제안의 bare 비함수 식도 거절한다. 승인된 원본의 초기화식이나 기대 replacement는 후보 입력에 별도로 제공하지 않으며, 이 계약은 정답 생성기가 아니다. 원인 확인 근거에 anchor/context/contract/initializer digest를 남긴다.

진단 출력은 `action:"DIAGNOSE"`, 서로 다른 원인 가설 최소 두 개, `PUBLIC_SIX_PATHS` 재현 선택과 관련 회귀 목록을 포함한다. 각 가설의 supporting/refuting evidence ID는 관측에 존재하거나 `UNKNOWN`이어야 한다. 확신 점수나 `PASS` 주장은 받지 않는다. 고정 필수 회귀는 정상, 일반 HTTP 실패, 인증 리다이렉트 실패, 인증 상태 실패다. 외부 장애를 정확하게 보고한 `NO_CHANGE/EXTERNAL_FAILURE`와 `greenVerified:false`는 정상 회귀 결과다. 외부 HTTP를 200으로 바꾸는 수정은 허용하지 않는다.

기본 fake 응답 `{action:"NO_CHANGE",reason:"LOCAL_FAKE"}`를 존중한다. 정상/외부 실패의 무수정 결과는 native 근거가 있을 때 `NO_CHANGE`로 끝난다. 실패가 남은 상태의 무수정 답은 `INCONCLUSIVE/NO_CHANGE_UNCONFIRMED`로 남기고 패치를 대신 만들지 않는다. 두 후보가 실패하면 `INCONCLUSIVE/CANDIDATE_LIMIT`, 재현 실패는 `INCONCLUSIVE/REPRODUCTION_FAILED`, 격리 backend/이미지 미검증은 `BLOCKED`다. 전체 상한은 두 후보·120초·모델 8요청이며 기존 broker가 73,552 MICRO_USD 최악 비용을 한 번 예약한다. 미확인 사용량은 전액을 소비하고 실패 이력을 초기화하지 않는다.

terminal `NO_CHANGE`에는 `DURABLE_TERMINAL_WINS`를 적용한다. 기록 직전 kill/clock gate를 통과해야 하며 원장과 외부 checkpoint persist가 모두 성공한 뒤에는 같은 `NO_CHANGE`와 NORMAL/EXTERNAL_FAILURE를 반환한다. 그 완료 순간 도착한 stop/clock 변화로 불법인 `NO_CHANGE→BLOCKED` 보상 전이를 만들지 않는다. 완료 뒤 새 외부/후보 작업도 없다. checkpoint persist가 실제로 불확실하면 `ACCOUNTING_UNCERTAIN`을 유지하고 자동 복구하지 않는다. 완료 전 정산 경계에서 감지된 stop/기한 초과는 기존 BLOCKED로 남긴다.

새 외부 실행 전에는 남은 시간이 해당 고정 실행과 cleanup 상한을 모두 덮어야 한다. 컨테이너 한 번의 create/inspect/final-inspect/rm은 각 5초이고 start는 agent 3초/native 15초이므로 합계는 23초/35초다. agent 검증에는 info/image 각 5초와 최초 local endpoint 조회 5초를 더해 38초, native 검증에는 info/두 image 조회 15초와 isolation/runtime probe 각 35초를 합쳐 85초를 확보한다. 모델 요청 전에는 30초를 확보한다. 각 외부 실행 await 뒤와 활성 상태 승격 전후에도 동일한 전체 monotonic deadline과 kill switch를 재검사한다. terminal NO_CHANGE는 위의 durable commit 정책을 따른다. 로컬 파일·문법 처리·내구 기록의 OS 정지는 별도의 실시간 보장이 아니며, 그 작업이 시간을 넘기면 후속 후보 실행이나 성공 승격을 허용하지 않는다. 실행 중인 컨테이너는 기존 3초/15초와 cleanup 경계로 끝내며 새 capability로 대체하지 않는다.

### 신뢰된 호출자의 순서

1. 전용 합성 디렉터리에서 `LocalRsiLedger.create`를 최초 한 번 호출한다. 원장 밖의 별도 0700 감독기 디렉터리에 `ControllerCheckpointStore.create(path,ledger.checkpoint)`를 저장한다. 이후 재개는 외부에 보관한 동일 기준값으로 `LocalRsiLedger.open`과 `ControllerCheckpointStore.open`을 사용한다. 디스크 최신 head를 자동 채택하지 않는다.
2. `loadSeedAgentSources()`는 두 전략 파일을 문자열로 읽는다. `compileAgentSources(sources)`는 정확한 두 경로의 닫힌 문법 bundle을 만들고 `agentHash`, 모듈 digest와 `compiledDigest`를 반환한다. 호스트에서 전략 module을 import·eval·실행하지 않는다. 변경된 전략의 유일한 import는 repair→`./diagnostic-policy`다.
3. `recoverSyntheticIncident({ledger,checkpointStore,observation,baseSource,agentSources,killSwitch,...})`를 호출한다. 입력은 감독기 소유이며 후보 JSON을 options로 넘기지 않는다. `scenarios`는 고정 fake 진단/패치 자료만 받는다. 진단·패치 결정은 같은 활성 전략 bundle을 실제 컨테이너에서 실행해 얻는다. 후보에게는 공개 소스·익명 합성 관측·허용 편집 영역·선택된 승인 lesson 정책만 전달하며 fixture·oracle·기대 정답·manifest는 전달하지 않는다.
4. native manifest는 고정 경로와 정규화 SHA-256 `605ad858ec0c49edda87c5b733d06bf04c954388bb619a1e81664400d20627ae`로 고정한다. 파일 부재·JSON parse 실패·pin 불일치는 경로나 원문을 노출하지 않고 `BLOCKED/MANIFEST_UNVERIFIED`로 정제하며 예약·후보 실행 전에 멈춘다. 별도 격리 capability의 실제 `DOCKER_CLI` 실행을 사용한다. 소스/입력 hash, 로그 두 pipe의 EOF·오류 0, disposal·cleanup·실행 trace/응답 binding을 확인한다. 후보 JSON이나 주입 transport의 그럴듯한 영수증은 실행 권한이나 복구 근거가 아니다.
5. 모든 원장 mutation 뒤 checkpoint를 `pending` 독점 생성→fsync→rename→디렉터리 fsync로 보존한다. 오래된 기준값, 남은 pending, 불명확한 쓰기는 `BLOCKED/ACCOUNTING_UNCERTAIN`이다. 삭제·재생성·새 pool·새 capability로 실패를 우회하지 않는다. 불완전 native 결과는 `UNKNOWN` 근거와 실제로 도달한 단계까지 보존한다.

반환값에는 상태·계보·candidate 수·정산·외부 실행 근거의 immutable snapshot만 남는다. 원문 소스와 실제 Docker endpoint/home 경로를 기록하지 않는다. `actualRecovery`는 항상 `false`다. 네 CI 영수증은 `LOCAL_SYNTHETIC_CI`이며 네 native 회귀에 연결한 로컬 계약 자료다. 실제 unit/integration/build/Playwright CI를 실행했다는 주장이 아니다.

`lineage.controllerHash`는 고정 감독기·broker·원장·기억·sandbox·공통 backend·정책·package/lock bytes를 묶는다. `lineage.evaluatorHash`는 기존 R2 hash를 대체하지 않고 상위 closure로서 R2 evaluator/contracts/oracle, native executor/wrapper/guard/harness, 공통 backend, 두 평가 manifest·runtime/image·고정 한도를 포함한다. 변경 가능한 두 agent module은 별도 `candidateAgentHash`와 compiled digest에 묶는다.

### R4 연결과 검증

R4의 현재 진입점은 아래 `runSelfImprovement()`다. gen1이 실제 반환한 두 module의 불변 artifact를 catalog에 승격한 뒤, gen1 broker·session·compiled source 객체를 함수 범위 밖으로 전달하지 않는다. 외부 trusted checkpoint로 원장·checkpoint·source store를 새로 열고 catalog에서 exact g1을 다시 읽고 compile해 gen2 improve-agent를 실행한다. 호출자가 g1 source나 hash만 전달하는 방식은 fresh session의 근거가 아니다. 고정 fake 응답을 전달하는 이 seed와 인간 제공 g1/g2 fixture는 실모델 생성·자가수정 효과를 증명하지 않는다.

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

기본 단위 시험은 fresh checkout에서도 ignored manifest 파일에 의존하지 않도록 시험 파일 안의 4 KiB 미만 비실행 JSON snapshot을 사용한다. 이는 이미지·capability·실제 근거를 공급하지 않는 host 계약 fixture다. live 파일 읽기를 금지한 집중 시험으로 이 경계를 확인한다. `RSI_CONTROLLER_PROBE=1`은 그 snapshot을 우회하고 실제 고정 파일을 읽으며 실제 시험은 `unitReads=0/liveReads>0`도 확인한다. 이 시험용 mock은 production 감독기의 manifest 공급·자동 채택 경로가 아니다.

이번 변경은 운영 앱 파일·provider·학생 자료·credential·Cloudflare binding·cron·workflow·의존성을 바꾸지 않는다. 제거는 해당 구현 PR의 범위 revert로 처리하며 합성 기록을 운영 기록으로 승격하거나 기존 운영 데이터를 복원하지 않는다.


## R4: 고정 두 세대의 로컬 자기수정 기전

[Issue #327](https://github.com/taejunyun1/Tasted_it/issues/327)·[PR #328](https://github.com/taejunyun1/Tasted_it/pull/328)의 로컬 연구 도구다. `scripts/rsi/self-improve.ts`의 `runSelfImprovement(options)`는 `g0 → g1 승격 → fresh-open exact g1 → g2 승격`까지만 실행한다. 고정 감독기는 전략이나 정답을 생성·수선·선택하지 않는다. 후보는 순수한 두 agent module만 data로 반환하며, 실행은 기존 고정 Docker sandbox/native evaluator에서 한다. 호스트·CI의 후보 import/eval, 세 번째 세대, 실패 후 다른 완전 후보 탐색은 없다.

### 호출과 저장

신뢰된 호출자가 canonical 절대 경로의 전용 owner0700 상위 디렉터리, 익명 합성 observation, 승인된 고정 fixture 전체, 동일 기억 K/승인 목록, baseSource와 kill switch를 준비한다. source store 경로는 symlink를 포함하면 거절한다. fixture는 두 세대 전체 descriptor의 `sha256(JSON.stringify(fixedCorpus))` 하나로 고정하고 각 세대 배열만 해당 broker에 전달한다. 미래 응답·oracle·manifest는 후보 public input에 전달하지 않는다.

```ts
const result = await runSelfImprovement({
  storage: {
    mode: "CREATE", ledgerPath, checkpointPath, sourceDirectory, receiptDirectory,
    config: {
      schemaVersion: 1, environment: "LOCAL_SYNTHETIC", campaignId,
      currencyUnit: "MICRO_USD",
      limits: { incident: 147104, campaign: 147104, day: 147104, month: 147104 },
    },
  },
  observation, baseSource, fakeFixture,
  memory: { snapshot: approvedK, approvals: trustedApprovals },
  killSwitch: () => stopped,
});
```

위 한도는 사전 고정하는 **전용 로컬 합성 검증** 예시다. 기존 낮은 config를 올리지 않으며 paid GO가 아니다. 같은 LocalRsiLedger의 R1+R4 미정산·확정·AMBIGUOUS를 incident/campaign/AsiaSeoul 일·월에 함께 합산한다. 세대당 단일 pool73,552, 두 세대 최대147,104 MICRO_USD다. gen1 quota는 baseline2/generate4/promotion2, gen2는 baseline0/generate6/promotion2이며 전체8·생성 canonical ceiling6을 넘지 않는다. 첫 완전 proposal에서 탐색을 끝내고 남은 quota를 채우지 않는다.

`storage.mode:"OPEN"`은 caller가 보관한 `trustedCheckpoint`를 요구한다. 이미 R4 실행이 있으면 완료·실패·미완료 여부에 관계없이 `RESTART_FORBIDDEN`이며 자동 재개·재예약·replay·seed fallback은 없다. 같은 실행 안에서 gen1이 정상 정산·승격·외부 checkpoint를 모두 끝낸 경우에만 내부 gen2 fresh open이 허용된다. catalog는 원장의 같은 append-only event에서 파생하며 raw source는 owner0400 불변 source artifact에만 보관한다.

입력·compile 전부터 세대별 root deadline120초를 시작하고 gen2 fresh IO보다 먼저 새 root를 캡처한다. 하위 helper는 시계를 초기화하지 않는다. 기존16k 입력/2k 응답·30초 호출·38/85/23/35초 사전 admission, await 후와 commit 전 gate를 유지한다. 파일·compile·fsync의 hard real-time 보장은 없다.

### 결과·중단·복원

반환 shape는 `schemaVersion/mode/actualRecovery/status/reasonCode/failureCode/completedGenerations/generations/checkpoint/lastPublished/receiptPaths/receiptUncertain`다. `actualRecovery:false`와 `mode:"LOCAL_SYNTHETIC"`을 유지한다. 각 generation summary는 execution/intent/source hash, phase별 실제 호출 수와 실제 정산을 담는다. receipt는 intent/closure·source reference·K/승인 digest·broker calls·generation/validation binding·catalog·외부 checkpoint·기억 선택/거절 근거를 최대64KiB씩 독점 생성한다. 원문 model/source/비밀값은 공개 receipt에 넣지 않는다. `failureCode`는 고정 allowlist의 오류 이름만 보존하고 나머지는 `UNKNOWN_ERROR`다. source/evidence private artifact를 공개 결과와 구분한다. private repair sink는 agent/native EVIDENCE마다 execution/phase/source/context/순번·입출력 digest·native UNKNOWN/exit/EOF/timeout/cleanup metadata를 제한된 불변 telemetry로 먼저 저장한다. 원문 error/stack/header는 제외하며 이 기록은 PASS나 실행 권한이 아니다.

- `COMPLETED`: 두 세대의 ledger+외부 checkpoint 승격 완료. 실모델 효과나 운영 성공을 뜻하지 않는다.
- `BLOCKED`: 실제 도달한 실패 단계와 이전 완료 사실을 보존한다. gen2 실패면 g1을 유지하고 원장·비용·거절을 삭제하지 않는다. 초기 입력/시계 거절처럼 저장소를 열기 전 실패에는 disk receipt가 없을 수 있다.
- `PARTIAL/RECEIPT_UNCERTAIN`: 승격은 durable 완료됐지만 이후 receipt/메타데이터 저장이 불명확하다. 완료된 catalog와 정산을 취소하거나 거짓 회계 실패로 바꾸지 않고 후속 gen2를 차단한다. 마지막 published catalog는 완료 사실이며 불확실한 최신 disk head를 뜻하지 않는다.
- 중단은 `killSwitch`를 통해 새 action gate에서 처리한다. 정상 승격 persist 뒤 늦게 도착한 stop은 완료 사실을 번복하지 않는다. 쓰기 불명확성·`.pending`·lock·checkpoint 불일치는 보존하고 자동 복구하지 않는다.

명시적인 로컬 rollback은 `rollbackSelfImprovement({storage:{mode:"OPEN",...paths,trustedCheckpoint},killSwitch})`다. fresh open 후 `rollbackLabCatalog`가 즉시 이전의 **실제 검증된** source만 다시 읽고 compile해 append-only CAS commit한다. 호출자가 목표 source/hash를 고르지 않는다. 새 모델·예약·비용 삭제 없이 g2→g1, 별도 다음 action으로 g1→g0가 가능하다. 코드 제거는 PR 범위 revert이며 기존 Worker·학생·운영 데이터 복원 작업은 없다.

### 실제 실행과 효과의 경계

기본 `pnpm test tests/unit/rsi-self-improve.test.ts`는 주입된 host 계약 시험이다. 해당 fixture의 `DOCKER_CLI` 문자열은 실제 실행 근거가 아니다. actual opt-in은 승인된 비민감 run-plan에 전용 campaign·저장 경로·원본 pin·코드/fixture/K digest·상한·명령을 먼저 고정한 뒤 다음 단일 시험만 실행한다. 기존 b035 native image/원본 canonical manifest605ad858…가 검증되지 않으면 BLOCKED이며 rebuild/pull/새 pin 채택을 하지 않는다.

```sh
RSI_R4_PROBE=1 RSI_R4_PROBE_DIRECTORY='/canonical/private/run-directory' \
RSI_R4_PROBE_CAMPAIGN='predeclared-campaign-uuid' \
pnpm test tests/unit/rsi-self-improve.test.ts -t 'actual pinned g0 to fresh g1 to g2 local mechanism'
```

실패하면 원장·비용·부분 파일·receipt를 그대로 보존하고 원인/범위부터 조율한다. 같은 campaign 초기화, 이름만 바꾼 재실행, 성공할 때까지 blind retry는 하지 않는다. backend 부재·SKIP·UNKNOWN을 성공으로 세지 않는다. 정상 actual 하나가 변조·중단·불명확 usage·partial persist 등 모든 negative 분기까지 실행한 것은 아니다.

R4 검증의 기억은 빈 승인 K/lesson0이며 사용은 `UNCONFIRMED`다. 선택·전달과 실제 적용/학습을 구분한다. g1/g2 source 자체는 인간 제공 fixture이므로 실제 연결이 통과해도 모델 코드 생성·H3·새 원인 일반화·비용 대비 개선 효과는 미측정이다. 같은 receiver 개발 family 반복을 독립 근본원인으로 세지 않는다.

R5는 실모델과 서로 다른 개발 사건의 F1/F2 대조 효과, 고정 독립 평가/holdout, 원격 계정 원장·실제 비용·데이터·자격증명 경계를 별도 한정 GO로 정해야 한다. 효과 미확인·안전 실패는 HOLD다. R6 운영 연결과 배포·라이브 RSI는 그 후속 승인 범위이며 이 PR은 provider/Cloudflare/학생·메일/credential/DB/cron/binding/workflow/운영 권한·배포를 확장하지 않는다. 중지된 학생 감시도 재개하지 않는다.


### 2026-10-23 실제 수용 상태: HOLD

실제 고정 이미지로 시작한 두 흐름 모두 `BLOCKED`로 끝났고 g1/g2 승격은 0회다. 실제 fresh exact g1→g2의 연결은 확인하지 못했다. 첫 실패 뒤에는 Issue #327의 범위 조율로 실패 직전 근거를 보존하는 private telemetry와 고정 `failureCode`만 추가했다. 원래 실패 원장과 정산은 그대로 유지했다.

| 증거 | 최초 실제 흐름 | 승인된 새 버전 진단 1회 |
| --- | --- | --- |
| 코드 | `7602ba3` | `450dd93` |
| 도달 단계 | baseline 검증 후 g0 생성1·proposal1, promotion probe2 호출 뒤 차단 | baseline의 인증 리다이렉트 회귀에서 차단 |
| 호출/합성 확정 정산 | 5회 / 10,635 MICRO_USD | 2회 / 4,352 MICRO_USD |
| 실패 근거 | `EVIDENCE_UNKNOWN`; 원래 세부 gate는 미보존으로 UNKNOWN | `RSI_CONTROLLER_NATIVE_UNKNOWN`; native `RSI_SANDBOX_CLEANUP`, `RM_TRANSPORT/TIMEOUT`, 시작도 TIMEOUT |
| 활성 catalog | SEED, 승격0 | SEED, 승격0 |
| gen2 | 미시도 | 미시도 |

두 번째 진단은 stdout 1,480바이트의 **개수**와 stderr0을 보존했지만 원문은 저장하지 않았다. EOF·cleanup·disposal 완료 값은 미확인(null)이며 PASS로 대체하지 않았다. 즉시 실패 원인은 컨테이너 정리 전송 시간 초과로 확인됐고, 그 근본원인과 첫 실패와의 연관은 UNKNOWN이다. 나중 읽기 전용 조회의 소유 컨테이너 잔존0은 실패 당시 cleanup 확인을 대신하지 않는다. 추가 실제 실행·이미지 변경·자동 cleanup 재시도는 중단했다.

각 흐름의 합성 정산을 별도로 보존하며 합계14,987은 실제 계정 예산이나 원격 통합 원장의 검증이 아니다. 두 흐름 모두 같은 원본 pin·빈 K/lesson0·고정 corpus를 사용했고 실제 지출0이다. 각 코드 버전의 controller15·evaluator16, 합집합21 실파일 SHA를 별도 읽기로 대조했다. 이 closure 일치는 실패한 두 세대 수용을 성공으로 바꾸지 않는다.

`450dd93`의 별도 검증은 unit1회 1,561 PASS/52 SKIP(167파일), typecheck/build 통과, production audit0/dev포함 기존35건이다. 실제 opt-in을 건너뛴 기본 단위 결과를 실제 컨테이너 성공으로 해석하지 않는다. 두 번째 actual은 01:17:05 KST 시작/24.64초, default unit은 01:17:37 시작/31.55초로 실행 시간이 겹치지 않았다. 이 시각 관계만으로 시간 초과의 원인을 단정하지 않는다.


### 2026-11-13 재검증과 고정 native 의존성 분리

기존 [#328](https://github.com/taejunyun1/Tasted_it/pull/328)의 PR 최종 CI `41863632717`과 병합 main CI `41878572018`은 모두4잡 성공이다. 11/04 보고된 `COMPLETED/TWO_GENERATIONS_PROMOTED`와 과거 Docker context·FP64 경계 해결은 Issue #327/#334 및 PR 본문에 남아 있다. 당시 `/private/tmp`의 c9 원자료는 이번 확인에서 찾지 못했으므로 현재 직접 검증과 구분한다.

현재 main471a3eb에서 controller/self-improve/promotion 회귀116 PASS/6 opt-in SKIP를 확인했다. 이어 사전 선언한 단일 actual은 `BLOCKED/GENERATION_FAILED/RSI_NATIVE_ARTIFACT_MISMATCH`로 실행 전 차단됐다(1.00초, 세대0·모델호출0·합성정산0·재시도0). #333에서 추가된 **앱 의존성**이 package/lock bytes를 바꾼 것이 원본 native manifest와 불일치했다. 죽은 Docker socket이나 CLOCK 재발이 아니며 변조 검증이 정상 거절한 것이다. 이 실패 자료는 primary checkout의 gitignored `.superpowers/operations/rsi-r4-verify-20261113-75e6daf0-2b7c-4070-8fad-e672f5fd4588`에 보존했다.

[후속 #357 / PR #362](https://github.com/taejunyun1/Tasted_it/pull/362)은 원본 git741e919의 package/lock을 `scripts/rsi/fixtures/native-runtime/`에 byte 그대로 보존하고, 원본 manifest의 SHA와 별도 내부 고정 SHA를 모두 확인한다. canonical/no-follow·정규파일·bounded read·identity 검증은 Docker verify/build보다 먼저 수행한다. 앱 package/lock과 fixture2개는 controller/evaluator closure에 각각 계속 결속한다. 원본 image·manifest·runtime/oracle·판정/자원한도는 그대로이며 pull/rebuild·유료모델·운영변경은0이다. 원본 고정 이미지 안의 역사적 의존성 위험은 유지보수 대상으로 남으며 앱 production Zod 패치(#361)와 혼동하지 않는다.

최종 코드 `903b918`(#356/#361 main 통합, 운영 Zod4.6.6 독립 frozen/offline 설치)에서 새 run-plan을 사전 선언한 **단일 actual**이 18.34초에 `COMPLETED/TWO_GENERATIONS_PROMOTED`로 통과했다. gen1 5콜·10,635 합성 MICRO_USD CONFIRMED → fresh exact g1 → gen2 3콜·6,108 CONFIRMED, 총8콜·16,743 합성·실비0, 두 세대 PROMOTED·failureCode null·receiptUncertain false다. 이 최종 버전 실행은1회이며 앞선 실패와 실행하지 않은 중간 plan을 별도로 보존했다. primary `.superpowers/operations/rsi-r4-native-fixture-final-20261113-dbe8ef77-273c-4233-ac8d-cc7fa5ab2082`에 원장·run-plan/digests·receipt를 지속 보관한다. 수정 버전 집중215 PASS/53 SKIP·전체1613 PASS/53 SKIP(maxWorkers2), typecheck/build·독립 보안 리뷰를 확인했다. 최종 통합 뒤 집중215/53·typecheck를 다시 확인했다. 파일/fixture/시계·권한·핀을 바꿔 통과시키지 않고 실패는 원장·receipt와 함께 보존한다. `LOCAL_SYNTHETIC` 고정 fixture 성공은 R5 실모델 자기개선 효과나 R6 운영 자율복구의 증거가 아니다.
