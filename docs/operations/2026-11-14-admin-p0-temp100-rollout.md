# ADMIN P0 · TEMP100 운영 적용 — 2026-11-14

- 상태: GO 범위 명세. 실행 결과는 별도 증거에만 기록한다. #408, 담당 Jay/Codex.
- 대상: 기존 계정 `7543330c65069ee2df1b7b353fb0201c`, Worker `retaste-beta`, D1 `retaste-production`/`5181489d-83a7-4f78-9384-db096cadaa2d`, 기존 REVIEW_PHOTOS R2. provider/binding/cron/유료 구독 추가 없음.
- 사전 기준: 2026-11-14 KST 확인한 정상 version `f5b49eb9-a3ee-4367-906d-c22db249d930`/100%, 최신 D1 0041. drift가 있으면 실행 전 원인을 확인한다.

## 승인 범위와 순서

필수 CI·독립 리뷰를 통과한 P0/TEMP PR을 모두 병합한 main만 빌드한다. 합쳐진 schema·route·권한 계약을 마지막 집중 시험으로 확인한다. 0042/0043/0044의 실제 파일 hash를 증거에 고정한다.

1. 현재 배포/DB 상태와 기존 역할·리뷰/사진·저장 핵심 집계를 private0700/0600에 기록한다. 기존 전면 fence 방식(CST_MAINTENANCE=true, assets.run_worker_first=true)으로 동일 빌드의 점검 버전을 배포한다. 공개·관리·자산·RSI503/no-store를 확인한다.
2. 최소60초 drain과 최근 cron/요청의 실제 terminal 증거를 확인한 뒤 D1 TimeTravel bookmark·export를 각각1회 보관한다. 구 실행 미확인이나 drift이면 migration을 적용하지 않는다.
3. 승인된 신규0042~0044만 순서대로 적용한다. 오류면 fence유지, 부분 적용 상태 확인, 같은 schema 전진 수정. 기존0040/0041·원문 자료 변경 없음. 정상 config를 배포하고 새version100%를 확인한다.
4. TEMP 승인 원본100개의 고정manifest/hash를 기준으로만 준비한다. 원본은 private보관하며 source code에 반입하지 않는다. 동일장소 기존 사용자 선택·공개상태를 덮지 않고 충돌을 중단한다. 좌표는 기존 NAVER adapter로 최대100회/각1회(추가 retry0) 실증하고 모호/불일치/실패가 남으면 전체 공개를 보류하고 공식 출처 확인으로 보완한다. 100개 모두 실제 좌표·대상이 확인된 뒤 공개한다. 새 API/provider나 quota 증액 없음.
5. 실제 사진23개는 검증된 라이선스·출처·hash의 파일만 기존버킷 전용TEMP prefix로 업로드한다. 나머지77개의 외부 사진은 복제/inline하지 않는다. 공개 설명은 직접 요약하고 외부 평가 출처는 내부 점수와 분리한다. 사진/별점/방문 근거를 만들지 않는다.
6. 공개는 이 PR에서 승인한 고정manifest의 운영자용 원자 batch로 적용할 수 있다. 구체적으로 전용 audit action/고정 batch ID에 결속한 1회성 trigger를 생성해 감사 INSERT 한 문장에서 대상 검사와 공개를 실행하고, 성공/실패 뒤 정확한 trigger를 제거한다. CLI 파일/manifest hash는 병합 전 PR 본문과 실행 영수증에 고정한다. UI의 최근인증 요구를 끄거나 SQL로 가짜 최근인증을 만들지 않는다. CLI batch는 같은 대상/version·전량 준비·건수검사와 감사기록을 유지한다. 일반 UI는 B02+B03 그대로 적용한다. 이 명세는 #416/#417/#418 및 TEMP 구현 PR이 모두 필수 검증 후 병합됐을 때만 실행 가능하다.

## 필수 live·상한

새 Worker의 공개 목록/검색/상세/지도 데이터·TEMP표시·실사진응답·사진없는상태·출처링크를 확인한다. 대표1곳 guest저장→읽기→취소→읽기만 실행한다. 외부평가를내부점수로합산하지않고 신규추천/리뷰/투표를생성하지않는다.

기존 감사기록이 지정한 별도 운영ADMIN만 임시30분세션1개로 ADMIN홈/재인증안내/권한목록/TEMP목록 읽기와 RSI단1회를 확인한다. 실제 로그인대체·가짜권한상승·메일발송·새ADMIN생성0. 이 세션에는 최근인증을부여하지않아위험확정이거절되는지도확인한다. 성공/실패모두exact세션과전용guest를정리하고잔존0을확인한다. 세션/쿠키/이메일원문은출력하지않는다.

총 수동HTTP160회 이내(좌표100포함, browser정적자산/Worker내부RSI6GET별도), D1 read60회이내, backup1·migration3·R2upload23/검증read23·공개대상100·RSI1·임시ADMIN1·guest1. NAVER호출비용은기존quota에서최대100회이며한도증액/WorkersAI/메일발송0. 실패하면자동재시도·범위확대하지않고같은대상의실제상태를조회한다.

## 복구·보존

schema 적용 후 pre0040 Worker rollback금지. 실패하면 same-schema fence로닫고전진수정한다. TEMP공개회수는이번batch가새로만든place만HIDDEN, 기존연결place상태불변. R2삭제는이번전용prefix의정확23key만대상이며원본사진/원장삭제0. 0042/0043/0044를수동DROP하거나D1전체복원하지않는다. 실제DB복원은별도판정이다. 비공개백업/원본은12/10인수후보존결정대상이다.

완료는 배포version·migration·카탈로그건수·실제live·RSI·정리결과로만판정한다. 전체T01–T08/실증/외부OAuth실로그인/권리미확인사진77개/ADMIN P1이후는별도잔여다. #397은실제운영차단없으면HOLD를유지한다.

## 사진·자료 선행 확인

공식 출처 좌표63개와 23개 실사진의 private 증거를 준비했다. 사진 contact sheet에서 식사/실내만 확인했고 눈에 보이는 인물·차량번호는 없었다. 23파일 메타데이터 검사에서 EXIF0/JFIF만 확인했다. 이는 모든 개인정보 부재나 영업/최종 권리 검수 전체 완료를 보장하는 판정은 아니다. 나머지37좌표는 아직 운영 검증 전이며 수치를 확보 완료로 바꾸지 않는다.
