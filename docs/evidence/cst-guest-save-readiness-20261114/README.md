# 임시 저장의 초기 준비·조회 재시도 검증

#404의 최소 UI 보완이다. 기준 main은 `4ae8abf75554d9b4360118c7e57353209dd9c464`이고 제품 변경은 `GuestSaveControl`의 준비 상태와 초기 조회 재시도뿐이다. SSR의 `fetcher.state=idle`만으로 저장을 허용하지 않고, hydration 후 해당 장소의 성공한 조회 결과에서 `saved`, `signedIn`, 준비 완료를 함께 반영한다.

## 확인한 동작

- 실제 client entry 요청을 보류하면 SSR 저장 버튼은 disabled다. entry를 해제한 뒤 초기 GET을 보류해도 계속 disabled다.
- 초기 GET의 응답 유실은 오류와 명시적 `저장 상태 다시 확인` 버튼을 표시한다. 상태를 모르는 동안 저장은 잠긴다.
- 기존 화면이 열려 있는 동안 실제 로컬 API로 로그인·회원 저장을 준비한 뒤 재조회하면 회원의 `saved=true`가 먼저 반영되고 `저장 해제`가 활성화된다. 숨은 다음 선택 값은 `false`다.
- 준비 완료 뒤 POST503은 기존 선택과 저장 해제 의도를 보존한다. 실제 서버가 저장 해제를 기록한 뒤 응답을 끊어도 결과 불확실성을 안내하며, 같은 `saved=false` 의도로 재시도한다. 서버의 저장 상태도 별도 GET으로 확인한다.
- 저장된 A에서 B로 장소를 바꾼 뒤 B의 GET이 실패하면 A 선택을 쓰지 않는다. B의 조회 재시도 성공 후에만 활성화하고 B ID의 `saved=true` 요청을 검증한다.
- keyed place 경계·서버 권한·회원 병합·기존 POST 오류 안내는 유지한다. 초기 조회 실패만 별도 조회 retry를 제공하며 이후 POST 실패를 조회로 바꾸지 않는다.

## 실행과 증거 경계

| 실행 | source checkpoint | 결과 |
| --- | --- | --- |
| SSR 준비 전 버튼 기대 | `1f58392d4fc60bd7f968a3239361734b70865dc1` | RED1: 실제 버튼 enabled |
| 준비·조회·회원 상태·POST503/응답 유실·장소 전환 | `8ecade0189c15e282fcab62a5684210e01159387` | 5 PASS / 1 SKIP, 29.3초. SKIP은 기존 mobile 전용 case의 desktop 조합 |
| SSR 촬영 조건 보완 뒤 준비·조회·회원 상태 | `1dd5da59576c1360e772827e0acdae617005e7a3` | desktop/mobile 2 PASS, 20.1초 |

제품 source는 `8ecade0` 이후 동일하다. 마지막 촬영은 entry barrier를 유지한 채 실제 font 준비를 기다리고 `caret: initial`로 DOM 속성 주입을 막았다. Playwright의 기본 caret 숨김은 input에 임시 inline style을 남길 수 있어 hydration 전 촬영에서 경고를 만들었으며, 보완 후 해당 경고가 없었다. 최종 촬영 checkpoint의 dirty 항목은 전용 증거 파일뿐이었다.

[verification.json](verification.json)에 실제 전체 SHA·dirty 여부·프로세스 완료 UTC/KST와 각 실행 결과를 기록했다. 실행은 중복되므로 합산하거나 최종 문서 head의 단일 전체 suite 실행으로 해석하지 않는다. typecheck PASS, production audit0, timeout/retry/기대 완화0이다. 전체 suite는 반복하지 않았다.

## Desktop·mobile 화면

| 상태 | Desktop | Mobile |
| --- | --- | --- |
| SSR 준비 중·저장 잠김 | [SSR](desktop-guest-ssr-disabled.png) | [SSR](mobile-guest-ssr-disabled.png) |
| 초기 조회 실패·명시적 재시도 | [조회 오류](desktop-guest-read-retry.png) | [조회 오류](mobile-guest-read-retry.png) |
| 재조회한 회원 선택 반영·활성화 | [저장 해제](desktop-guest-member-choice-ready.png) | [저장 해제](mobile-guest-member-choice-ready.png) |

모든 계정·장소·요청은 격리한 로컬 합성 fixture다. 원문 RED trace/log는 primary의 ignored operations 디렉터리에0700/0600으로 보존했으며 원문 trace·쿠키·헤더·본문을 업로드하지 않는다. #402의 기존 CI 실패가 실제 native POST였는지는 UNKNOWN이다. 이 변경이 그 발생 경로를 재현했다거나 운영 배포·RSI를 검증했다고 주장하지 않는다. 운영 실행·원격 DB·실제 학생 자료·메일·유료 요청·새 의존성0이다.
