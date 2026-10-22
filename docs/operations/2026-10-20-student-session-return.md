# 학생 초대 수락 POST와 로그인 복귀 주소 진단

관련: #309. 담당: Jay / Codex. 선행 수정: #308. 기존 초대 및 배정 데이터를 그대로 유지한다.

## 재현된 결함

학생이 초대 페이지를 연 뒤 세션이 소실되거나 만료되면, ‘초대 수락하고 내 작업 열기’는 React Router의 `POST /student/join.data` 요청을 보낸다. 기존 `requireUser`는 원시 `request.url`을 로그인 복귀 주소로 저장했으므로 `/student/join.data`가 그대로 전달됐다. 이 주소는 화면이 아니라 single-fetch 데이터 응답용이다. 다시 로그인해도 올바른 초대 화면으로 돌아오는 계약이 깨졌다.

운영에서 원래 초대 대신 존재하지 않는 합성 토큰과 쿠키 없는 POST를 사용해 같은 현상을 확인했다. 응답은 single-fetch 규약의 HTTP 202, Content-Type `text/x-script`였으며 리디렉션 내용에 잘못된 `.data` 복귀 주소가 포함됐다. 실제 초대나 학생 계정은 사용·소비하지 않았다.

## 수정

`safeReturnTo`가 `.data`를 화면 경로로 정규화하고 내부 `_routes` 쿼리를 제거한다. `requireUser`가 복귀 주소를 만들 때 이 함수를 호출한다. 로그인 페이지와 OAuth 진입에서도 같은 검증 함수를 사용하므로 기존 잘못된 복귀 주소도 정상화된다. 기존 외부 URL, 프로토콜 상대 URL, 경로 탈출 거부는 유지한다. 초대 수락 조건·학생 권한·세션 유효기간은 변경하지 않는다.

## 요청과 세션 확인

- 운영 브라우저에서 운영자 본인 계정과 합성 토큰으로 수락 버튼을 눌렀다. 실제 `/student/join.data` POST와 403 응답, 해당 계정에 대한 명시적 거절 문구를 확인했다. 이는 성공 수락 검증이 아니라 안전한 거절 경로 검증이다.
- 로컬 격리 D1에서 일반 학생의 수락 POST, Origin과 세션 쿠키 전달, 이어지는 작업 화면 진입, 같은 쿠키 유지까지 기록한다. 저장하는 trace에는 쿠키 값·초대 토큰·계정 식별자를 넣지 않는다.
- 별도 시나리오에서 수락 직전 쿠키를 제거하고, 로그인 복귀와 원래 초대 재개 및 실제 수락까지 확인한다. DB에 남은 쿠키의 만료 시각이 지난 경우도 통합 테스트로 확인한다.
- Chromium과 iPhone 설정의 Playwright WebKit에서 수정 전 복귀 경로 오류를 재현하고 수정 후 비교한다. WebKit은 실제 iPhone 기기 검증과 구분한다.
- WebKit에서 관리자 테스트 fixture의 단축 날짜 표시가 V8과 달라 기존 관리자 화면 hydration 경고가 발생했다. 학생 수락 결과와는 별개이며 이 작업에서 무관한 날짜 포맷을 변경하지 않는다.

## 증거 경계

기존 학생들의 인증·세션 기록은 있으나 예전 실제 클릭의 원문 POST 로그는 확보되지 않았다. 따라서 과거 캡처가 반드시 이 결함 때문에 생겼다고 단정하지 않는다. 이번 결함은 로컬 브라우저와 운영 POST에서 직접 확인했다. 과거 로그 접근 범위와 10% sampling 한계는 선행 운영 문서를 따른다.

## 배포와 보존

필수 CI와 diff 확인 후 병합된 main에서 `pnpm run build`, `CLOUDFLARE_ACCOUNT_ID=7543330c65069ee2df1b7b353fb0201c pnpm exec wrangler deploy --profile tastedit-production`를 배포 담당 Jay / Codex가 실행한다. 기존 `retaste-beta` Worker와 `retaste-production` DB만 사용한다. 새 binding, migration, 공급자, 의존성, 메일 발송 없음. 실제 초대·좌석·56개 과제의 행 digest와 개인별 원본 링크 파일 hash를 전후 비교한다.

배포 후 쿠키 없는 합성 POST의 복귀 주소가 `/student/join`인지 검사하고, 관리자 자검을 1회 수행한다. rollback은 배포 직전 Worker version `1bff4d34-d53b-4189-9f84-330308d8d935`를 재활성화한다. 학생의 실제 수락·과제 시작은 별도로 확인해야 한다.

## 검증 결과

| 조건 | 수정 전 | 수정 후 |
| --- | --- | --- |
| 유효한 학생 세션으로 수락 | 성공 경로 확인 | POST와 후속 작업 요청의 같은 세션 유지 |
| 클릭 직전 세션 소실 | `.data`로 잘못 복귀 | 실제 로그인 폼 제출 후 같은 초대 복구·수락 |
| DB에서 만료된 세션으로 POST | `.data`로 잘못 복귀 | 정상 화면 복귀 주소 |

- 단위 테스트 153 파일 / 963건, Workers 통합 80 파일 / 411건 통과.
- 추가 브라우저 테스트 Chromium 2건 + iPhone WebKit 2건 통과. 로그인 폼 제출로 새 HttpOnly / SameSite=Lax 세션이 발급되고, 그 세션으로 초대 수락 뒤 작업을 여는 것까지 확인했다.
- typecheck, build, production dependency audit 통과.
- 수정 전 오류는 정상 세션 수락이 항상 실패한다는 뜻이 아니다. 재현한 장애 조건은 수락 시점에 세션이 없는 경우다.

React Router의 원시 `request.url`과 정규화된 화면 URL 차이는 [공식 마이그레이션 안내](https://github.com/remix-run/react-router/blob/main/docs/upgrading/v7.md)와도 일치한다.
