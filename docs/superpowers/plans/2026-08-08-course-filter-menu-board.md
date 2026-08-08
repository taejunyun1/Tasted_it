# 코스 필터 A형 메뉴 보드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** `/courses`의 모든 선택 조건을 드롭다운 대신 켜고 끄는 배지형 선택 UI로 바꾸고, 한 끼 카테고리는 전체 메뉴를 노출하면서 최대 2개를 OR 조건으로 추천에 반영한다.

**Architecture:** React Router GET 폼의 반복 `mealCategory` 파라미터를 서버에서 정규화하고, 추천 계층은 배열을 OR 필터로 처리한다. 화면은 접근 가능한 라디오·체크박스를 시각적 배지로 표현하며 데스크톱에서는 좌측 메뉴 보드, 모바일에서는 기존 바텀시트 흐름을 유지한다.

**Tech Stack:** React Router 7, React 19, TypeScript, Vitest, CSS

## 전역 제약

- 작업 브랜치 `tj_parking-course-v1`과 전용 worktree만 사용한다.
- 데이터베이스 migration, 운영 데이터, 비밀값은 변경하지 않는다.
- 한 끼 미선택은 전체 카테고리이며, 선택한 두 카테고리는 AND가 아닌 OR로 처리한다.
- URL은 `mealCategory=a&mealCategory=b` 형식으로 공유 가능해야 한다.
- 최대 2개를 넘기는 세 번째 선택은 기존 선택을 유지하고 안내 문구를 표시한다.
- 네이티브 입력 요소의 키보드·스크린리더 의미를 유지한다.

---

### Task 1: URL 모델을 다중 한 끼 선택으로 변경

- [x] `tests/unit/course-options.test.ts`에 반복 값, 중복 제거, 최대 2개, 직렬화 테스트를 먼저 추가한다.
- [x] 테스트 실패를 확인한다.
- [x] `app/features/courses/course-options.ts`의 `mealCategory`를 `mealCategories: string[]`로 바꾼다.
- [x] `URLSearchParams.getAll()`을 사용해 유효 slug만 중복 제거하고 앞의 2개만 유지한다.
- [x] `toCourseSearchParams()`가 선택값마다 동일 키를 반복하도록 구현한다.
- [x] `pnpm vitest run tests/unit/course-options.test.ts`로 통과를 확인한다.

### Task 2: 추천 알고리즘에 OR 조건 반영

- [x] `tests/unit/course-score.test.ts`에 두 카테고리 중 하나에 속하는 장소가 모두 후보가 되는 테스트를 추가한다.
- [x] 테스트 실패를 확인한다.
- [x] `app/features/courses/course-score.ts` 입력을 `mealCategories: string[]`로 변경하고 빈 배열은 전체, 값이 있으면 `includes`로 필터링한다.
- [x] `app/features/courses/course-recommendation.server.ts`가 배열을 전달하도록 수정한다.
- [x] 관련 단위 테스트를 실행한다.

### Task 3: 최대 2개 선택 상태와 배지형 폼 구현

- [x] `tests/unit/course-filter-selection.test.ts`에 선택·해제·세 번째 선택 차단 테스트를 먼저 작성한다.
- [x] `app/features/courses/course-filter-selection.ts`에 순수 선택 보조 함수를 구현한다.
- [x] `tests/unit/course-page-policy.test.ts`에 `<select>` 미사용, 배지형 radio/checkbox, 최대 2개 안내 계약을 추가한다.
- [x] `app/routes/course-recommendation.tsx`의 모든 드롭다운을 라디오·체크박스 기반 키워드 배지로 교체한다.
- [x] 한 끼 전체 카테고리를 노출하고 선택 수·오류 안내·요약 문구를 연결한다.
- [x] 초기 무선택 진입 시 기존처럼 모바일 바텀시트를 즉시 연다.
- [x] 관련 단위 테스트를 실행한다.

### Task 4: A형 메뉴 보드 시각 디자인 적용

- [x] `app/app.css`에 짙은 초록·라임·오렌지, 충분한 R값, 명료한 그룹 구획을 적용한다.
- [x] 데스크톱은 좌측 고정형 메뉴 보드, 모바일은 하단 바텀시트와 하단 적용 버튼으로 정리한다.
- [x] SUIT/Pretendard 우선 폰트 스택을 적용한다.
- [x] 선택·포커스·비활성 상태를 색만이 아닌 윤곽과 텍스트로 구분한다.
- [x] 데스크톱과 모바일 화면을 직접 확인하고 가로 넘침을 제거한다.

### Task 5: 전체 검증과 PR 갱신

- [x] 변경 범위 단위 테스트를 실행한다.
- [x] 전체 unit, integration, typecheck, build를 실행한다.
- [x] 브라우저에서 최대 2개 선택, 세 번째 차단, 반복 URL, 초기 바텀시트를 확인한다.
- [x] diff와 git status를 검토한다.
- [ ] 날짜와 핵심 내용을 담아 커밋하고 feature branch를 push한다.
- [ ] 기존 PR #57에 변경 범위와 데스크톱·모바일 검증 결과를 갱신한다.

## 자체 검토

- 설계 문서의 A형 단일안, 최대 2개, OR 의미, 반복 URL, 모바일 바텀시트 요구를 모두 작업 단위에 연결했다.
- 서버 정규화와 UI 제약을 각각 테스트하여 URL 직접 조작도 안전하게 처리한다.
- 운영 데이터 및 배포 작업은 이 변경 범위에서 제외한다.
