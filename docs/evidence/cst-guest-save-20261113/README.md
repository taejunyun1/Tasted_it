# CST W04 비회원 임시 저장·승계 기술 증거

- 추적: #368, CST SSOT W04/T03. 운영·실제 이용자 실증 증거가 아닌 격리 합성 시험이다.
- runtime RED: 기존 guest merge가 회원 USER 배지 evidence/updatedAt을 덮는 현상을 재현(17 중1실패), 충돌 시 회원값 보존 후17통과. RED/GREEN checkpoint `14e8643`/`a72f597`.
- focused Workers/D1 integration: guest-saves service/resource, guest-merge, save 6파일43시험 통과(계정 탈퇴·기존 lifecycle 포함). cap50 동시삽입·기존save/unsave·타계정·만료cascade·batch실패rollback/재시도·입력/CSRF·네트워크·IP해시한도를 포함한다.
- desktop/mobile Playwright: 저장→reload→해제503→같은 해제 재시도→로그인 원래 상세복귀/승계, 실제 로컬 D1병합실패→로그인 성공/원본cookie유지→root 명시retry→성공cookie정리. 5통과·desktop 전용 quick sheet1건 SKIP(2026-11-13 KST). 최종 검증 SHA와CI는 PR의 exact head로 기록한다.
- 사진은 합성 장소·테스트 계정만 사용한다. 각 프로젝트의 guest-saved/merge-retry 화면은 실제 시험이 저장했다. 공급자·메일·remote D1·production 배포0.
- 전체 unit170파일1615통과·53기존 opt-in SKIP, typecheck/build 통과. 전체 integration 첫 실행은85파일466통과·1파일1실패였으며, 성공merge 후guest배지잔존을 요구하던 구계약 기대를 cleanup+회원배지보존으로 갱신하고 해당파일을 재시험한다. exact head CI에서 전체 결과를 확인한다.
- /places의 쉼표 bbox를 auth returnTo로 옮길 때 기존 header link의 SSR/client percent-encoding 차이 hydration 경고를 관측했다. 핵심 흐름 결과와 분리해 #365 후속 진단으로 전달했고 문구로 숨기지 않았다.
