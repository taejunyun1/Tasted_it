# RSI R2 고정 합성 평가와 R3 공통 oracle 프로토콜

- 범위: Issue #321, 설계 PR #305의 R2/T3. R1 계약·원장 위에 추가하는 개발 전용 native 재현기다.
- 공통 판정 추출: Issue #323의 R3 Task 2. R2의 고정 실행 API를 유지하면서 별도 격리 executor가 재사용할 순수 oracle을 분리한다. 이 추출 자체는 후보 실행을 추가하지 않는다.
- 실행: 로컬 Node 감독기와 기존 Wrangler가 설치한 Miniflare/workerd. 운영 Worker, 원격 DB, 실모델, 학생 자료·계정·초대·배정·메일을 사용하지 않는다.
- 승인·배포 원본: 병합 Pull Request. 이 문서나 합성 평가 결과는 운영 승인·배포·복구 증명이 아니다.

## 신뢰 경계와 고정 입력

`evaluateFixedCase({ fixture, program })`은 닫힌 enum 2개만 받는다. URL, 원문, 파일 경로, JS/patch, 임의 함수, 추가 속성은 `FAIL / INPUT_REJECTED`로 거절한다. 후보는 manifest, 외부 정답, 평가 코드, 호출 기록을 전달하거나 수정할 수 없다. Worker에는 프로그램 ID에 해당하는 고정 코드만 들어가고 fixture ID·정답은 전달하지 않는다. JS fetch mock은 native 판정 근거가 아니다.

`loadDevelopmentManifest()`는 저장소 내 고정 파일의 **원본 바이트 SHA-256**을 코드에 잠근 값과 비교한 뒤 schema와 사례 관계를 검증한다. `validateManifest(input, expectedHash)`는 신뢰된 사례 관리자용 검증 함수다. 여기서 hash는 입력의 `JSON.stringify` 바이트 hash이며 속성 순서까지 구분한다. 호출자가 정답과 digest를 함께 지정하는 것만으로 신뢰가 생기지 않으므로 실행 함수는 이 입력을 받지 않고 잠긴 파일을 다시 읽는다. schema는 추가 속성, 중복 ID(대소문자 정규화), fixture/원인 계열/정답 불일치를 거절한다. 입력 오류에는 원문·Zod 상세 오류를 노출하지 않는다.

로컬 관리자가 evaluator·manifest·pin을 함께 바꾸는 공격까지 막는 보안 격리는 R2에 없다. 저장소 변경 리뷰가 현재 신뢰 경계다. Node 실행 권한과 로컬 파일 접근 권한을 가진 임의 생성 코드를 여기서 실행해서는 안 된다.

## 사례, split과 오염 정책

| 고정 fixture | 원인 계열 | 기대 판단 |
| --- | --- | --- |
| `NATIVE_RECEIVER` | `NATIVE_RECEIVER` | 실제 native receiver RED 및 bind 구현 GREEN |
| `NORMAL` | `NORMAL` | 정상 여섯 경로, `NO_CHANGE / NORMAL` |
| `HTTP_FAILURE` | `UPSTREAM_HTTP` | `/places`의 합성 503을 실패로 관찰, `NO_CHANGE / EXTERNAL_FAILURE` |
| `AUTH_REDIRECT_FAILURE` | `UPSTREAM_AUTH` | `/admin`의 잘못된 Location을 실패로 관찰, `NO_CHANGE / EXTERNAL_FAILURE` |
| `AUTH_STATUS_FAILURE` | `UPSTREAM_AUTH` | `/admin`의 합성 200을 실패로 관찰, `NO_CHANGE / EXTERNAL_FAILURE` |

모든 고정 사례는 `DEVELOPMENT`다. 알려진 native receiver 사건은 `SELECTION`·`FINAL`로 이동할 수 없다. 사례 ID를 바꿔도 동일 `rootCauseFamily`를 여러 split에 배치하면 검증이 실패한다. 같은 계열의 알려진 변형(특히 두 auth 사례)은 독립 성능 표본으로 세지 않는다. 숫자 5는 fixture 수이며 새로운 장애 계열 5개의 일반화 성능을 의미하지 않는다.

