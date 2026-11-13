# 리뷰어 개인정보 안내 사실 대조

- 기준: #385, 병합 backend #382 (`3bc7758`). 원격 D1·운영 배포·실제 자료 삭제·법적 시행 검증이 아닌 로컬 공개 문안 대조다. #360은 OPEN이고 두 페이지는 출시 전 검토본을 유지한다.
- 명령: `pnpm run test:e2e tests/e2e/privacy-disclosure.spec.ts --project=chromium --project=mobile-chromium`
- 결과: desktop/mobile 2/2 PASS, 22.9초. 각 case에서 `/privacy`, `/terms`를 익명으로 열어 HTTP 200·제목·초안 표시·변경 본문과 수평 overflow 없음을 확인했다.
- [개인정보 desktop](privacy-chromium.png), [개인정보 mobile](privacy-mobile-chromium.png), [이용약관 desktop](terms-chromium.png), [이용약관 mobile](terms-mobile-chromium.png). 4장을 직접 열어 새 수집·공개·보존/재시도 문구의 줄바꿈과 초안 상태를 확인했다.
- 기존 legal-withdraw-copy case는 두 페이지의 실제 React 렌더 본문과 `/me` 자기 탈퇴 링크·연결정보/검수 이력 보존 설명을 검증한다. 좁은 unit 2 PASS, typecheck/build PASS, production audit 0. 새 source mirror unit은 추가하지 않았다.
- 사진·계정 정리 로직이나 보관기한은 바꾸지 않았다. 승인 전 비공개, 본인 철회/탈퇴의 사진 삭제 실패 재시도, ADMIN 회수의 보존, 자유 문안·감사 관계키의 현재 잔존을 문안에 반영했다.
