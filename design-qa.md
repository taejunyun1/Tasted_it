# Re:Taste 디자인 시스템 정합성 QA

## 비교 대상

- Source visual truth
  - `/Users/taejun-yun/Desktop/Screenshot/Screenshot 2026-08-10 at 07.03.48.png` (`/places`)
  - `/Users/taejun-yun/Desktop/Screenshot/Screenshot 2026-08-10 at 07.03.44.png` (`/courses`)
  - `/Users/taejun-yun/Desktop/Screenshot/Screenshot 2026-08-10 at 07.03.52.png` (`/me`)
- Rendered implementation
  - `docs/evidence/2026-08-10-design-system-places-desktop.png`
  - `docs/evidence/2026-08-10-design-system-courses-desktop.png`
  - `docs/evidence/2026-08-10-design-system-me-desktop.png`
  - `docs/evidence/2026-08-10-design-system-admin-desktop.png`
  - `docs/evidence/2026-08-10-design-system-mobile.png`
- Same-input comparison evidence
  - `docs/evidence/2026-08-10-design-system-places-comparison.png`
  - `docs/evidence/2026-08-10-design-system-courses-comparison.png`
  - `docs/evidence/2026-08-10-design-system-me-comparison.png`

## 정규화

- 데스크톱 CSS viewport: `1003 × 1110`, device pixel ratio `2`
- 구현 캡처 픽셀: `1003 × 1110`
- 원본 캡처 픽셀
  - places `2006 × 2194` → 폭 `1003px`로 1/2 축소
  - courses `2000 × 2236` → 폭 `1000px`로 1/2 축소
  - me `2006 × 2220` → 폭 `1003px`로 1/2 축소
- 모바일 CSS viewport / 캡처 픽셀: `390 × 844`
- 비교 이미지는 정규화한 원본과 같은 상태의 구현 캡처를 가로로 결합해 확인했다.

## 상태

- `/places`: 로컬 시드 장소가 있는 기본 추천 상태
- `/courses`: 기본 자동 시간대, 전체 한 끼, 카페, 반경 3km 상태
- `/me`: 로컬 일회용 관리자 계정의 취향 학습 전 빈 상태
- `/admin/candidates`: 로컬 검수 후보 0건의 빈 목록 상태
- 운영 데이터와 원격 DB는 변경하지 않았다.

## 전체 화면 비교

- Fonts and typography: SUIT 계열 제목, IBM Plex Mono eyebrow, 큰 제목의 굵기와 자간이 원본의 위계를 유지한다. 페이지 간 제목 시작선과 크기 체계가 일관된다.
- Spacing and layout rhythm: 세 사용자 화면은 1280px 컨테이너, 64px 페이지 시작, 80px 주요 섹션 간격을 공유한다. 모바일은 14px 거터와 56px 주요 섹션 간격으로 전환된다.
- Colors and visual tokens: 크림 배경, 깊은 녹색, 흰 카드, 라임 핵심 선택색이 원본과 동일한 역할로 사용된다. 어드민도 같은 잉크·선·배경 토큰을 사용하되 정보 밀도는 유지한다.
- Image quality and asset fidelity: 이 비교 범위의 상단·조건·프로필·어드민 화면에는 원본 고유 이미지 자산이 없다. 장소 이미지 영역은 기존 실제 데이터/기존 fallback을 그대로 유지했으며 새 가짜 자산을 만들지 않았다.
- Copy and content: 제목, 설명, 선택 조건, 취향 학습, 어드민 상태 문구는 기존 제품 카피를 유지했다. 구현 비교의 이메일과 카테고리 개수 차이는 로컬 시드 데이터 차이다.

## 집중 영역 비교

- `/places` 조건 카드: 32px 데스크톱 패딩, 28px feature radius, 제목/설명/배지 기준선이 원본과 일치한다.
- `/courses` 조건 요약 및 양열 카드: 요약 바와 좌우 카드의 시작선, 20px card radius, 내부 24~32px 간격이 일관된다.
- `/me` 프로필·학습·활동 카드: 아바타에서 대표 문구, 학습 상태, 활동 섹션으로 이어지는 수직 리듬을 토큰으로 정리했다.
- `/admin/candidates` 필터·일괄 작업: 36px 데스크톱 컨트롤, 12px 표 셀, 48px 페이지 시작으로 조밀한 운영 화면을 유지했다.

