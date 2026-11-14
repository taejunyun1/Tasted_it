# B06 감사 이력 조회 운영 적용 — 2026-11-14

- 상태: 구현/운영 구체 범위. 이 문서를 포함한 기능 PR의 필수 검증·독립 리뷰·병합 후 GO.
- 담당 Jay/Codex. #424 사용자 요청에 따른 B06만 적용하며 #397은 HOLD를 유지한다.
- 대상: 기존 Cloudflare 계정 7543330c65069ee2df1b7b353fb0201c / Worker retaste-beta / D1 retaste-production(5181489d-83a7-4f78-9384-db096cadaa2d). 기존 두 cron·bindings·비밀값·인증 공급자 변경0.

## 구현/수용

현재 ADMIN 서버 판정 → 제한된 cursor 목록/단일 영수증 읽기. 기존 /admin/audit와 B02 변경경로는 보존한다. cursor는 같은 시각의 id tie-break와 필터 결속, page상한50. 원문 payload/summary.title/before-after/result/세션·메일을 반환하지 않으며 감사와 영수증은 action/target_type/target_id를 모두 검증해 연결한다. COMMITTED는 실제 외부 작업 성공과 구분하며 재계산은 jobId로 현재 상태를 별도 표시한다.

## 배포와 live 한도

1. 최종 main SHA·기존 active Worker/마지막 적용 migration·신규 migration hash를 기록한다. 기존 감사/작업 영수증/역할·학생권한·초대 집계를 비공개0700/0600에 보관한다.
2. 신규 `0045_admin_activity_read_indexes.sql`은 읽기 성능용 additive 인덱스 3개만 추가한다: 감사·작업의 `(julianday(created_at), id)` 정렬과 감사의 `(action, target_type, target_id, actor_user_id)` 연결이다. 혼합된 기존 시각 원문은 수정하지 않는다. local D1 query plan/fixture 검증 후 이전 Worker가 그대로 동작하는 상태에서 먼저 적용하고 신규/기존 자료 보존을 재확인한다. 기존 migration/테이블/원장/역할/세션 계약은 수정하지 않는다. 추가적인 data backfill·전체복원·일괄 삭제0. additive index만으로 인한 변경에는 전면 서비스 차단이나 별도 전체 DB 복원을 수행하지 않는다.
3. 병합 main만 기존 pnpm build/Wrangler 경로로 배포하고 새 version100%를 확인한다. 설정 drift시 멈추고 원인확인하며 provider/binding/cron 추가나 secrets 읽기/출력0.
4. 기존 감사가 지정한 검증용 ADMIN의 역할을 유지한 임시30분세션 최대1개를 만들어 /admin/activity(빈값/필터/cursor/영수증)·기존 /admin/audit의 응답을 확인한다. 세션에는 최근 재인증을 부여하지 않는다. 실제 계정의 역할/비밀번호 변경, 이메일발송, 평가·CSV·콘텐츠 변경은 없다. 해당 정확한 session만 finally삭제 후 잔존0확인한다.
5. 익명 /admin/activity와 잘못된 cursor/직접 POST는 적절히 거절하고 모두 no-store/Vary Cookie인지 확인한다. 기존 공개/상세/사진은 읽기 smoke만, 실제 Worker RSI ADMIN POST 1회(내부6경로) 및 감사1행/Worker로그를 확인한다.

최대 수동HTTP40회, 운영자 D1 read20회(집계와정리포함), 신규 migration1회, 임시ADMIN1개/정리1회, RSI1회. 유료 외부 API/메일/AI0, 제품 도메인 변경0. 소스/화면에 raw자료·개인정보·자격값을 기록하지 않는다. 추가 TEMP사진은 #425의 별도 대상/한도 계획이며 B06만으로 허용하지 않는다.

## 복구/완료

신규 인덱스는 이전 Worker의 동작을 바꾸지 않으므로 직전 같은 schema 호환 정상 version으로 복구할 수 있다. index삭제/테이블DROP/DB전체복원은 이번범위가 아니다. 사진 변경이 합류하면 해당 photo-sidecar의 공개중지 규칙도 따른다. 완료는 병합·실제배포version·권한/커서/비노출·RSI·정리 증거와 SSOT/wiki 갱신까지이며 합성 fixture성공을 실제운영작업완료로 확대하지 않는다.


## 실제 실행 결과 — 2026-11-14

두 기능 PR의 필수4CI·독립리뷰 이후 main `652d959`를 Worker `6e5d8d8e-4ae0-474e-9d7c-2998138e09e6`에 배포했다. 0045/0046 적용·구Worker공개200 유지, 새사진77 R2 put/get·단일사진batch77행/감사1행과기존자료불변을 확인했다. ADMIN읽기/페이지/영수증/권한·잘못된요청·민감값제외·no-store·무변이, 사진100카드/77실GET해시·대표HEAD/기존사진/404·RSI6/6/감사/Worker로그·세션0을 확인했다.

검증기1차는 기존root로그인의현재사용자ID를B06누출로오인해 중단했고, assertion범위를정정했다. 병렬사진1건은30초타임아웃을보존하고 system curl단일읽기에서200/동일해시(1.0초), Worker정상종료를확인했다. 최초사용한동일세션ID·원래만료를유지한재사용2회이며유효기간/권한확대0, 마지막잔존0이다. 수동HTTP는95회(B0610·사진84·이전Worker확인1), R2 PUT77/검증GET77, 새유료API/메일0. 구체hash·시각·초기실패·한정검증경계는 [비식별 증거](../evidence/cst-20261210/b06-temp-photo-live-20261114.json)에 기록한다.
