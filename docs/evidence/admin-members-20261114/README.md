# B07 회원 관리 화면 검증

로컬 합성 계정으로 데스크톱 Chromium과 Pixel 7 크기에서 회원 관리 화면을 확인했다. 운영 계정·데이터·외부 인증·메일은 사용하지 않았다.

## 검증 결과

- 타입 검사 통과. `tests/e2e/admin-members.spec.ts` 2개 프로젝트 통과.
- 회원 ID 검색과 선택, 이름·가린 이메일·역할·접근 상태 표시.
- 조회 대상의 원문 이메일과 bearer 세션 ID가 응답 HTML에 포함되지 않음.
- `private, no-store` / `Vary: Cookie`, 가로 넘침 없음, 브라우저 오류 없음.
- 교차 출처 POST는 React Router 자체 CSRF 보호에서 400으로 거부됨. route의 동일 origin 보호를 제거하지 않았다.
- 제한 사유·1일 기간 미리보기 후 재인증 없는 확정은 재인증 화면으로 이동하며 같은 operation URL을 보존함.
- `saved=1`만 주어진 URL에서는 확정 성공을 표시하지 않음. 성공 표시는 서버에서 조회한 COMMITTED 영수증에만 근거한다.

실제 제한 확정·해제, 만료·동시성·로그인 차단은 별도 D1 통합 검증 범위다. 이 브라우저 검증은 접근 상태를 변경하지 않았다.

## 화면

- [회원 관리 데스크톱](member-console-desktop.png)
- [회원 관리 모바일](member-console-mobile.png)
- [변경 미리보기 데스크톱](member-preview-desktop.png)
- [변경 미리보기 모바일](member-preview-mobile.png)

명령: `pnpm exec playwright test --config /tmp/admin-members-playwright.config.ts tests/e2e/admin-members.spec.ts`

임시 설정은 기존 `playwright.config.ts`의 동일 로컬 fixture를 재사용하고 포트만 5274로 분리했다. 테스트·프레임워크·의존성을 추가하지 않았다.
