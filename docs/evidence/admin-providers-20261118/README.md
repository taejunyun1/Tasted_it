# B11.1 공급자 조회 화면 검증

2026-11-18 로컬 Workers/D1 합성 fixture로 검증했다. 실제 공급자 호출·계정·비용 자료가 아니다.

- `desktop.png`: Chromium 데스크톱. 기존 추정 4, 새 예약 3, 합계 7, 응답 불명·대기 분리.
- `mobile.png`: Pixel 7 크기. 수치·안내 및 권한 경계 유지.
- `mobile-320.png`: 320px. 가로 넘침 없음.
- 키보드로 새로 조회 링크 이동·실행, 익명/일반 회원 차단, 관리자 POST 405, JS/HTTP 500 없음.
- `tests/e2e/admin-providers.spec.ts`: 데스크톱·모바일 4/4 PASS. 실제 NAVER 요청 0.
- `tests/integration/admin-providers.test.ts`: 관리자 읽기 전용·비밀값 미노출·공공 신규 전송 표식/이전 미측정 구분 검증.
