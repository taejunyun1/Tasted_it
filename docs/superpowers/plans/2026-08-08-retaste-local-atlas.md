# 로컬 푸드 아틀라스 지도 탐색 UI 구현 계획

> **담당자:** 이 계획은 `superpowers:executing-plans`와 `superpowers:test-driven-development` 절차로 실행한다.

**목표:** 승인된 로컬 푸드 아틀라스 목업을 기존 지도 탐색 기능에 적용하고, SUIT/Pretendard 기반의 읽기 쉬운 데스크톱·모바일 UI를 제공한다.

**구조:** 데이터 조회와 URL 상태 관리는 그대로 두고 지도 관련 React 컴포넌트의 의미 구조와 `app.css` 디자인 토큰을 확장한다. 검수 완료 배지는 공개 장소 목록과 선택 장소 정보에 공통 적용하며 기존 지도/목록/상세 전환 동작은 유지한다.

**기술:** React Router 8, React 19, TypeScript, CSS, Vitest, Playwright

---

## 작업 1: 디자인 계약 테스트

**파일:**
- 수정: `tests/e2e/map-explorer-panel.spec.ts`

1. 지도 탐색 패널에 아틀라스 표식과 제목이 노출되는 테스트를 추가한다.
2. 공개 장소 목록 및 빠른 정보에 `검수 완료` 배지가 노출되는 테스트를 추가한다.
3. 모바일 상세 바텀시트에서도 배지가 노출되는 테스트를 추가한다.
4. `pnpm exec playwright test tests/e2e/map-explorer-panel.spec.ts --project=chromium`을 실행해 새 테스트가 실패하는 것을 확인한다.

## 작업 2: 의미 구조 구현

**파일:**
- 수정: `app/components/map/MapExplorerPanel.tsx`
- 수정: `app/components/map/MapPlaceList.tsx`
- 수정: `app/components/map/MapPlaceDetail.tsx`
- 수정: `app/components/places/PlaceDetailSheet.tsx`

1. 패널 상단에 아틀라스 표식과 탐색 소개를 추가한다.
2. 결과 헤더의 문구와 계층을 편집형 구조로 정리한다.
3. 목록, 빠른 정보, 모바일 상세에 텍스트형 `검수 완료` 배지를 추가한다.
4. 기존 검색·필터·선택·상세 열기 이벤트는 변경하지 않는다.
5. 앞서 추가한 Playwright 테스트를 다시 실행해 통과시킨다.

## 작업 3: 디자인 토큰 및 반응형 스타일

**파일:**
- 수정: `app/app.css`

1. 기본 글꼴을 SUIT, Pretendard 중심으로 변경한다.
2. 종이색, 감색, 숲색, 감귤색 토큰을 추가한다.
3. 탐색 패널, 분류 선택, 지역 목록, 지도 핀, 빠른 정보 패널을 아틀라스 방향으로 정리한다.
4. 검수 완료 배지를 작은 상태 배지로 스타일링한다.
5. 760px 이하 지도 우선 구조와 바텀시트를 정리한다.

## 작업 4: 전체 검증

**파일:**
- 검증: 변경된 전체 범위
- 산출물: `output/playwright/`의 데스크톱·모바일 캡처

1. `pnpm test`를 실행한다.
2. `pnpm run typecheck`를 실행한다.
3. `pnpm run build`를 실행한다.
4. 개발 서버를 열고 데스크톱과 모바일 핵심 흐름을 직접 확인한다.
5. 콘솔 오류와 레이아웃 깨짐이 없는지 확인하고 화면 증거를 저장한다.

## 작업 5: 협업 전달

1. 변경 파일만 검토하고 한국어 커밋 메시지로 커밋한다.
2. `tj_design-refresh` 브랜치를 origin에 푸시한다.
3. 이슈 #44를 연결한 PR을 `main` 대상으로 생성한다.
4. PR diff와 필수 체크를 확인하고 사람 검토를 기다린다.

