# B09 장소 운영 영향 미리보기 적용 — 2026-11-14

- 상태: #439의 DEPLOYED / VERIFIED_LIVE_SCOPED. #440 필수4CI·독립 검토·병합 후 한정 운영 작업을 실행했다. 아래는 승인 당시 절차이며 실제 결과와 관측 대체는 마지막 절을 따른다.
- 담당: Jay/Codex(root), backend/SQL은 admin_p0_home, route/UI는 admin_p0_identity. #397은 HOLD다.
- 대상: 기존 계정 `7543330c65069ee2df1b7b353fb0201c`, Worker `retaste-beta`, D1 `retaste-production`(`5181489d-83a7-4f78-9384-db096cadaa2d`). 기존 R2·두 cron·기능 flag·provider는 유지한다.

## 변경과 검증 계약

공개 한 건, 병합 한 쌍, 회수 한 건, 검증된 회수 영수증의 역작업 한 건을 각각 B02 작업으로 처리한다. 미리보기는 원천 검사와 영향 조회만 수행한다. 관련 데이터의 고정 정렬 snapshot을 해시로 보관하고, 확정 때 재조회/비교한 원문을 일시 바인딩한 동일 SQL 조건을 원자 batch에서 검사한다. 대상·근거·저장/반응 등 관련 자료가 바뀌면 전체 적용0이다. 최대 행/바이트 상한을 넘으면 별도 승인 없는 대량 처리를 하지 않는다.

기존 공개 검수·분류·원천/업종 기준을 유지한다. 공개/추천 후보 적격성과 개인별 순위를 구분하고, GENERAL만 전달·기존 target 반응 및 명시적 저장 선택 우선·guest 선택 한도를 보존한다. 리뷰/사진 검수 상태와 원장/R2는 삭제하지 않는다. 새 관리자 세션에서도 원래 회수의 commit·감사·회수 직후 snapshot이 검증돼야 새 역작업을 준비한다. 병합의 자동 분리를 약속하지 않고, 과거 MERGE snapshot이나 임의 status 복원으로 공개 검수를 우회하지 못하게 한다. 다중 공개 선택은 변경 없이 단일 선택 안내를 제공한다.

필수 로컬 검증은 preview 무변경, 현재 관리자/세션/재인증, snapshot 읽기 전후 경합과 원자 rollback, PLACE/후보 공개 기준, GENERAL·저장 선택·원장/사진 보존, 회수/지원되는 역작업·동일 영수증 재조회에 한정한다. UI는 desktop/mobile 및 HTTP 경계를 확인한다. 수정하지 않은 기능의 반복 로컬 전체 검사는 추가하지 않는다. 저장소 필수4CI와 독립 diff 검토는 유지한다.

## 운영 전환

1. 공통0049·서버·UI·운영 계획을 합친 PR의 필수4CI와 독립 리뷰 후 squash merge한다. primary checkout의 최신 main을 빌드하고 production audit와 Wrangler dry-run을 확인한다.
2. 현재 운영 version/source, binding/vars/두 cron, 대기 migration이0049 하나인지 확인한다. 비공개0700 폴더/0600 파일에 실행 원문을 보관한다.
3. 같은 빌드·같은 디렉터리의 설정을 복제해 `CST_MAINTENANCE=true`, `assets.run_worker_first=true`만 바꿔 배포한다. 공개/로그인/관리자/정적자산/RSI 503와 no-store, 최소60초 drain, 저장 로그의 이전 HTTP/예약 호출 종료를 확인한다. 미확인 실행이 있으면 DB 전환을 진행하지 않는다.
4. D1 Time Travel bookmark와 export1개를 확보한다. 장소/분류/연결된 원천·투표/저장·리뷰/사진·작업/수정/감사·권한 관련 기존 행의 정렬 digest 및 핵심 집계를 기록한다. 백업 사본 확보를 실제 복원 성공으로 표현하지 않는다.
5. `pnpm exec wrangler d1 migrations apply DB --remote`로 `0049_admin_place_contract.sql`을 한 번 적용한다. 0049는 B02 작업 kind만 확장하고 operation/commit/check rowid·기존 필드·FK/guard를 보존한다. pending0·FK위반0·기존 digest 동일을 확인한 후 같은 빌드의 정상 설정을100%로 배포한다.

## 한정 live와 정리

