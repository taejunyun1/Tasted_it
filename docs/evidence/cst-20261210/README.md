# CST 12/10 검수 증거 원장

상위 [실행계획 SSOT](../../plans/2026-11-13-cst-service-ssot.md), 하위 [검수 절차](../../operations/cst-acceptance.md)를 따른다. [execution-log.csv](./execution-log.csv)의 초기 8행은 **NOT_RUN** 표시이며 실제 실행 결과가 아니다.

- 실행마다 새 run_id로 행 추가; 과거 실패/skip·재시험 연결 보존.
- 실제 실행의 SHA·환경·시각·증거 없이는 PASS로 표시하지 않는다.
- 증거 파일에는 합성 데이터와 비식별 결과만 저장한다. 토큰/초대/학생·참여자 개인정보, 실제 상호·주소·사진 원문, 내부 승인 서명/개인자료는 공개 저장소에 넣지 않는다.
- 운영 데이터/실증 원자료는 권한 있는 별도 저장소에 두고 허용된 비식별 참조와 집계만 연결한다.
- 실제 실증·콘텐츠 검수·운영 배포/복구는 기술시험과 분리한다. 원장 템플릿 생성은 그 작업의 수행을 의미하지 않는다.
- `T02.CANCEL_SERVER`처럼 마침표 뒤 하위 case는 명시된 부분 검증만 PASS다. 최초 T01~08 전체 행은 해당 전체 시나리오를 완료하기 전까지 NOT_RUN을 유지한다. CI의 `source_sha`는 job 로그의 실제 checkout SHA이며 feature head·병합 SHA는 연결 PR에 남긴다.

## 2026-11-13 선행 조사

main `471a3eb`에서 PDF U01~U09/D01~D06/S01~S08/T01~T08의 코드/시험 존재를 대조했다. 이는 현재 기술 검수나 운영 실측이 아니다. 지도 query 손실, 추천 취소 UI, guest 임시저장/승계, 리뷰어 사전 승인/사진 gate·권리 메타데이터, 상세 정정 연결을 선행 결함/정책 항목으로 식별했다. 정확한 상태와 작업 링크는 SSOT·#354에서 관리한다.

## 2026-11-13 부분 시험 등록