향후 private oracle은 공개 개발 manifest와 별도로 보관하고 후보에게 정답·source를 공개하지 않아야 한다. 분할 전에 원인 계열을 고정하고 전체 집합에 걸쳐 중복 검사해야 한다. 선택/최종 사례를 열람·튜닝에 사용하면 오염으로 기록하고 해당 최종 평가를 폐기한다. 잠금 변경은 별도 PR에서 이유·기존/신규 digest·계열·소유자를 기록한다. 이 R2는 숨긴 최종 집합을 만들거나 공개하지 않는다. 외부에서 꾸민 임의 계열 이름의 의미적 동일성까지 자동 검출한다는 주장은 하지 않는다.

## native 실행과 외부 판정

고정 `UNBOUND`는 workerd의 native fetch를 다른 객체의 메서드로 호출한다. native `TypeError / Illegal invocation` 6개, 여섯 실패 결과와 실제 outbound 0회를 함께 확인한 경우에만 `FAIL / NATIVE_RECEIVER_REPRODUCED`, `redReproduced: true`다. `BOUND`는 `fetch.bind(globalThis)`로 고친 고정 합성 구현이다. 이는 현재 app 소스를 통째로 실행하는 운영 검증이 아니다.

정상 계약은 `/`, `/places`, `/login`, `/robots.txt`, `/privacy`의 200과 `/admin`의 **302, Location `/login`**이다. `/admin`은 자동 redirect를 따르지 않는다. 로컬 oracle은 Location을 정확히 비교한다(현재 앱의 부분문자열 검사보다 엄격한 고정 합성 계약). 외부 oracle은 결과 객체 schema, 결과 6개·고유 경로, 실패 수·전체 ok, 실제 요청 수 6회·경로별 1회·GET·허용 origin, 각 응답 status/Location과 보고 내용의 일치를 검사한다.

공통 구현은 `scripts/rsi/oracle.ts` 한 곳에 있다. `expectedRsiFixtureResponse(fixture, path)`는 위 표의 고정 합성 status/Location을 반환하고, `gradeRsiPublicPathCheck(fixture, body, calls)`는 결과와 독립 측정 trace를 비교한다. 실제 앱 결과와 같은 네 필드 `ok`, `failed`, `originHost`, `results`만 받으며, 합성 originHost는 `rsi.invalid`로 고정한다. 각 결과는 `path`, `status`, `location`, `ok`다. trace의 각 행은 `path`, `method`, `status`, `location`, `originAllowed`이며 여섯 행을 요구한다. 모든 객체는 추가 속성을 거절한다. 잘못된 입력은 원문을 노출하지 않고 `FAIL / ORACLE_MISMATCH`로 끝난다. 행 순서는 판정에 영향을 주지 않으며 입력은 수정하지 않는다.

R2의 `receiverErrors`는 고정 프로그램의 계측 전용 다섯 번째 필드다. R2 어댑터가 네 필드 schema를 확장해 이를 검증하고, 알려진 `UNBOUND` RED 분기를 판정한 뒤 계측 필드를 제거해 공통 oracle에 전달한다. 공통 oracle은 `receiverErrors`를 요구하거나 받아들이지 않으며 `redReproduced`는 항상 false다. 공통 PASS는 여섯 계약 비교의 성공만 뜻하고, 정상/외부 실패의 정직한 관찰은 기존처럼 `NO_CHANGE`다.

**호출 trace의 보관·출처 신뢰(custody/provenance)는 이 순수 함수가 증명하지 않는다.** 호출자가 조작한 body와 trace도 서로 맞으면 공통 함수에서 PASS가 날 수 있다. 별도 native wrapper와 감독기가 후보 외부에서 요청을 직접 측정하고, 후보가 trace·정답·판정기를 변경하거나 대신 제출하지 못하게 하며, artifact/import closure·runtime·종료/해제 증거를 연결해야 한다. 공개 helper를 호출한 합성 PASS는 native 실행, 신뢰된 receipt, 실제 앱 복구 또는 개선 효과 증명이 아니다. R2에서는 고정 workerd의 `outboundService`가 직접 기록한 trace만 어댑터에 들어간다.

