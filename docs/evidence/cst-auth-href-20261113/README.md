# CST 인증 링크 SSR·hydration 회귀 검증

- 추적 #371 / SSOT #354 W04. 2026-11-13 KST, Jay/Codex.
- 기준: main `a01e6e8`에 본 수정 적용. 실제 브라우저 시험은 격리 로컬 Workers/D1, 비회원·합성 검색조건만 사용했다.
- 설치된 React Router 8.3.0 `lib/server-runtime/urls.js:getNormalizedPath`는 query를 URLSearchParams로 직렬화하고 `_routes`를 삭제한다. 브라우저 location은 원래 표현을 보존한다.
- RED: `bbox=126.80,35.10,127.00,35.25`에서 header login/signup SSR href의 `%252C`와 client href의 `%2C`가 달라 Chromium hydration 경고가 발생했다. 새 unit도 raw/정규 query 동등 비교에서 실패했다.
- 수정: 기존 safeReturnTo 검증 이후 query만 같은 방식으로 직렬화하고 내부 `_routes`를 제외한다. 위험 URL 검증·데이터 경로의 페이지 복귀·allowlist는 변경하지 않았다. 경고를 억제하지 않는다.
- GREEN: login/onboarding return unit 26/26, desktop Chromium·Pixel7 Chromium 실제 E2E 2/2, typecheck/build/diff-check, 운영 의존성 audit0.
- E2E는 SSR 원문 header href와 hydration후 href를 대조하고 해당 hydration 경고0을 확인했다. 실제 로그인 진입 뒤 returnTo의 bbox·한글/공백 검색어·반복 badge 값이 유지됨을 검증했다.
- unit은 `+`로 표현한 공백과 `%2B`의 문자 plus, 반복 query 순서, 한글 값 보존, 위험 표현 거절과 `.data`·`_routes` 복귀 제거를 확인했다.
- root.tsx의 guest 재시도 배너·저장 승계 기능은 수정하지 않았다. 이 결과는 전체 W04·외부 인증·운영 배포/라이브 RSI 완료가 아니다. 새 의존성·원격 쓰기·유료 호출은 없다.
