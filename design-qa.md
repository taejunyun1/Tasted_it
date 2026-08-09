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
