# RSI 후보 소스의 로컬 네이티브 실행

**상태: fix round1 검증 완료·독립 재검토 대기(2026-10-22).** EOF 보강 이미지의 전체 검사는 110 PASS/1 FAIL/4 skip였다. 한 실패는 모듈 초기화에서 타이머를 예약한 대조군의 ready 단계 EXIT88이며, 원래 영수증을 보존했다. 예약을 요청 처리 함수 본문으로 옮긴 수정 대조군 한 건은 같은 이미지에서 PASS(6호출·양 EOF·marker0·dispose/cleanup 확인)했다. 다른 통과 사례는 재실행하지 않았다. Task3 최종 승인과 I1/I2 해제는 독립 재검토로 판정한다.

이전 이력: 종료 deadline 범위를 보완한 이미지411의 전체 실제 검사는 generator-constructor 사례의 `RM_TRANSPORT/TIMEOUT` 정리 UNKNOWN과 후속 capability 격리로 중단됐다. EOF 보강이 그 실패의 원인을 설명하거나 Docker 정리 문제를 해결했다는 주장은 없다. 기존 UNKNOWN/BLOCKED와 진단32건을 보존하며, 이후 성공이나 컨테이너 부재를 과거 정리 성공으로 소급하지 않는다.

Issue #323의 평가기는 한 파일의 가상 후보를 별도 Docker/workerd에서 평가한다. 선행 Issue #324 / PR #325의 workerd `1.20261022.1`, 최대 지원 날짜 `2026-10-22`, 목표 날짜 `2026-08-05`와 두 compatibility flag를 유지한다. 지원 날짜가 부족한 manifest는 `RSI_NATIVE_COMPATIBILITY_UNSUPPORTED`로 거절한다. 실제 실행 영수증은 로컬 합성 자료의 증거이며 운영 복구·배포·자기개선 효과의 증거가 아니다.

## 허용 범위와 신뢰 경계

- 후보는 `app/features/operations/rsi-self-check.ts` 한 파일의 가상 소스만 받는다. 원본 앱 파일, 서버 모듈, 다른 경로는 수정·실행하지 않는다.
- 호스트는 기존 Babel 파서와 esbuild로 문법과 import 폐쇄성을 검사한다. 호스트에서 후보를 import/eval하거나 함수로 실행하지 않는다. 코드 검사 자체가 보안 격리는 아니다.
- 실제 후보 실행은 네트워크가 없는 Linux 컨테이너 안의 workerd V8 isolate에서만 한다. 명시적 모듈 목록은 고정 guard, 호출 harness, 후보 모듈이다. 후보의 새 static/dynamic import, require, eval/Function 및 import.meta를 문법 단계에서 거절한다.
- 고정 harness의 첫 의존성인 guard가 후보의 최상위 코드보다 먼저 실행된다. trusted `node:process`의 `getBuiltinModule`, 전역 Function/eval, Function·AsyncFunction·GeneratorFunction·AsyncGeneratorFunction의 constructor를 변경할 수 없는 deny로 제한한다. pristine console.warn과 필요한 내장 참조를 먼저 capture하며, 호출 시 고정 표식을 기록한 뒤 throw한다. 후보가 예외를 잡거나 console·함수 prototype을 바꿔도 표식이 원시 로그 거절에 반영된다. guard의 내부 참조를 후보에 전달하지 않는다.
- **이 guard는 평가기에 추가된 제한이다.** 날짜·flags가 같아도 무수정 운영 환경과 완전히 동등하다는 뜻은 아니다. guard·harness·wrapper·oracle은 manifest 및 이미지 digest로 고정하며 후보가 바꿀 수 없다. 동적으로 감춘 API 탐지를 문법 검사만의 보안 보장으로 해석하지 않는다.
- Node wrapper, 순수 oracle, 기대 응답, 실제 호출 trace와 실행 영수증은 Worker 밖에 있다. Worker에 환경 비밀값, DB, 외부 네트워크, 운영 데이터나 숨긴 정답을 주지 않는다.
- 요청 URL의 origin과 query는 신뢰된 outbound broker가 검사하며, 원본 query/body/header/로그를 영수증에 보관하지 않는다. 합성 응답만 반환한다. Worker의 PASS 주장, console 출력과 exit 0은 검증 증거가 아니다.
- `VerifiedContainerBackend`가 endpoint 고정, 이미지·기반 layer 검증, 보호된 wrapper 파일 확인, PID 1 watchdog, 자원 제한과 소유권 기반 정리를 맡는다. native executor는 이 로직을 복제하지 않는다.

