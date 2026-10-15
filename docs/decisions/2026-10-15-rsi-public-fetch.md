# RSI 공개 진입점 호출과 관리자 수동 재검사

- 상태: ACCEPTED — 이 변경을 포함한 PR 병합 시 적용
- 소유자: Jay/Codex, 사용자 요청에 따른 지정 배포 담당
- 추적: [Issue #297](https://github.com/taejunyun1/Tasted_it/issues/297)

## 문제와 수정

2026년 10월 15일 06:47 UTC 정기 감사는 공개 6경로를 모두 status 0으로 기록했다. 같은 서비스의 실제 가입·메일 수신·인증·로그인은 정상 동작했다. 배포 설정에는 같은 Workers 영역의 공개 주소 호출을 공개 진입점으로 보내는 옵션이 없다.

[Cloudflare 공식 설명](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)에 따라 `global_fetch_strictly_public`을 추가한다. compatibility date와 다른 플래그는 유지한다. 고정 6경로만 익명 GET하며 `/admin`의 리디렉션은 따라가지 않는다. 같은 함수 내부 응답으로 검사를 대체하지 않고 실제 공개 HTTP 경로를 호출한다.

## 한정 승인과 인증 경계

기존 RSI Stage 3 중 **기존 ADMIN 세션을 이용한 같은 6경로의 수동 재검사만 GO**로 전환한다. 신규 토큰 없이 `POST /admin/operations/rsi-check`에서 기존 서버 세션과 ADMIN을 먼저 검증한다. 같은 origin과 정확한 `intent=run` 양식만 허용한다. 클라이언트는 origin·경로·상태 계약을 바꿀 수 없다. GET은 인증 확인 후 405다. 응답과 인증 오류는 private/no-store다.

수동 실행은 정기 실행과 같은 함수를 사용하지만 감사 target `rsi-admin`·trigger `admin`·기존 관리자 ID로 구분한다. 정기는 기존 `rsi-scheduled`·trigger `scheduled`·NULL actor를 유지한다. 수동 성공을 정기 성공으로 기록하지 않는다. 기존 토큰 GET과 kill switch도 유지한다. Stage 1·4와 나머지 Stage 3, 사진/Workers AI와 공개 자동화는 HOLD다.

## 운영과 검증

지정 운영 Worker의 병합 main만 배포한다. 이번 수동 실행은 최대 2회, 회당 고정 공개 GET 6개와 기존 감사 INSERT 1개다. 기존 6시간 cron은 유지한다. 새 binding·테이블·migration·cron·Worker·공급자·AI·이메일·비밀값은 없다. 감사에 요청 본문·쿠키·토큰·이메일·리디렉션 원문은 넣지 않는다. 학생 초대/좌석/작업과 원천 자료도 수정하지 않는다.

기존 RSI 회귀와 Workers-D1의 인증·USER 거부·CSRF·입력 제한·GET 미실행·성공/실패 감사 분리를 검증한다. 필수 CI와 PR diff 확인 후 병합 main을 배포하고 기존 관리자 세션의 실제 Worker 수동 결과와 감사 한 행을 대조한다. 다음 정기는 2026년 10월 15일 12:47 UTC이며 별도로 확인한다.

직전 Worker `7019cf4d-de15-4d2f-9cc4-49a3fc0cd51d`로 복원하면 플래그와 관리 재검사를 되돌릴 수 있다. 새 감사 이력은 보존하며 schema나 학생 초대를 되감지 않는다. 메일 복구 설정은 유지한다.
