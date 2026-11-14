# B09 장소 운영 영향 미리보기 적용 — 2026-11-14

- 상태: #439의 ACCEPTED_IMPLEMENTATION. 필수 CI·독립 검토·병합 후 아래 한정 운영 작업을 실행한다.
- 담당: Jay/Codex(root), backend/SQL은 admin_p0_home, route/UI는 admin_p0_identity. #397은 HOLD다.
- 대상: 기존 계정 `7543330c65069ee2df1b7b353fb0201c`, Worker `retaste-beta`, D1 `retaste-production`(`5181489d-83a7-4f78-9384-db096cadaa2d`). 기존 R2·두 cron·기능 flag·provider는 유지한다.

## 변경과 검증 계약

공개 한 건, 병합 한 쌍, 회수 한 건, 검증된 회수 영수증의 역작업 한 건을 각각 B02 작업으로 처리한다. 미리보기는 원천 검사와 영향 조회만 수행한다. 관련 데이터의 고정 정렬 snapshot을 해시로 보관하고, 확정 때 재조회/비교한 원문을 일시 바인딩한 동일 SQL 조건을 원자 batch에서 검사한다. 대상·근거·저장/반응 등 관련 자료가 바뀌면 전체 적용0이다. 최대 행/바이트 상한을 넘으면 별도 승인 없는 대량 처리를 하지 않는다.

기존 공개 검수·분류·원천/업종 기준을 유지한다. 공개/추천 후보 적격성과 개인별 순위를 구분하고, GENERAL만 전달·기존 target 반응 및 명시적 저장 선택 우선·guest 선택 한도를 보존한다. 리뷰/사진 검수 상태와 원장/R2는 삭제하지 않는다. 병합의 자동 분리를 약속하지 않고, 과거 MERGE snapshot이나 임의 status 복원으로 공개 검수를 우회하지 못하게 한다. 다중 공개 선택은 변경 없이 단일 선택 안내를 제공한다.

필수 로컬 검증은 preview 무변경, 현재 관리자/세션/재인증, snapshot 읽기 전후 경합과 원자 rollback, PLACE/후보 공개 기준, GENERAL·저장 선택·원장/사진 보존, 회수/지원되는 역작업·동일 영수증 재조회에 한정한다. UI는 desktop/mobile 및 HTTP 경계를 확인한다. 수정하지 않은 기능의 반복 로컬 전체 검사는 추가하지 않는다. 저장소 필수4CI와 독립 diff 검토는 유지한다.

## 운영 전환

1. 공통0049·서버·UI·운영 계획을 합친 PR의 필수4CI와 독립 리뷰 후 squash merge한다. primary checkout의 최신 main을 빌드하고 production audit와 Wrangler dry-run을 확인한다.
2. 현재 운영 version/source, binding/vars/두 cron, 대기 migration이0049 하나인지 확인한다. 비공개0700 폴더/0600 파일에 실행 원문을 보관한다.
3. 같은 빌드·같은 디렉터리의 설정을 복제해 `CST_MAINTENANCE=true`, `assets.run_worker_first=true`만 바꿔 배포한다. 공개/로그인/관리자/정적자산/RSI 503와 no-store, 최소60초 drain, 저장 로그의 이전 HTTP/예약 호출 종료를 확인한다. 미확인 실행이 있으면 DB 전환을 진행하지 않는다.
4. D1 Time Travel bookmark와 export1개를 확보한다. 장소/분류/원천·투표/저장·리뷰/사진·작업/수정/감사·권한 관련 기존 행의 정렬 digest 및 핵심 집계를 기록한다. 백업 사본 확보를 실제 복원 성공으로 표현하지 않는다.
5. `pnpm exec wrangler d1 migrations apply DB --remote`로 `0049_admin_place_contract.sql`을 한 번 적용한다. 0049는 B02 작업 kind만 확장하고 operation/commit/check rowid·기존 필드·FK/guard를 보존한다. pending0·FK위반0·기존 digest 동일을 확인한 후 같은 빌드의 정상 설정을100%로 배포한다.

## 한정 live와 정리

- 이미 감사로 지정된 비탈퇴·인증·미제한 ADMIN에 임시30분 세션을 고유 ID 한 개만 만든다. 최근 재인증 보증·신규 사용자·실제 장소 공개/병합/회수/역작업·메일·외부유료호출은0이다.
- 관리자 목록/기존 검수·병합 화면과 익명 거절, 잘못된 입력/과거 임의복원/교차출처 거절, no-store를 확인한다. 기존 공개 장소 한 건의 회수 미리보기와 재인증 없는 확정 거절을 확인하며 실제 상태 변경은0이다. 해당 대상이 없으면 빈 상태와 미실행을 기록한다.
- B06의 새 kind 필터, 공개 상세/사진을 읽기 확인한다. 기존 ADMIN RSI POST를1회 실행해 고정6경로·감사1행·같은 Worker의 저장된 정상 종료를 대조한다. 재시도0이며 점검 중 skip을 성공으로 합산하지 않는다.
- finally에서 이번 고유 세션과 해당 세션/actor에 묶인 PENDING만 조회해 정확 ID로 삭제하고 잔존0을 확인한다. 자격 정보는 원격 INSERT 전에 로컬에 저장하여 응답 유실에도 정리할 수 있게 한다. 기존 감사·확정 이력·공용 rate limit은 지우지 않는다.
- 총 수동HTTP50, D1 데이터/관리 조회80, export1·migration1·고유ADMIN세션1·RSI1이 상한이다. 클라이언트 판정 오류 교정은 첫 실패를 보존하고 같은 세션 ID·기존 만료 이하·남은 한도 안에서만 한다. React Router의 사전 CSRF 차단400/Bad Request와 route403을 구분한다.

## 장애와 결과 기록

불일치/실패 시 같은 schema의 점검 fence를 유지하고 원인을 확인해 전진 수정한다. 구 Worker로 위험 변경 경로를 재개하거나 전체 D1을 임의 복원하지 않는다. 실제 복원·R2 삭제·권한 확대는 이 범위가 아니다.

기능 병합, 실제 배포, 합성 양성 검증, 한정 live를 구분해 SSOT와 위키에 기록한다. 최종 결과 문서 PR은 다시 운영 배포하지 않는다. B09 완료를 전체 ADMIN 또는 T01–T08·현장실증 완료로 확대하지 않는다. 다음 B10과 #397 HOLD, 12/10 내부 검수·실증 준비 및 12/18 납품기한은 유지한다.