- #369 기본 취소: PR head `063040b`, CI checkout `4fbf0bc`, integration 84파일450건 PASS. 연결 증거 [CI job](https://github.com/taejunyun1/Tasted_it/actions/runs/43425146034/job/131884631599), [desktop/mobile 검증](../cst-vote-withdraw-20261113/README.md), 병합 `a01e6e8`. 동시성/출처 보완은 #359 후속이다.
- #372 guest 저장/승계: PR head `8247237`, CI checkout `a366224`, integration 86파일467건 PASS. 연결 증거 [CI job](https://github.com/taejunyun1/Tasted_it/actions/runs/43428197684/job/131894767185), [로컬 사용자 흐름/실패 재시도](../cst-guest-save-20261113/README.md), 병합 `b469063`. 모바일 장소 전환 실패 P2의 최초 RED와 수정 GREEN을 보존했다. 외부 인증·운영 승계·전체 T03 합격은 주장하지 않는다.
- PR #374 최초 unit의 기존 RSI injected 시험 5초 timeout은 동일 head 실패 job 재실행에서 통과했으며 최초 실패는 PR 댓글/Actions에 보존한다. 원인은 UNKNOWN이다. 새 main 통합 head `25db0d6`의 최종4CI도 통과해 `3a1090c`로 병합했다.
- #373의 `/privacy` URL 이후 heading 누락은 #365 재발이며 원인 미확정이다. #376은 최종4CI/독립리뷰 뒤 `3ab7256`로 병합했다. 임시 빈 모듈 주입은 진단 JSON이 assertion 실패를 보존하는 시험일 뿐, 실제 CI 원인 재현·수정으로 세지 않는다.
- #382 backend: PR head `af42310`, 실제 CI checkout `9dc78a6`, integration90파일535건 PASS. 로컬 기능 동결 시534건 이후 #381의 비중첩 응답 유실 시험1건이 합쳐진 최종 CI 수치다. [CI job](https://github.com/taejunyun1/Tasted_it/actions/runs/43432995653/job/131910931413), [사진·출처/경합·취소 증거](../cst-reviewer-backend-20261113/README.md), 병합 `3bc7758`. 후속 승인 UI와 운영 적용까지 완료된 것으로 세지 않는다.
- #378의 0040 병합 전 초기 D1 authorizer 실패를 FAIL 행으로 보존했다. 이 로컬 행 시각은 원본 report의 실행 시작시각이다. 이후 main `3bc7758`에서 **0040/0041 포함43개 migration·212개 schema 객체·69개 도메인 테이블/157행**의 source/restored schema/data digest·quick/FK·scratch 전체 integrity와 손상/누락 거절을 실제12.675초에 확인했다. [비민감 aggregate](./d1-local-roundtrip-main-3bc7758.json)에 종료시각·source/script/migration hash를 기록했다. 실제 D1/R2 운영 복원·삭제 후 복원 처리·전체 T08은 별도다.
- #384/PR #386은 산식을 바꾸지 않고 9표·리뷰어만 있는 집계·정확80% 간접 군집·신뢰/감쇠→점수85/79·외부평점 배제의 고정 기대값을 추가했다. [독립 계산/집중21 unit·18 integration](../cst-rating-fixtures-20261113/README.md), 최종 CI checkout `a310f68`의 unit1629 PASS/53 SKIP·integration535 PASS, 병합 `1c31bc1`을 연결했다. 최초 assertion GREEN을 새 제품 결함 RED→GREEN으로 과장하지 않으며 전체 T06·운영 성능·실증과 구분한다.
- #383/PR #389은 320px 및 640px+CSS zoom2의 검색버튼/실패 지도 RED2→GREEN8을 확인했다. [실행 source/time·합성 SDK·화면 증거](../cst-category-map-layout-20261113/README.md), source `ce476f0`, 병합 `f0ca8e0`·최종4CI/독립리뷰다. CSS 확대는 실제 브라우저/핀치 확대, 합성 SDK는 실제 지도 타일, 부분 시험은 전체 T07 합격의 증거가 아니다. 공통 헤더의 작은 화면 사진 관측은 별도 측정 대상으로 남긴다.
- #359/PR #390의 [UI 실행 메타데이터](../cst-reviewer-moderation-20261113/verification.json)는 실제 checkout과 미커밋 상태(`LOCAL_DIRTY_SYNTHETIC`), 후속 동일 소스 보존 commit, 결과 로그의 최종 mtime을 분리한다. 원장의 UI6/native RED1→GREEN2/권한 integration1 행은 이 로그시각이며 독립 측정한 프로세스 종료시각이 아니다. 과거28·후속6·집중2를 단일 최종 head의 새 전체 실행 수로 합산하지 않는다. 검수400 사유 손실 FAIL을 보존하고 동일 review/version의 제한된 사유 복원·409/checkbox 초기화를 재검증했다.
- #390 최종 head `b77f93e`의 실제 CI checkout `9004950`에서 unit1636 PASS/53 SKIP·integration535 PASS·기존 smoke16 PASS 및 build를 확인해 `a95f9ee`로 병합했다. [CI integration](https://github.com/taejunyun1/Tasted_it/actions/runs/43440646205/job/131937062341), [CI smoke](https://github.com/taejunyun1/Tasted_it/actions/runs/43440646205/job/131937062960). #359는 코드 범위 종료이며, 이 기존 smoke16에 새로운 reviewer-moderation 브라우저 시험이 포함됐다고 주장하지 않는다. 해당 지속 회귀 편입은 #388 후속이다.
- #391/PR #392 `646392c`는 [공통 헤더 source·DOM 경계·화면](../cst-mobile-header-20261113/README.md)의 실제 RED→GREEN2/2를 바탕으로 병합했다. 320px와640px/CSS zoom2의 모바일 메뉴 normalized44px·화면 내 경계·지정 hit-test/Tab과 메뉴·목록 Enter 활성화 범위다. 웹 폰트 fallback, 에뮬레이션 및 CSS 확대의 한계와 전체 T07 미완료를 유지한다.
- #388/PR #393의 최초 확대 CI는 실제 checkout `3bcabad`에서 **22 PASS/2 SKIP/2 FAIL**(smoke5분33초)이다. [원문 job](https://github.com/taejunyun1/Tasted_it/actions/runs/43443028545/job/131945254711)의 Linux 헤더320px 오른쪽334.921875/CSS확대669.828125·hit 실패는 #394, reviewer 전체 흐름30초 초과는 #395로 분리했다. 동반 trace ZIP 오류를 원인으로 단정하지 않으며, 최초FAIL을 보존하고 기대/timeout/retry 완화 없이 원인별 후속 수정 후 재검증한다. #392 macOS 로컬 부분 성공을 Linux 전체 성공으로 확대하지 않는다.
- #397의 cold 개발 bootstrap 진단은 실제 최초504와 별도 추적한다. 후속 정상 bootstrap 관측은 회복·전체 과업 PASS로 합산하지 않았고, 추가 원본 harness 실행은 CANCELED/INCOMPLETE로 종료했다. 소스/설정 변경은 없으며 정확 원인은 UNKNOWN이다. [후속 추적](https://github.com/taejunyun1/Tasted_it/issues/397)에 범위와 다음 관측 조건을 남겼다.
- #395/PR #398 `ac01d06`은 제품 변경 없이 리뷰어 회귀를 독립3과업으로 분할해 같은30초/retry0·모든 권한/공개/사진 회수·cleanup 검사를 유지했다. [clean785c92e의 관련10PASS·단계/시각](../cst-reviewer-ci-flow-20261113/README.md)와 own최종4CI, Linux후속의 reviewer5 PASS를 구분한다. 2차 validation actual `b03d950`은 [job131963863587](https://github.com/taejunyun1/Tasted_it/actions/runs/43448422095/job/131963863587)에서 **25 PASS/2 SKIP/1 FAIL**이었다. 헤더10개 geometry/hit 진단은 통과했으나 한 case의 전체30초가 초과돼 전체PASS가 아니며 FAIL행을 보존했다. #396은 제품 동일·역할별case분할로 이어서 검증한다.
- #394/PR #396 `d986d6d`는 모바일 주요 링크를 기존 네이티브 메뉴 안으로 옮기고 짧은 높이의 내부 스크롤을 보완했다. [구조·글꼴 스트레스/역할별 분할 근거](../cst-header-responsive-20261113/README.md)를 보존했다. 제품 코드는 source3bb60e7 그대로이며 header 단일case를 익명/리뷰어로 분리해 같은30초·모든기대값을 유지했다. 최종 source 통합 CI checkout `10cb801`은 [job131971499178](https://github.com/taejunyun1/Tasted_it/actions/runs/43450620040/job/131971499178)에서 **27 PASS/2 SKIP(4.7분)**·필수4CI PASS였다. 기존16개와 제한5파일/총29개 수집이며 guest의 mobile전용2개는 SKIP다. 이전두FAIL행을 덮지 않고 같은case의재시험으로 연결했다. #396/#398 원본 병합 후 CI3파일+상위문서7파일의 최종 head 검증은 PR #393의 정확head/Actions/결과댓글을 승인 원본으로 확인한다. 전체 T01~08·운영·실증 합격으로 확대하지 않는다.
- 문서 합류 뒤 final `ce68916`/actual `d80986b`는 [job131978486221](https://github.com/taejunyun1/Tasted_it/actions/runs/43452630982/job/131978486221)에서 **26 PASS/2 SKIP/1 FAIL**이었다. anonymous320px monospace의 메뉴44×44/right306은 맞았지만 y좌표가 화면 위로 이동 중이어서 hit=false였다. 제품의 `html{scroll-behavior:smooth}`와 테스트의 `scrollTo(0,0)` 초기화 경합을 확인해, 같은 검사 전제인 scrollY0을 즉시 이동으로 고정하는 test setup만 #393 범위에 추가했다. 기존 모든 geometry/hit·30초/retry0·제품 CSS는 유지한다. 이 원장은 실행별 고정 snapshot이며 이후 최종 head의 실제 CI는 PR #393의 exacthead/Actions/결과댓글을 승인 원본으로 확인한다. 추가 결과를 기록하려고 동일 CI를 재귀적으로 반복하지 않는다.

## 2026-11-14 한정 live 검증

[production-live-20261114.json](./production-live-20261114.json)은 #403 병합 main76dce1e/운영f69c3aa5의 실제 전환·공개/검색·guest저장취소·레거시사진차단·Worker RSI6/6/감사1행·전용 시험 세션 잔존0을 연결한다. 원장 하위5case만 PASS이며 전체8case의 NOT_RUN과 과거실패를 보존한다. 백업 사본의크기/hash/접근모드는 복원 검증이 아니다. 미승인 레거시 리뷰7·사진8은원문보존/비공개이며 새승인0이다. 실제자료/쿠키/초대/백업원문·TimeTravel지점은 공개하지 않는다.

[production-guest-readiness-live-20261114.json](./production-guest-readiness-live-20261114.json)은 #406 병합 main1c63a98/운영f5b49eb9의 후속이다. 새 배포의 SSR/초기 상태 조회→활성화 desktop/mobile, guest 저장/취소, RSI6/6/감사1행·전용 세션 정리 하위3case를 추가했다. 합계는32행(PASS19/FAIL5/NOT_RUN8)이며 전체8case는 미실행으로 유지한다. 초기#402 CI 실패는 Actions 원본에 보존하며 최신main 통합의 PASS를 원인 해결로 주장하지 않는다. #397은 운영 차단 없음으로 HOLD다.


[admin-p0-temp-live-20261114.json](./admin-p0-temp-live-20261114.json)은 #419/#422에 따른 P0 운영 전환과 TEMP100 공개를 기록한다. main `dadb17b`/Worker `afeaa57e`에서 ADMIN5경로·최근인증 거절, TEMP정확100개·사진23개·검색/지도/상세·guest저장취소·RSI6/6/감사1행·시험세션/trigger정리를 확인했다. 실제권한변경/재인증메일/운영평가변이/복원·현장실증 및 전체8case는 미실행이다. 최초좌표불일치/주소출처정정/CI실패는 덮지않고 보존한다. 다음행들은 해당부분검증만 PASS이며 전체수용을 뜻하지 않는다.

최신 원장은38행(PASS25/FAIL5/NOT_RUN8)이다. 새6행의 시각은 해당 HTTP 실행 시작 기록이며, 정리 행은 D1 잔존0 확인 응답 파일의 UTC 완료시각을 KST로 변환했다. 전체 수용8행은 NOT_RUN을 유지한다.


[b06-temp-photo-live-20261114.json](./b06-temp-photo-live-20261114.json)은 #426/#427의 운영 `652d959`/Worker `6e5d8d8e`에서 B06읽기·TEMP100사진·RSI·정리를 기록한다. 첫검증기의scope오류와 사진1건타임아웃을 FAIL로 보존하고 수정된검사/독립읽기PASS와 연결한다. 새8행을추가해 총46행(PASS31/FAIL7/NOT_RUN8)이며 전체8case는미실행이다. 사진77장의권리미확인 상태와 실제운영의미실행항목은 증거JSON을 따른다.


[b07-member-live-20261114.json](./b07-member-live-20261114.json)은 #431/#433의 B07 운영 검증을 기록한다. 최초 조회도구 오류/로그인403 캐시헤더 누락을 FAIL로 보존하고 교정 후 제한·해제/새로그인·검색/재인증 거절·이력보존·RSI·정리를 확인했다. 전체 원장은 53행(PASS36/FAIL9/NOT_RUN8)이며 전체T01–T08은 여전히 미실행이다. 실제 사람 계정 변이·실제 OAuth·복원은 완료로 합산하지 않는다.

B07 원장 시각은 조회/로그인 행의 요청 시작, 스키마 행의 보존 검증 완료, RSI 행의 응답·감사 대조, 정리 행의 잔존0 확인 완료 시각으로 구분한다. 원장 시각을 모두 요청 시작 시각으로 해석하지 않는다.


[b08-people-live-20261114.json](./b08-people-live-20261114.json)은 #436/#437의 B08 합동 배포 `10a72bf`/Worker `6498fdff`와 0048 이력 보존을 기록한다. 두 관리자 화면의 조회·차단·미확정 미리보기·재인증 없는 거절, B06 필터, 공개 상세/사진과 RSI6/6·감사1행·같은 Worker 정상 종료, 최종 세션/미확정 작업0을 확인했다. 실제 리뷰어·학생 변경/초대 발급/메일은0이며 양성 변경과 경합은 각 도메인의 로컬 합성 D1/UI 증거를 따른다.

첫 live의 라우트403 예상은 프레임워크 사전 차단400/Bad Request와 달랐던 검증기 실패로 보존했다. 첫 정리0 뒤 동일 ID·기존 만료 상한으로 세션을 복원하고 정상 형식 교차 출처 요청/동일 출처 미리보기를 대조했다. 최초 리뷰어 디자인 CI2실패와 로컬 학생 HMR 응답 유실도 별도 기록에 남긴다. 새 live 하위6행을 추가해 원장은 59행(PASS41/FAIL10/NOT_RUN8)이며 전체T01–T08 8행은 미실행이다. #397은 HOLD다.

B08 원장 시각은 출처 차단 행의 요청 시작, 스키마 보존 확인 완료, 관리자 묶음 검증/RSI의 응답·감사 대조 완료, 정리 잔존 확인 완료를 구분한다.


[b09-place-live-20261114.json](./b09-place-live-20261114.json)은 #440의 통합 `e96360c`/Worker `d285759b`·0049 운영 결과다. 관련25테이블의 기존 필드·작업/감사 이력·권한을 보존하고, 관리자 조회·미확정 회수 미리보기·재인증 없는 확정 거절·출처/입력/과거 임의복원 차단·B06·공개 상세/사진·RSI6/6/감사1행·검증 잔존0을 확인했다. 실제 장소 공개/병합/회수/역작업은0회이며 양성 변화와 경합은 로컬 합성 증거다.

저장 Observability 조회403과 브라우저 미지원/다른 MCP 계정 때문에 #440이 지정한 기존 Wrangler tail·RSI 감사 대체를 사용했다. 관측된 이전 읽기1·점검7호출과 새 RSI의 정확 버전/outcome을 확인했으며 모든 과거 HTTP 종료 증명으로 확대하지 않는다. cron은 마지막 시작 가능 시각/최대15분 경계 대조다. 초기 로컬 D1쿼리/클릭안정성/회수fixture 실패는 각 서버/UI README에 보존했고 이번 운영 검증은 실패·재시도0이다.

B09 하위4행을 추가해 원장은 63행(PASS45/FAIL10/NOT_RUN8)이다. 전체T01–T08 8행·현장실증·실제 재인증·복원은 미실행, #397 HOLD다. 스키마 행은 보존 대조 완료, 관리자/RSI 행은 응답·감사 대조 완료, 정리는 잔존0 확인 완료 시각을 사용했다.