## 상호작용·콘솔

- `/places`에서 `냉면` 추천 배지 선택 후 `1/2 선택` 상태 반영 확인
- 모바일 `/courses`에서 `조건 변경` 클릭 후 바텀시트 노출 확인
- 사용자 주요 내비게이션과 어드민 필터 컨트롤의 접근 가능한 이름 확인
- 최종 화면의 브라우저 콘솔 오류: 0건

## Findings

- P0: 없음
- P1: 없음
- P2: 없음
- 허용된 차이: 기준 화면은 실제 운영 데이터, 구현 화면은 로컬 시드 데이터이므로 이메일, 카테고리별 장소 수, 추천 카드 내용이 다르다. 레이아웃 정합성 판단에는 영향을 주지 않는다.

## Comparison history

1. 초기 비교에서 세 화면의 기존 고유 시각 구조를 유지한 채 공통 시작선과 카드 패딩이 적용된 것을 확인했다.
2. 같은 CSS viewport로 원본을 1/2 정규화하고 구현을 재캡처했다. 재비교 결과 조치가 필요한 P0/P1/P2 차이가 없었다.

## Implementation Checklist

- [x] 공통 레이아웃·간격·반경 토큰 적용
- [x] `/places`, `/courses`, `/me` 데스크톱 기준선 통일
- [x] 어드민 페이지 폭·밀도·컨트롤 높이 통일
- [x] 390px 모바일 거터·패딩·바텀시트 검수
- [x] 실제 CSS 토큰을 참조하는 상시 디자인 가이드 작성
- [x] 콘솔 오류와 핵심 상호작용 확인

final result: passed

---

## 앱 우선 취향 온보딩 Task 8 QA

### 검증 환경

- 최종 검증 시각: `2026-08-10 19:07 KST`
- 데스크톱: Playwright `Desktop Chrome`, CSS viewport `1280 × 720`
- 모바일: Playwright `Pixel 7`, CSS viewport `412 × 839`, device scale factor `2.625`
- 데이터 경계: 로컬 D1과 로컬 시드만 사용했다. 합성 로그인 회원은 테스트 서버 시작 전에 한 번 seed하고, 브라우저 실행 중에는 해당 서버의 loader/action만 사용한다. 테스트 프로세스에서 `wrangler d1`을 별도 실행하지 않는다.
- 서버 경계: `reuseExistingServer: false`로 현재 worktree가 시작한 서버만 사용한다. 다른 worktree의 `127.0.0.1:5173` 서버가 있으면 재사용하지 않고 실행을 실패시킨다.
- DB 실행 경계: 현재 E2E는 하나의 로컬 D1을 공유하므로 Playwright worker를 환경과 무관하게 `1`로 고정했다. 같은 정확한 전체 명령을 연속 2회 실행해 추가 D1 internal error, timeout, `SQLITE_BUSY`가 없음을 확인했다.
- 개인정보 경계: 로그인 검증은 프로젝트별 합성 식별자와 로컬 전용 자격 증명만 사용했다. 실제 이메일, 계정 ID, 이름, 원본 위치 좌표를 문서·로그·증거에 남기지 않았다.

### 사용자 흐름 증거

