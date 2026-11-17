# B15 평가 실효값·합성 비교 검증

- Issue #452, 기준 main `941a205`. `/admin/rating-config`의 ADMIN 조회와 합성 비교만 추가했다. 새 설정 저장·활성화·실제 재계산·원시표/snapshot 쓰기·migration·외부 호출은 없다.
- 점수 최소8/Beta(2,2)/리뷰어30%는 고정한다. DB 최소표본은 리뷰어 신뢰 비교에 실제 소비됨을 구분한다. 다른 DB 점수값은 메타데이터이며 코드 점수 산식의 새 정책으로 취급하지 않는다.
- 미래 날짜·지원하지 않는 버전의 선택 문제는 경고로 표시했다. getter만 바꾸면 기존 SQL CAS/publication trigger와 어긋나므로 이 조회 PR에서 일부만 고치지 않았다. 날짜·버전 일관성 및 설정 활성화/복원은 후속 범위이며 정책 필요 상태다.

| 검증 | 결과 |
| --- | --- |
| 신규 합성 비교 + 기존 rating-v2 unit | 34 PASS, RED→GREEN |
| ADMIN 조회/합성 비교 D1 integration | 4 PASS, RED→GREEN |
| 기존 rating-recompute D1 회귀 | 4 PASS |
| typecheck / build | PASS |
| 로컬 desktop/mobile E2E | 2 PASS · Enter 제출·320px 전체화면 넘침0·pageerror0 |
| pnpm audit --prod | 알려진 취약점0 |
| 전체 pnpm audit --audit-level high | FAIL: 기존 의존성47건(critical1/high16/moderate26/low4), manifest/lock 변경0 |

사진은 합성 로컬 D1 설정과 표본만 사용한다. 브라우저의 외부 HTTP는 차단했다. `desktop.png`, `mobile.png`, `320.png`를 시각 검수했다. 표는 320px에서 가로 스크롤하고 입력은 한 열로 배치한다. 원본 스타일과 동일한 글꼴·색상·간격 토큰을 사용한다.

운영 배포·live RSI는 부모 통합 담당 범위이며 이 증거를 운영 완료로 세지 않는다. 배포 후 읽기/일반사용자 거절·RSI를 확인하고 해당 결과를 별도 기록한다. 코드 rollback은 PR revert이며 새 schema/자료 복원 작업은 없다. #397 HOLD 유지.
