# CST U05/T02 추천·비추천 취소 검증

- 추적: #367 / SSOT #354. 담당 Jay/Codex, 2026-11-13 KST.
- 기준: main `ce841c1` + 본 PR. 로컬 격리 Workers/D1·합성 QA 계정만 사용했다.
- 원인: 공개 상세의 action schema가 vote/save만 허용하고 UI 취소가 없어서 기존 withdrawVote backend를 사용할 수 없었다.
- RED: 새 route 통합시험에서 withdraw가 HTTP400 INVALID_REACTION으로 거절되어 3실패/1통과.
- GREEN: 관련 route/vote/taste-learning Workers 통합시험 22/22, desktop Chromium·mobile Pixel7 E2E 2/2, typecheck/build/diff-check 통과. 운영 의존성 audit0(조회 시점).
- E2E: 추천→비추천 변경→평가 취소→reload, 반응 초기화·저장 유지 확인. 화면은 합성 장소의 취소 전/후다.
- 권한: 로그인/동일origin·공개장소 조회 후 인증된 user/place만 사용하며 client userId/placeId는 신뢰하지 않는다. 반복 취소 이력 중복0, 타인/타장소 feedback·저장·수동 취향 보존, 취소한 추론 신호 제거를 확인했다.
- 실패: feedback 삭제를 먼저 실행한다. 해당 삭제 실패 시 vote는 유지하고 성공을 반환하지 않으며 재시도 후 취소를 확인했다. feedback 제거와 기존 withdrawVote는 별도 호출이므로 원자적 단일 트랜잭션은 아니다. 뒤 단계 실패를 성공으로 처리하지 않는다. 파생 취향 재계산 실패는 기존 경로처럼 정제된 코드로 기록한다.
- 범위: PlaceDetailSheet의 저장 흐름/CSS·평가 source core는 바꾸지 않았다. 전체 T02/실사용 실증·운영 배포/라이브 Worker RSI 완료 증거가 아니다.