## 준비와 실행

명시적 준비 명령:

```sh
RSI_NATIVE_PREPARE=1 pnpm test tests/unit/rsi-native-executor.test.ts
```

준비 과정만 기존 registry의 의존성 다운로드를 허용한다. 최소 임시 context에는 원본 `package.json`, `pnpm-lock.yaml`, 고정 wrapper/oracle/contracts의 번들과 고정 Dockerfile만 넣는다. 전체 저장소, 후보·앱 소스, 홈 폴더, Docker socket, credential은 넣지 않는다. 기존 Node digest를 사용하며 자동 pull은 하지 않는다. 원래 manifest의 고정 `pnpm@10.34.5`를 Corepack으로 사용하고 `--frozen-lockfile --ignore-scripts`로 설치한다. Docker 설정이 전달할 수 있는 대소문자 proxy build argument 10개는 명시적으로 빈 값으로 덮는다. 런타임 실행에는 네트워크를 허용하지 않는다.

고정 Dockerfile은 pinned Node `22.23.2`에 내장된 공개 Mozilla root snapshot만 CA bundle로 직렬화한다. root 소유·mode 0444를 검사하고, 실행 시 동일 Node 내장 roots의 정확한 bytes와 대조한다. 145개, SHA-256 `e3569ed5bde6e59d7718cd962b1f07a95ab0a4226a9fc35a18d8f586f98ea6a4`이며 별도 pinned base 컨테이너의 내장 roots와도 비교한다. host/system/env CA 복사, 추가 package/download, TLS 검증 비활성화는 없다. 원문 인증서는 영수증·로그로 출력하지 않는다.

완성된 준비 manifest는 `.superpowers/sdd/r3-implementation-plan/native-manifest.json`에 남는다. 이미지 ID, 기반 digest, 원본 package/lock/wrapper/oracle/contracts/Dockerfile/harness/guard digest와 Node/Miniflare/workerd/플랫폼/지원 날짜/실행 파일·공개 CA digest/count를 기록한다. 이미지 준비 성공과 실제 후보 수용은 별도 증거다.

명시적 실제 실행 검사는 다음 명령이다. 합성 정상·장애·적대적 후보만 사용한다.

```sh
RSI_NATIVE_PROBE=1 pnpm test tests/unit/rsi-native-executor.test.ts
```

기본 단위 테스트는 실제 Docker를 호출하지 않는다. `INJECTED_TRANSPORT`는 모의 연결임을 영수증에 남기며 결과를 `UNKNOWN`으로 제한한다. 실제 Docker 실행 여부와 oracle 결과는 서로 다른 증거다.

호스트 API는 `compileNativeCandidate({path,source,sourceDigest})`, `prepareNativeRuntimeImage()`, `nativeArtifactDigests()`, `NativeExecutor.verify(trustedManifest, transport?)`다. 검증된 executor의 `diagnose("CURRENT"|"REGRESSION")`는 고정 trusted Worker만 실행하며 후보 dispatch는 0이다. `evaluate({path,source,sourceDigest,fixture})`만 후보를 받으며 fixture는 NATIVE_RECEIVER/NORMAL/HTTP_FAILURE/AUTH_REDIRECT_FAILURE/AUTH_STATUS_FAILURE다. image/command/limits/guard/실행 옵션은 후보 입력이 아니다.

원시 로그는 trusted Node wrapper에서 검증된 workerd 경로의 spawn 한 번만 관찰한다. 예상외 명령·재시작은 실행 전에 거절하며 기존 args/stdin/control fd/env는 바꾸지 않는다. stdout/stderr를 Miniflare 표시 필터 전에 합계 32 KiB로 제한하고, dispose 뒤 child의 close까지 기다린 후 판정한다. spawn 관찰은 finally에서 복구한다. 정확한 기본값 안내(134바이트, message digest `64fece35c0759aa79ea14d8c6eaa120bb1c9ea4f7c96dfc86e7399b3c80fc4a2`, C++ source-field digest `92e682819efef622f66f2610b473213c00b60311f53e0d3a41c280bbb7fe25a2`) 한 건만 준비 완료 전에 허용한다. count/level/출처/시점을 모두 확인하며, 일반 prefix·level 무시는 없다. 추가 안내·console 모방·구조 위조·Miniflare 필터 문구·미지/TLS 오류·불완전 JSON·초과 출력은 거절한다. 원문은 메모리에서만 처리하며 count/digest/고정 reason만 남긴다.