- 이미 감사로 지정된 비탈퇴·인증·미제한 ADMIN에 임시30분 세션을 고유 ID 한 개만 만든다. 최근 재인증 보증·신규 사용자·실제 장소 공개/병합/회수/역작업·메일·외부유료호출은0이다.
- 관리자 목록/기존 검수·병합 화면과 익명 거절, 잘못된 입력/과거 임의복원/교차출처 거절, no-store를 확인한다. 기존 공개 장소 한 건의 회수 미리보기와 재인증 없는 확정 거절을 확인하며 실제 상태 변경은0이다. 해당 대상이 없으면 빈 상태와 미실행을 기록한다.
- B06의 새 kind 필터, 공개 상세/사진을 읽기 확인한다. 기존 ADMIN RSI POST를1회 실행해 고정6경로·감사1행·같은 Worker의 저장된 정상 종료를 대조한다. 재시도0이며 점검 중 skip을 성공으로 합산하지 않는다.
- finally에서 이번 고유 세션과 해당 세션/actor에 묶인 PENDING만 조회해 정확 ID로 삭제하고 잔존0을 확인한다. 자격 정보는 원격 INSERT 전에 로컬에 저장하여 응답 유실에도 정리할 수 있게 한다. 기존 감사·확정 이력·공용 rate limit은 지우지 않는다.
- 총 수동HTTP50, D1 데이터/관리 명령30회 및 SQL 조회96개, export1·migration1·고유ADMIN세션1·RSI1이 상한이다. 관련 테이블 조회는 한 명령에 묶되 실제 SELECT 개수도 별도 집계한다. 클라이언트 판정 오류 교정은 첫 실패를 보존하고 같은 세션 ID·기존 만료 이하·남은 한도 안에서만 한다. React Router의 사전 CSRF 차단400/Bad Request와 route403을 구분한다.

## 장애와 결과 기록

불일치/실패 시 같은 schema의 점검 fence를 유지하고 원인을 확인해 전진 수정한다. 구 Worker로 위험 변경 경로를 재개하거나 전체 D1을 임의 복원하지 않는다. 실제 복원·R2 삭제·권한 확대는 이 범위가 아니다.

기능 병합, 실제 배포, 합성 양성 검증, 한정 live를 구분해 SSOT와 위키에 기록한다. 최종 결과 문서 PR은 다시 운영 배포하지 않는다. B09 완료를 전체 ADMIN 또는 T01–T08·현장실증 완료로 확대하지 않는다. 다음 B10과 #397 HOLD, 12/10 내부 검수·실증 준비 및 12/18 납품기한은 유지한다.

## 실행 결과와 관측 대체 — 2026-11-14

- 통합 main `e96360c2c0dc4b7d619262021ef8001ad373bac9`, 정상 Worker `d285759b-d529-4ea0-a7e9-9cf88b3e7cf1` 100%. 점검7경로·96초 drain·비공개 백업1 후0049 한 번 적용했다. 25개 관련 테이블의 기존 값·rowid·권한·이력 보존, FK위반0을 확인했다. 인허가/제외 비교는 장소에 연결된 자료 범위다.
- 관리자 조회/입력·출처·과거 복원 거절·미확정 회수 미리보기/재인증 없는 거절, B06 필터·공개 상세/사진·RSI6/6/감사1행을 확인했다. 실제 장소 변경0, 최종 세션/미확정 작업0이다.
- 채팅 브라우저 접근 불가, MCP 다른 계정, 저장 query403으로 **병합 #440 본문의 관측 대체 계획**을 적용했다. 기존 인증의 Wrangler tail JSON을 비공개 수집해 관측된 이전 읽기1·점검7호출과 새 RSI의 정확 scriptVersion/outcome ok를 확인했다. 새 인증·secret/권한/설정 변경0이다. 최신 scheduled RSI 성공 감사와 두 cron의 최근 시작 가능 시각이 [scheduled 최대15분](https://developers.cloudflare.com/workers/platform/limits/#duration)을 지난 창임을 대조했다. 모든 과거 HTTP가60초로 강제 종료됐다는 주장은 하지 않으며 구체 미확인 실행이 관측되면 보류한다는 조건을 유지했다.
- 수동HTTP28/50, D1 데이터명령15+관리3=18/30, 실제SQL조회93/96, export1·migration1·고유ADMIN세션1·RSI1이다. [실행 증거](../evidence/cst-20261210/b09-place-live-20261114.json)와 합성 서버/UI의 초기 실패·교정 기록을 보존했다. 운영 검증 자체는 재시도/실패 없이 끝났다. 실제 양성 장소 변화·실제 재인증·복원·전체T01–T08·현장실증은 NOT_RUN, #397 HOLD다.
