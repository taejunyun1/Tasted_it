# B15 현재 설정 선택 일관성 검증

Issue #463. 기준 main `941a205`. 현재 rating-v2.0 숫자·seed는 유지하고, `active_until NULL + 지원 버전 + 유효한 active_from<=요청시각`을 getter·4개 raw CAS·enqueue/job/snapshot/read·maintenance refill에 공통 적용했다. 새0060은 publication trigger만 교체하며 기존 행·rowid·FK를 보존한다.

- 미래/미지원 설정 fallback0. 적격 없음은 명시 오류/ADMIN503, 자동 publication은 stale+job0+기존 운영 경보다. 소유자의 리뷰 철회를 중단하지 않는다.
- 일반표 철회는 이미 반영된 원장·삭제를 보존하고, 알려진 config 부재/변경만 경보로 기록해 성공을 유지한다. DB·경보 쓰기 실패는 숨기지 않는다.
- 예전 설정의 fresh snapshot/대기 job이 현재 설정 refill을 막지 않는다. 완료 job 이력은 저장 COMPLETED/시도수를 보존하고 현재 적격성과 다르면 NONCURRENT로 응답한다.
- vote fixture의 반응 시각은 seed 설정 시작(8/6) 이후로 보정했다. 실제 과거 데이터를 바꾼 것이 아니다.

| 검사 | 결과 |
| --- | --- |
| 관련 D1 integration 13파일 | 74 PASS |
| typecheck / build / diff-check | PASS |
| 로컬 ADMIN200/503 desktop/mobile | 2 PASS, 320px 전체 넘침0 |
| production dependency audit | 알려진 취약점0 |
| 독립 리뷰 | PASS, 초기 refill/철회/설정소실/replay 지적 보완 |

UI 증거는 합성 로컬 D1만 사용하고 외부 HTTP를 차단했다. 현재 seed+미래 메타데이터는HTTP200, seed 자체를 미래로 만든 경우HTTP503·no-store와 명확한 안내를 확인했다. 사진 `desktop.png`, `mobile-320.png`는 해당 503 상태다. 실제 운영 자료/계정·API 호출0, migration 원격 적용·배포0이다. 전체 개발 의존성 audit의 기존47건 부채는 앞선 B15 증거와 같고 manifest/lock변경은 없다.

적용/운영 검증은 부모의 합동 B17 rollout에 따른다. 새 migration은 `drizzle/0060_rating_config_eligibility.sql`이며 이전 적용 SQL을 고치지 않는다. 실제 정책값 활성화·복원 UI와 새 정책 승인은 이 변경에 포함하지 않는다. #397 HOLD.