## 한도와 판정

native 상한은 메모리 512 MiB, tmpfs 64 MiB, CPU 1개, PID 64개, wall 15초, 출력 32 KiB, 입력 100,000바이트다. Node wrapper heap은 공통 실행부의 64 MiB다. 이는 측정용 유한 상한이며 최적값이라는 주장은 없다. 기존 R2 Node profile의 한도는 변경하지 않는다.

준비 완료 뒤 trusted Node wrapper가 dispatch 시도 수를 세며, 후보의 표식 수와 분리한다. `dispatchAttempts:1`은 외부 감독기가 dispatch를 시도했다는 뜻이다. 후보가 특정 API를 실행했다는 단독 증거는 아니다. 금지 API 검사는 준비 뒤 실행되는 후보와 잡힌 예외 변형의 고정 표식·원시 로그 거절·독립 trace·종료/정리를 함께 검사한다. 후보가 표식을 흉내 낸 경우도 FAIL이며 API 차단 증거로 세지 않는다. 무한 실행·타이머 대기는 내부 12초 deadline이 검증된 workerd child 하나만 종료하고 dispose 및 기존 컨테이너 정리를 수행한다. 이 타이머는 dispatch부터 dispose와 child stream close를 모두 기다리는 전체 finally까지 유지한다. 종료가 풀리지 않으면 외부 15초 watchdog에 의해 UNKNOWN으로 제한되며, 만료는 성공이 아니다. wrapper OOM/사망이나 영수증 부재는 UNKNOWN/dispatch 미확인이며 안전한 종료 차단과 해당 후보 API의 실행 입증을 구분한다. 현재 이미지의 후반 자원 검사는 정리 실패에 따른 격리로 도달하지 못했으므로 구현을 실제 수용 완료로 보지 않는다.

`PASS`는 검증된 별도 이미지·런타임·실제 연결·oracle 조건을 모두 충족한 로컬 합성 실행에만 해당한다. 정상 또는 외부 장애 fixture의 일치 결과는 `NO_CHANGE`다. timeout, 불명확한 정리, 모의 연결, 영수증 불일치 또는 실행 오류는 `UNKNOWN` 또는 capability 거절이며 성공으로 승격하지 않는다. `redReproduced`는 항상 false다. 실제 RED→GREEN의 관계는 동일 supervisor가 각각의 소스·영수증을 연결해 별도로 입증해야 한다.

실제 RED는 입력 객체의 fetch 메서드를 직접 호출하는 잘못된 receiver이며 oracle FAIL/호출 0개다. bind 소스는 독립 trace 여섯 경로·올바른 응답/권한 조건을 만족해야 GREEN이 된다. 정상/외부 장애 fixture와 검사 약화·경로 이탈·로그 위조·금지 API·자원·정리 반례는 같은 새 이미지에서 따로 검사한다. 과거 부정확한 receiver 재현, CA 누락, 경고 분류 실패와 guard 전 우회 영수증은 삭제하지 않는다. API 시도가 실행되기 전에 문법 단계에서 거절된 경우, 실제 후보가 거절된 경우, timeout/준비 실패로 dispatch 증거가 없는 UNKNOWN을 구분한다. dispose 후 실행되지 않은 timer를 API 차단 증거로 세지 않는다.

## 보존·정리·복원과 제한

임시 build context는 준비 함수의 finally에서 제거한다. 소유 컨테이너는 backend가 정확한 name/owner/ID를 대조한 후 제거하며 불명확하면 해당 capability를 격리한다. 최종 고정 이미지는 후속 검증을 위해 로컬에 남는다. 실패한 준비 이미지와 Docker build cache도 남을 수 있으며 전체 prune을 하지 않는다. 제거할 때는 준비 기록에 있는 해당 이미지 ID만 지정하고 다른 작업의 이미지·컨테이너는 건드리지 않는다.