- 완료: 위치 기본값 → FOOD 2개 → STYLE 1개 → 추천 미리보기 → `/places` 개인 추천 레일까지 이동했다.
- 건너뛰기: 첫 단계에서 건너뛴 뒤 `/places`를 새로고침해도 온보딩으로 다시 가두지 않았다.
- 선택 제한: FOOD 여섯 번째와 STYLE 네 번째 선택이 기존 선택을 교체하지 않았고 각각 `5/5`, `3/3`을 유지했다. STYLE 제한 안내도 상태 메시지로 전달됐다.
- 복원: STYLE에서 `노포파`를 선택하고 제출하지 않은 채 이탈했다. 재진입 직후 STYLE 단계와 `노포파[aria-pressed=true]`가 복원됐고, 이전 FOOD 단계의 `국밥러`와 제목 포커스도 유지됐다. 현재 단계의 마지막 선택 snapshot을 `visibilitychange/pagehide`에서 한 번 저장하되 단계 전진이나 완료 이벤트를 만들지 않는다.
- 복원 순서·수명주기: 각 loader가 guest session의 `selectionEpoch`를 원자적으로 `+1` claim하고 revision을 `0`으로 초기화한다. client는 그 document 안에서 revision을 증가시키며, server는 현재 epoch·현재 step·더 큰 revision·미완료·미건너뜀·미병합·미만료 조건을 모든 badge/session batch statement에 동일하게 적용한다. 따라서 복수 탭/재진입 document가 같은 local revision `1`을 써도 이전 epoch의 beacon은 도착 순서와 무관하게 no-op이다. 완료·건너뛰기 timestamp는 revision/선택과 같은 batch에 저장되고, 병합 뒤 stale cookie나 cookie 없는 beacon은 세션을 생성하지 않는다. 고정 30일 TTL과 위치·식별정보 경계는 바뀌지 않았다.
- 키보드: `Enter`로 단계 제출, `Space`로 FOOD/STYLE 배지 선택, 단계 전환 뒤 제목 포커스 이동을 확인했다.
- 위치 거부: init script가 `getCurrentPosition`의 error callback을 결정적으로 호출하도록 했고 API 호출 횟수 `1`을 먼저 확인했다. 이후 `광주 중심` 기본값과 추천 미리보기를 확인했으며 원본 위치 좌표는 사용하지 않았다.
- 추천 미리보기: 실제 로컬 추천 카드가 데스크톱과 모바일에서 렌더링됐다. 오류 시 `다시 불러오기` 계약은 `tests/unit/taste-onboarding-contract.test.ts`에서 고정돼 있다. React Router 데이터 응답 형식을 우회하는 가짜 네트워크 응답은 실제 사용자 실패를 재현하지 않아 E2E 증거로 채택하지 않았다.
- 로그인 복귀·병합: 장소 상세의 로그인 링크가 정확한 내부 `returnTo`를 유지했고, 비밀번호 로그인 뒤 같은 상세 화면으로 복귀했다. 같은 브라우저로 `/me`에서 병합된 `국밥러`를 확인했다. 단일 병합과 전환 이벤트 한 건 계약은 관련 Workers integration에서 확인했다.

### 결과와 기준선 분리

- 정확한 집중 명령: `pnpm run test:e2e tests/e2e/taste-onboarding.spec.ts`
- Task 8 집중 E2E: 데스크톱 7개, 모바일 7개, 합계 14개 통과 (`26.4s`, 1 worker).
- 전체 명령: `pnpm run test:e2e`
- 전체 E2E 1회차: 114개 중 102개 통과, 8개 의도적 건너뜀, 기존 4개 실패 (`2.2m`).
- 전체 E2E 2회차: 114개 중 102개 통과, 8개 의도적 건너뜀, 동일한 기존 4개 실패 (`2.1m`). 두 실행 모두 `browse.spec.ts`의 온보딩 `.data` 반환 경로 2건과 `map-zoom.spec.ts`의 확대 상태 2건만 남았고 Task 8 신규 실패, D1 internal error, timeout, `SQLITE_BUSY`는 없었다.
- epoch 수정 후 전체 E2E: 114개 중 102개 통과, 8개 의도적 건너뜀, 동일한 기존 4개 실패 (`2.2m`). Task 8 신규 실패와 추가 D1 오류는 없었다.
- 관련 unit: 4개 파일, 31개 통과. 관련 Workers integration: 3개 파일, 73개 통과. 동등 local revision의 `old→new`, `new→old` 도착 순서와 concurrent epoch claim이 실제 D1에서 통과했다. `pnpm run typecheck`, `git diff --check` 통과.
- 제품 수정: 로그인 helper가 검증된 `/places` 내부 경로만 보존하도록 수정했다. 외부 URL, protocol-relative URL, 역슬래시 우회, `/admin`, `/auth` 목적지는 계속 `/`로 제한한다.
- 검증 중 Vite 개발 서버의 manifest patch fetch 종료 경고와 Workers 테스트 종료 지연 경고가 있었지만 각 테스트 결과와 프로세스 실행은 위 수치로 완료됐다.
- 화면 스타일 수정은 필요하지 않았다. 두 viewport 모두 동일한 기능 흐름을 통과했다.

Task 8 final result: passed
