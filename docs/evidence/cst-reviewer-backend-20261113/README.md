# CST 검수 backend와 평가 취소 증거

- 범위: #359 backend 부분 진행, #369 취소의 현재 event pointer·원자 feedback 보완. 운영 배포·원격 D1 실행 없음.
- 환경: 격리한 로컬 D1/R2와 합성 QA 계정·장소. 실제 사용자 자료 없음.
- 명령: `pnpm run test:e2e tests/e2e/vote-withdraw.spec.ts --project=chromium --project=mobile-chromium`
- 결과: desktop/mobile 2/2 PASS. 추천→비추천→취소→재로드 후 평가 없음과 저장 유지 확인. 취소 form은 표시된 event ID를 서버에 전달하고, stale ID는 409로 최신 반응을 보존한다.
- [desktop 취소 전](desktop-before.png), [desktop 취소 후](desktop-after.png), [mobile 취소 전](mobile-before.png), [mobile 취소 후](mobile-after.png). 생성 이미지 중 desktop 전·mobile 후를 직접 열어 확인했다. 화면에 남은 focus용 본문 건너뛰기 링크는 기존 UI의 focus 상태다.
- 리뷰어 제출·검수 화면 UI는 후속 PR 범위다. 이 증거가 검수 UI 또는 운영 적용 완료를 뜻하지 않는다.