공통 backend의 `RSI_SANDBOX_CLEANUP` 메시지·한도·격리 동작은 유지한다. 추가 진단 cause는 INSPECT_TRANSPORT/INSPECT_EXIT/INSPECT_JSON/INSPECT_OWNERSHIP/RM_TRANSPORT/RM_EXIT 단계와 고정 failure enum만 제공하고 native 경계에서 다시 검증한다. 인자·ID·원문 출력·daemon 오류·소켓·환경값은 진단에 넣지 않는다. 관측 보강 전 실제 정리 UNKNOWN 두 건과 준비 BLOCKED 두 건은 과거 불확실 기록으로 남긴다. 별도 주입 경로의 고정 NORMAL 여덟 회(명령 53개, 소유 컨테이너 열 개 부재 확인)는 원인을 재현하지 못했으며 원래 실패의 해결 증거가 아니다. 기본 경로의 실제 영수증과 주입한 CLI 진단을 구분한다.

독립 리뷰에서 child `close`만으로는 필터 전 로그가 모두 전달됐다고 볼 수 없음을 확인했다. 잠금 Miniflare가 kill 전에 stdout/stderr를 destroy하기 때문이다. 검증된 단일 workerd의 두 raw stream에만 한정한 adapter가 오류 없는 early destroy를 자연 `end`까지 지연한다. Miniflare의 stdin/control 파괴·abort·SIGKILL·자동 재시작 판단 순서는 유지하고 추가 spawn은 기존대로 실행 전에 거절한다. stream 오류의 destroy는 즉시 수행한다. 양 pipe의 EOF와 오류·중도 close 개수를 최종 로그 판정 및 native receipt schema에서 검증하며, 불완전하면 `RAW_LOG_CUSTODY_UNVERIFIED` UNKNOWN이다. dispatch부터 dispose·pipe/child 종료까지 기존 내부12초·외부15초와 raw 합계32KiB 상한을 유지한다.

고정 trusted Node writer가 이미 쓴 12바이트는 기존 destroy/kill/close 대조군에서 관측0, 새 adapter의 stdout/stderr 검사에서 각각 관측12였다. 종료 직전 큐에 쓴 금지 marker도 최종 로그 거절에 포함됐다. 이것은 host fixture의 로그 유실 회귀 증거이며 실제 후보의 우회 성공이나 과거 Docker timeout의 원인 증거가 아니다. stream 오류·중도 close 반례는 UNKNOWN으로 제한하고, 변경된 wrapper/image의 실제 전체 수용을 따로 검사한다.

실행과 제거가 모두 실패하면 `startFailure`와 cleanup 단계를 함께 보존한다. Docker CLI 실패의 고정 사유와 수신한 stdout/stderr 바이트 수만 남기며 각 수는 해당 출력 상한+1로 제한한다. 공통 진단 schema의 최대값은 65,537이고 native 경계에서 객체·접근자·enum·수 범위를 재검증한다. 부분 출력은 파싱하거나 PASS 영수증으로 복원하지 않는다. 실패한 START의 출력 바이트가 0인지 아닌지는 종료 전후의 단서일 뿐 성공 증거가 아니다.

2026-10-22 승인된 원인 수집 배치는 고정 이미지에서 정상/기존 generator 실패형을 32건, 20.647초 실행하고 횟수 상한에서 종료했다. 정상16건은 NO_CHANGE, 실패형16건은 CANDIDATE_LOG FAIL이었고 해당 배치의 timeout은 없었다. 이 배치는 전체 수용 검사와 목적이 다르며 과거 반복 실패의 원인을 재현하지 못했다. 이 진단 당시 전체 수용 BLOCKED를 유지했다. 원인 수집 재실행에는 별도 범위 확인이 필요하며 일반 평가 API가 retry하는 구조는 아니다.

후보 소스나 원문 출력은 manifest·보고서에 저장하지 않는다. 기존 의존성 감사는 35건(critical 1, high 9, moderate 21, low 4)을 보고했다. 의존성은 이 작업에서 변경하지 않았으며 고정 이미지가 이를 해소했다고 주장하지 않는다. 이것은 운영 배포, 실제 provider·학생 데이터·서비스 복구 또는 자기개선 효과의 증거가 아니다.
