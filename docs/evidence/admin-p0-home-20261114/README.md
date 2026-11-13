# ADMIN 운영 홈 B01 검증

Issue #409, 상위 #408. 2026-11-14 로컬 합성 QA 데이터 기준이다. 운영 배포·실제 데이터·34개 기능의 운영 정상 상태를 증명하지 않는다.

- `pnpm exec vitest run tests/unit/admin-control-registry.test.ts tests/unit/admin-index-contract.test.ts`: 4 passed. 34개 ID·분야·미구현 링크·허용 filter와 관리자 검사 후 집계 응답 검사.
- `pnpm exec vitest run --config vitest.workers.config.ts tests/integration/admin-home.test.ts`: 4 passed. 익명/USER/만료 세션 거부, ADMIN 집계, 경보 101개 입력에서 최대100/부분 표시, 원문 비노출, 조회/auth 실패503과 private/no-store 확인.
- `pnpm run typecheck`: passed.
- `pnpm exec playwright test tests/e2e/admin-home.spec.ts --project=chromium --project=mobile-chromium`: 4 passed. 34개 영역, 분야 필터, 실제 평가 운영 화면 이동, 일반회원403, 성공/403 응답의 private/no-store, 화면 가로 넘침 없음.
- `git diff --check`: passed.
- 독립 읽기 리뷰: 차단 사항 없음. B03/B04/B05 통합 후 A03/A09/A16/A17의 설명은 최종 코드에 맞춰 갱신한다.
- `pnpm audit --prod`: 알려진 취약점0. 전체 `pnpm audit`: 기존 개발 도구 의존성46건(critical1/high15/moderate26/low4). 의존성·lockfile 변경 없음.

실제 브라우저 확인에서 오류가 root boundary로 전파되면 leaf 응답 헤더가 빠지는 것을 확인해, 운영 홈 전용 오류 화면으로 수정한 뒤 성공/403 헤더를 재검증했다. 초기 테스트의 중복 heading 선택과 fixture severity 누락도 수정했다.

첫 CI의 단위 테스트 1개 실패는 이전 redirect-only 계약을 갱신하지 않은 것이 원인이다. [최초 실패](first-ci-unit-failure.json)를 보존하고 승인된 운영 홈의 관리자 검사·비공개 집계 응답 계약으로 바꿨다. timeout/retry를 늘리거나 테스트를 제거하지 않았다.

[데스크톱](desktop.png), [모바일](mobile.png)은 최종 실행의 합성 데이터 화면이다. 직접 확인 결과 텍스트 겹침·잘림과 가로 넘침이 없으며, 집계 출처·조회시각·상태 및 주요 관리 진입을 확인했다.
