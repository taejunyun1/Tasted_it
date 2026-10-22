# RSI R2 고정 합성 평가 프로토콜

- 범위: Issue #321, 설계 PR #305의 R2/T3. R1 계약·원장 위에 추가하는 개발 전용 native 재현기다.
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

모든 outbound 요청은 `outboundService`가 합성 응답으로 끝낸다. 허용 경로 밖 요청도 기록하고 합성 403으로 차단한다. 외부 fetch로 넘기는 분기는 없다. 런타임 초기화·dispatch·JSON 읽기 전체에 5초 deadline을 적용하고 `finally`에서 timer와 Miniflare를 해제한다. `TIMEOUT`은 60초 대기하는 고정 프로그램이며 5초에 `INCONCLUSIVE / EXECUTION_TIMEOUT`이 된다. `THROW`와 실행 오류는 `INCONCLUSIVE / EXECUTION_ERROR`, 해제 실패는 `INCONCLUSIVE / CLEANUP_ERROR`다. 이 deadline은 임의 코드의 CPU/메모리 격리를 제공하지 않는다.

검사 생략, 느슨한 status/redirect 검사, 전부 PASS라고 보고, 허용 경로 이탈, POST, 중복 호출, 잘못된 결과 구조는 동일 oracle에서 `FAIL / ORACLE_MISMATCH`다. 후보의 exit 0·PASS 문자열·스스로 고른 테스트를 판정 기준으로 쓰지 않는다. 정상 또는 외부 장애는 검사를 정직하게 수행하면 `NO_CHANGE`이며, 결과를 숨기거나 검사를 망가뜨리면 `FAIL`이다. 외부 장애에서 NO_CHANGE는 장애를 고쳤다는 뜻이 아니다.

## 결과와 R3 연결 경계

결과에는 schema version, 닫힌 verdict/reason code, `manifestHash`, `evaluatorHash`, `programHash`, native runtime 표시, `redReproduced`, `greenVerified`, `expectedNoChange`, 제한된 호출 기록만 남긴다. 원문, body, credential, 운영 URL, stack trace는 남기지 않는다.

- manifest hash: 잠긴 manifest 원본 바이트.
- evaluator hash: evaluator.ts와 contracts.ts 소스 바이트 연결의 SHA-256. 설치된 전체 의존성·컴파일러·호스트의 attestation은 아니다.
- program hash: 해당 실행에서 실제 workerd에 전달한 고정 script 바이트.
- `WORKERD`: native runtime ready 이후. `NOT_STARTED`: runtime ready 증거 없음.
- `greenVerified`: 독립 검증한 여섯 정상 계약. 정상 `NO_CHANGE`에서도 true일 수 있다.
- `expectedNoChange`: manifest의 사전 기대값. 실제 verdict가 FAIL/INCONCLUSIVE이면 성공한 NO_CHANGE가 아니다.
- GREEN만으로 RED 재현이나 개선 효과를 추론하지 않는다. RED와 GREEN 결과를 함께 읽는다.

R3 감독기는 현재 결과를 로컬 합성 증거로 소비할 수 있다. 임의 source 실행이 필요하면 이 함수에 문자열 허용을 추가하지 말고 별도 승인된 격리 executor를 연결해야 한다. 그 executor가 변경 불가능한 외부 oracle에 원본 실행 측정(후보 artifact/import closure hash, runtime identity, 독립 네트워크 trace, 시간·자원 한도, 종료·해제 결과)을 전달하고, 감독기가 provenance를 검증한 뒤 R1 evidence/ledger에 기록해야 한다. 후보가 만든 receipt나 입력 digest는 실행 증거가 아니다. 현재 R2는 ledger 기록, 모델 개선, 운영 효과 측정을 하지 않는다.

## 재현과 복원

저장소 루트에서 기존 의존성을 설치한 환경으로 실행한다.

```sh
pnpm exec vitest run tests/unit/rsi-evaluator.test.ts tests/unit/rsi-native-fetch.test.ts
pnpm run typecheck
pnpm test
pnpm run build
pnpm audit --prod
pnpm audit
```

첫 명령은 실제 workerd RED/GREEN·NO_CHANGE·조작 거절·timeout을 검증한다. 나머지는 저장소 회귀와 빌드 검증이다. 합성 PASS는 실제 장애 복구, 자기개선 성능, CI 성공, 배포 또는 라이브 운영 성공과 별개다. 기존 개발 의존성 audit 결과는 별도 기록하며 prod 0만으로 전체 audit 통과라고 쓰지 않는다.

복원은 R2 평가 코드·fixture·테스트·문서를 revert하는 것이다. app·migration·binding·cron·운영 설정은 바뀌지 않아 원격 복원 명령이 없다.
