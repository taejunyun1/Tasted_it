# 학생 작업공간 로컬 검증

2026-10-15, #295. 모든 화면은 격리된 로컬 D1과 합성 계정·자료다. 2099년 사용기한은 반복 가능한 시험 fixture이며 실제 학생 기한이 아니다. 운영 좌석은 KST 2026-12-31까지다. 실제 학생·초대 원문·운영 점포 자료를 포함하지 않는다.

| 화면 | 데스크톱 | 모바일 |
| --- | --- | --- |
| 관리자 계정·배정 | [화면](student-admin-desktop.png) | [화면](student-admin-mobile.png) |
| 점포 분류 제출 | [화면](student-place-form-desktop.png) | [화면](student-place-form-mobile.png) |
| 다른 학생의 등록 인가 | [화면](student-registration-check-desktop.png) | [화면](student-registration-check-mobile.png) |

네 개인 초대 수락·URL fragment 제거·배정 외 접근 거부·1차 분류·독립 인가·원래 비추천 평가 유지·접근 중지와 기존 로그인 거부를 실제 Chromium/Pixel 7 emulation에서 확인했다. JS 시작 전 관리자 초대 폼도 별도로 시험했다. 네 시험 통과이며 모바일은 실물 Pixel의 시험이 아니다.

검증 명령과 관찰:

- `pnpm test`: 148 files, 913 tests 통과.
- `pnpm test:integration`: 76 files, 393 tests 통과. 신규 학생 범위는 unit 7개·integration 28개다.
- `pnpm run typecheck`, `pnpm run build`: 통과.
- `pnpm exec playwright test tests/e2e/student-workspace.spec.ts`: 4개 통과, 두 화면 환경.
- `pnpm exec playwright test tests/e2e/release.spec.ts tests/e2e/ci-smoke-places.spec.ts --project=chromium`: 기존 3개 통과.
- `pnpm audit --prod --json`: 알려진 취약점 0개. 전체 audit는 기존 개발 도구의 low 3·moderate 16·high 8·critical 1을 보고했다. 의존성·lockfile을 변경하지 않았으며 전체 audit가 깨끗하다고 주장하지 않는다.
- 최종 수정 후 해당 작업/HTTP 통합 시험과 타입 검사를 다시 수행했다. PR CI가 최종 commit의 전체 검증 기록이다.

등록 인가는 학생 이력에만 기록되며 실제 점포는 DRAFT, 기존 검수 작업은 ACTIVE, 리뷰 작성자의 평가·버전은 그대로임을 통합 시험에서 확인했다. 원격 migration·운영 배포·실제 초대 발급·Workers AI 호출을 수행하지 않았다. 실제 접속과 인수는 [운영 런북](../../operations/student-workspace.md)을 별도로 검증한다.