모든 outbound 요청은 `outboundService`가 합성 응답으로 끝낸다. 허용 경로 밖 요청도 기록하고 합성 403으로 차단한다. 외부 fetch로 넘기는 분기는 없다. 런타임 초기화·dispatch·JSON 읽기 전체에 5초 deadline을 적용하고 `finally`에서 timer와 Miniflare를 해제한다. `TIMEOUT`은 60초 대기하는 고정 프로그램이며 5초에 `INCONCLUSIVE / EXECUTION_TIMEOUT`이 된다. `THROW`와 실행 오류는 `INCONCLUSIVE / EXECUTION_ERROR`, 해제 실패는 `INCONCLUSIVE / CLEANUP_ERROR`다. 이 deadline은 임의 코드의 CPU/메모리 격리를 제공하지 않는다.

검사 생략, 느슨한 status/redirect 검사, 전부 PASS라고 보고, 허용 경로 이탈, POST, 중복 호출, 잘못된 결과 구조는 동일 oracle에서 `FAIL / ORACLE_MISMATCH`다. 후보의 exit 0·PASS 문자열·스스로 고른 테스트를 판정 기준으로 쓰지 않는다. 정상 또는 외부 장애는 검사를 정직하게 수행하면 `NO_CHANGE`이며, 결과를 숨기거나 검사를 망가뜨리면 `FAIL`이다. 외부 장애에서 NO_CHANGE는 장애를 고쳤다는 뜻이 아니다.

## 결과와 R3 연결 경계

결과에는 schema version, 닫힌 verdict/reason code, `manifestHash`, `evaluatorHash`, `programHash`, native runtime 표시, `redReproduced`, `greenVerified`, `expectedNoChange`, 제한된 호출 기록만 남긴다. 원문, body, credential, 운영 URL, stack trace는 남기지 않는다.

- manifest hash: 잠긴 manifest 원본 바이트.
- evaluator hash: `evaluator.ts`, `contracts.ts`, `oracle.ts` 순서로 원본 소스 바이트를 연결한 SHA-256. 로컬 판정 import closure의 세 소스를 포함하며, oracle 변경도 digest를 바꾼다. 외부 `zod`, Wrangler/Miniflare/workerd, Node 내장 모듈, 설치된 전체 의존성·컴파일러·호스트의 attestation은 아니다. 미래 executor/wrapper의 출처와 측정 코드는 별도 신뢰 경계이며 이 hash만으로 포함되거나 검증되지 않는다.
- program hash: 해당 실행에서 실제 workerd에 전달한 고정 script 바이트.
- `WORKERD`: native runtime ready 이후. `NOT_STARTED`: runtime ready 증거 없음.
- `greenVerified`: 독립 검증한 여섯 정상 계약. 정상 `NO_CHANGE`에서도 true일 수 있다.
- `expectedNoChange`: manifest의 사전 기대값. 실제 verdict가 FAIL/INCONCLUSIVE이면 성공한 NO_CHANGE가 아니다.
- GREEN만으로 RED 재현이나 개선 효과를 추론하지 않는다. RED와 GREEN 결과를 함께 읽는다.

R3 감독기는 현재 결과를 로컬 합성 증거로 소비할 수 있다. 임의 source 실행이 필요하면 이 함수에 문자열 허용을 추가하지 말고 별도 승인된 격리 executor를 연결해야 한다. 그 executor가 변경 불가능한 외부 oracle에 원본 실행 측정(후보 artifact/import closure hash, runtime identity, 독립 네트워크 trace, 시간·자원 한도, 종료·해제 결과)을 전달하고, 감독기가 provenance를 검증한 뒤 R1 evidence/ledger에 기록해야 한다. 후보가 만든 receipt나 입력 digest는 실행 증거가 아니다. 현재 R2는 ledger 기록, 모델 개선, 운영 효과 측정을 하지 않는다.

## 재현과 복원

저장소 루트에서 기존 의존성을 설치한 환경으로 실행한다.

```sh
pnpm exec vitest run tests/unit/rsi-oracle.test.ts tests/unit/rsi-evaluator.test.ts tests/unit/rsi-native-fetch.test.ts
pnpm run typecheck
pnpm test
pnpm run build
pnpm audit --prod
pnpm audit
```

