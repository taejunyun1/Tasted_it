# CST U03/T01 지도·목록 검색조건 보존 검증

- 날짜: 2026-11-13 (KST)
- 추적: [Issue #355](https://github.com/taejunyun1/Tasted_it/issues/355), CST 서비스 기준안 U03/T01
- 기준: `origin/main@471a3eb`에 이 PR의 지도 전환 수정 적용
- 환경: Playwright의 격리된 로컬 Workers/D1 fixture, 실제 운영 데이터·NAVER 호출 없음
- 시험: `pnpm exec playwright test tests/e2e/map-category-query.spec.ts`
- 수정 전: 데스크톱 링크의 `q`가 `null`이 되어 RED. 기존 `?view=list` 링크가 검색조건 전체를 덮어썼다.
- 수정 후: 데스크톱 Chromium·Pixel 7 Chromium 각각 지도→목록→지도에서 `q/bbox/selected`, 장소 ID 집합·선택 표시, 재접속 후 선택 상태를 검증했다.
- 화면: `desktop-list.png`, `mobile-list.png`는 목록 상태, `desktop-map.png`, `mobile-map.png`는 지도 상태다. 지도 SDK 자격증명이 없는 로컬 환경으로, 지도 외부 연동 성공 증거가 아니다.
- 한계: 이 결과는 해당 경로의 로컬 회귀 검증이다. 전체 T01 검수, 라이브 반영·RSI 확인, NAVER 지도 로딩·위치 거부·접근성·모든 화면 품질의 통과를 의미하지 않는다.

운영 반영은 병합된 main에서 지정 배포 담당자가 별도 배포 범위를 확인하고 공개 HTTP 및 라이브 Worker RSI 결과를 검증해야 한다.
