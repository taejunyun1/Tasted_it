# 리뷰어 Golden Pick 최종 확인 검증

2026-11-18 · #471 · UI 통합 `23de61d` 위의 한정 보완이다.

STEP05에 Golden Pick 검수 요청 여부와 선택한 사유를 표시한다. 선택을 해제하면 제출 사유는 빈 값이며, 이전 단계에서 다시 선택하면 작성 중인 사유를 복원한다. 관리자 승인 전 공개·추천 반영이 없다는 기존 안내와 적격 조건은 유지한다.

## 실행 증거

- `pnpm test tests/unit/reviewer-visit-components.test.ts`: 변경 전 6 PASS/1 FAIL. 최종 확인에 요청하지 않음 표시가 없어 실패했다.
- `pnpm test tests/unit/reviewer-visit-components.test.ts tests/unit/reviewer-visit.test.ts`: 변경 후 16 PASS.
- `BASE_URL=http://127.0.0.1:5189 pnpm exec playwright test tests/e2e/reviewer-golden-preview.spec.ts`: desktop/mobile × 요청/비요청 4 PASS. 선택→해제→재선택의 사유 보존, 최종 확인 문구, 실제 multipart 요청의 `golden`/`goldenReason` 일치를 확인했다.
- `pnpm run typecheck`, `pnpm run build` 통과. `pnpm audit --prod --audit-level high`: 알려진 운영 의존성 취약점 0.
- 화면 증거: `2026-11-18-golden-preview-{yes,no}-{chromium,mobile-chromium}.png`. 초기 촬영의 고정 영역 겹침을 피하려고 데스크톱은 문서 위에서, 모바일은 확인 목록을 실제 스크롤한 화면에서 다시 촬영했다.

격리한 합성 계정과 코드로 생성한 단색 이미지를 사용했다. 제출 요청은 브라우저에서 기록한 다음 Worker에 전달되기 전에 차단했다. 따라서 DB·사진 저장·실제 Golden Pick 신청은 0회다. 이 검증은 확인 UI와 전송 값의 일치 증거이며 운영 공개·권리 확인의 증거가 아니다.