첫 명령은 순수 oracle의 네 필드/trace 경계·조작 거절과 기존 workerd RED/GREEN·NO_CHANGE·timeout을 검증한다. 새 oracle 테스트는 변경 가능한 app/candidate source를 호스트에서 import하거나 실행하지 않고 고정 합성 자료만 비교한다. 나머지는 저장소 회귀와 빌드 검증이다. 합성 PASS는 실제 장애 복구, 자기개선 성능, CI 성공, 배포 또는 라이브 운영 성공과 별개다. 기존 개발 의존성 audit 결과는 별도 기록하며 prod 0만으로 전체 audit 통과라고 쓰지 않는다.

이번 추출의 복원은 공통 oracle·R2 어댑터·추가 테스트·문서 변경을 함께 revert하는 것이다. R2 전체 복원은 평가 코드·fixture·테스트·문서를 revert한다. app·migration·binding·cron·운영 설정은 바뀌지 않아 원격 복원 명령이 없다.

## Issue #329: 로컬 transport lifecycle 단일 진단

[PR #330](https://github.com/taejunyun1/Tasted_it/pull/330)은 기존 Docker CLI의 bounded metadata 관측과 native UNKNOWN의 실패 frame 분류를 추가한다. 후보 ABI, oracle·판정, wrapper·runtime image·manifest, 실행 권한과 기존 격리는 그대로다. 이 진단은 로컬 연구 도구이며 운영 Worker 배포나 live RSI 검증이 아니다. 2026-10-23 KST에 고정 checkpoint `e232f37`에서 승인된 단일 측정을 **1회 완료**했다. 결과는 아래에 기록하며 같은 측정을 재실행하지 않는다.

기본 unit은 외부 작업 없이 유지한다. 별도 사례 이름은 `records one pinned transport lifecycle diagnostic without retry`, flag는 `RSI_NATIVE_TRANSPORT_DIAGNOSTIC=1`, selector는 `^records one pinned transport lifecycle diagnostic without retry$`다. flag와 정확 selector가 모두 맞아야 하며 기존 `RSI_NATIVE_PREPARE`, `RSI_NATIVE_PROBE`, `RSI_NATIVE_SHUTDOWN_CONTROL`, `RSI_NATIVE_CAUSE_COLLECTION`, `RSI_NATIVE_DIAGNOSIS`는 값이 `0`이어도 설정하지 않는다. PREPARE/PROBE suite, 기존 cause batch·공유 receipt·capability는 사용하지 않는다. image build/pull은 0회다.

실행 전 전용 `.superpowers/operations/rsi-transport-20261023-diagnostic/`를 새로 만들고 디렉터리 0700, 입력과 실행 artifact 0600을 확인한다. 원본 manifest exact bytes와 추적 main source를 사본으로 보존하며 원본·다른 workspace·R4 WIP·원장은 변경하지 않는다. symlink, 기존 측정 경로 재사용, pin 불일치나 dirty code는 실행 전에 차단한다. source/compiled 사본은 이 private 경로에만 두고 커밋·PR·위키·일반 로그에 올리지 않는다.

| 고정 입력 | SHA-256 |
| --- | --- |
| source | `286873f23839d8587d91ddf9650ec46e8b9b6be0f7e2a7b18e63a4cdeaa85561` |
| compiled | `8988dcc713e76fed9e0684b41a71e09c612dbd4c85c73d1ccc1f7f6c985b2d60` |
| manifest canonical | `605ad858ec0c49edda87c5b733d06bf04c954388bb619a1e81664400d20627ae` |
| image ID | `sha256:b035afe75a5453408f0e878a9405d9f621203acad47763b82372f01d4c958d4b` |

`input-digests.json`에는 manifest 원본/사본 raw digest·byte 수와 source/compiled digest를 기록한다. `run-plan.json`에는 위 pin, 실제 diagnostic/main commit, 저장소 내부 import closure·시험·설정·문서의 개별 digest, private supervisor/watchdog와 입력 metadata digest, 현 host Node/Python/client binary digest, 정확 flag/name/selector와 상한을 실행 전에 고정한다. 이는 전체 설치 dependency나 OS의 attestation이 아니다. 과거 host Node·Docker client identity는 UNKNOWN이며 image 내부 Node와 Docker server profile로 대체하지 않는다. 현재 client version도 별도 Docker 조회 없이 UNOBSERVED로 남긴다.

부모의 내부 safety gate가 one-shot GO를 전달한 뒤, 고정한 private watchdog을 저장소 루트에서 한 번 실행한다.

```sh
python3 .superpowers/operations/rsi-transport-20261023-diagnostic/watchdog.py
```

watchdog은 그룹 밖의 독립 Python 프로세스다. `Popen(start_new_session=True)`로 새 supervisor session/group을 직접 만들고 메모리에서 생성·상속을 확인한 뒤 Vitest를 시작한다. Vitest는 `--pool=threads --maxWorkers=1 --no-file-parallelism --retry=0 --bail=1`과 위 정확 selector를 사용한다. 기존 CLI spawn의 group 상속은 유지하고 transport를 감싸거나 default singleton을 교체하지 않는다. PID/group ID, argv, endpoint/env 값은 출력·저장하지 않는다. supervisor/Vitest stdout·stderr는 `/dev/null`로 보내며 예외·stack·source excerpt를 보존하지 않는다.

단일 monotonic 기준은 supervisor 생성 전부터 시작한다. 140초에 소유 group에 TERM, 145초에 KILL을 요청하고, signal·고정 grace·증거 drain을 포함해 150초에 관측을 끝낸다. 조기 supervisor 오류는 같은 group에 TERM을 요청하고 기존 145/150초 경계 안에서 종료한다. 이름 검색·전역 kill/prune·추가 rm·post-stop Docker 조회는 0회다. OS 스케줄링, kill 성공, close 도착이나 container 삭제의 hard real-time 완료를 보장하지 않는다. 관측 종료 뒤 삭제 부재는 항상 UNOBSERVED이며 내부 quarantine 확인과 외곽 재사용 금지 기록을 구분한다.

호출은 default `NativeExecutor.verify()` **1회(기존 2 probes)**를 await하고, 성공과 진단 무결성이 확인된 경우에만 무수정 source로 `AUTH_REDIRECT_FAILURE` evaluate **1회**를 await한다. 최초 실패·UNKNOWN 뒤 retry·재verify·다른 fixture·추가 후보는 0회다. 고정 호출 그래프의 최대치는 endpoint 선택 cache 1 + 공통 admission 3 + container lifecycle 3×5 = **19 Docker commands / 3 containers**다. 각 lifecycle의 create→inspect→START→cleanup inspect→RM 순서와 START 15초·inspect/RM 5초·native wrapper 12초를 유지한다. observer ordinal/count는 이번 관측의 증거이며 실행 상한이나 차단 권한이 아니다. trace 누락 시 정적 최대치를 실제 실행 count로 쓰지 않는다.

observer는 동기 `void` 함수이며 자체 try/catch 안에서 ordinal별 최신 닫힌 schema snapshot만 보존하고 finally에서 등록을 해제한다. 명령별 event 최대 64개, 출력 chunk는 first/last/count/bytes 집계만 남긴다. observer/저장 오류·누락은 진단 UNKNOWN이다. metadata/result에는 검증한 enum·digest·boolean·bounded count만 기록하며 raw stdout/stderr·원문 source·예외·secret은 넣지 않는다. 특수 Promise의 getter/rejection까지 격리한다는 보장은 없고 이 observer는 Promise/thenable을 반환하지 않는다.

정상 실행의 control 기대값은 **NO_CHANGE / EXTERNAL_FAILURE**다. 실제 DOCKER_CLI, 요청 6회, dispatchAttempts/childSpawns 각 1, native log 유효성, stdout/stderr 자연 EOF, pipe error·premature close 0, deadlineExpired false, disposalConfirmed·backend cleanupConfirmed와 owner/name/ID 일치를 각각 확인한다. 이를 PASS/수리 효과로 바꾸지 않는다. 완성 EVALUATION frame이 있어도 START/cleanup 실패는 UNKNOWN이며 opt-in 시험도 실패로 끝난다. host stdout/stderr 읽기 오류는 첫 실패가 없으면 `UNAVAILABLE`로 고정하고 기존 CLI close 시점에 거절한다. 이후 timeout·출력 한도가 첫 실패를 덮지 않으며 새 kill/timer나 quarantine 조건은 추가하지 않는다. 유효 frame과 close code 0도 native UNKNOWN·greenVerified=false를 바꾸지 않는다. runner exit 0, native verdict, 진단 무결성, 과거 근본원인은 서로 별도 값이다. nativeReady/nativeDispatch 시각은 UNOBSERVED이며 host spawn/stdin finish/exit/close로 대신하지 않는다. host/daemon clock offset 미검증 상태에서 절대시각 인과 결합을 하지 않는다.

단 한 번 control이 관측되어도 과거 START TIMEOUT과 독립 RM TIMEOUT의 원인·1480B frame 정체·과거 EOF/삭제 완료는 UNKNOWN이다. R4 HOLD를 유지하며 반복 안정성·모델 성능·R4 수용·운영 복구를 주장하지 않는다. 실패 artifact와 입력/code binding은 private로 보존하고 재실행하지 않는다. 복원은 #329 변경을 revert하는 것이며 원래 실패 원장·image·manifest를 고쳐 덮지 않는다. 별도 실제 container 정리는 이 측정의 권한에 포함하지 않는다.

### 2026-10-23 단일 측정 결과

독립 safety 재검토와 부모의 one-shot GO 뒤 `e232f37b198af98a3c852d2d6fd40af32a16de89`의 코드·시험·감독기를 고정해 실행했다. default verify 1회(기존 probes 2회)와 `AUTH_REDIRECT_FAILURE` evaluate 1회가 완료됐고 **NO_CHANGE / EXTERNAL_FAILURE, greenVerified=false**를 관측했다. 이는 합성 외부 auth 실패를 정직하게 보고한 정상 control이다.

| 증거 | 이번 관측 |
| --- | --- |
| 실제 명령·container | ordinal 1–19 연속, CREATE/START/RM 각 3회, container 3개. admission 14명령의 두 probe trace 확인 뒤 evaluate 5명령 |
| 감독·종료 | watchdog monotonic 1,841ms, runner exit 0·supervisor exit 0·외곽 exit 0, group 생성·child 상속 확인, control pipe drain 완료. TERM/KILL 요청 0회 |
| native 실행 | DOCKER_CLI, 요청 6회, dispatchAttempts/childSpawns 각 1, redReproduced=false |
| native custody | stdout/stderr 자연 EOF, pipe error·premature close 0, log valid·warning 1·rejected 0, deadlineExpired=false, disposalConfirmed=true |
| cleanup | 세 RM의 CLI close code 0. 평가 container의 backend cleanupConfirmed=true, cleanup inspect 반환·owner/name/ID 일치·RM 호출/반환 모두 true |
| 관측 무결성 | observerError/persistenceError=false, 모든 CLI의 exit/close code 0·두 pipe EOF, timer/kill 관측 0. source/compiled/manifest digest가 고정 pin과 일치 |

nativeReady/nativeDispatch 시각, 별도 post-stop 부재, 과거 host/client identity와 과거 근본원인은 계속 UNOBSERVED/UNKNOWN이다. 이번 평가 START의 stdout 1,480B는 해당 checkpoint의 정상 receipt로 검증됐지만, 과거 출력과 byte 수가 같다는 사실은 같은 frame·원인을 입증하지 않는다. 독립 watchdog의 control pipe drain과 native EOF는 별도 증거다. 정상 종료로 140/145초 signal 경로는 실제 시험하지 않았다. 재시도·post-stop Docker 조회·image build/pull·운영·모델 호출은 0회다.

실제 checkpoint `e232f37`부터 `947c81e`까지는 결과 문서만 변경했다. 이후 PR 최종 검토 I1에 따라 host stdout/stderr 읽기 오류의 fail-closed 처리를 보완하고 무외부 단위 회귀로 확인했다. 따라서 수정 후 실행코드·시험은 실제 checkpoint와 다르며 **수정 후 코드의 actual 검증은 수행하지 않았다**. 원래 1회 측정의 입력·plan·helper·lock·metadata·결과는 다시 결속하거나 덮어쓰지 않았고 추가 actual은 0회다. 당시 정상 trace의 host read-pipe 오류 0은 새 오류 경계의 실제 검증을 대신하지 않는다. R4 HOLD·학생 감시 중지를 유지하고 PR #330 완료 후 대기한다.
