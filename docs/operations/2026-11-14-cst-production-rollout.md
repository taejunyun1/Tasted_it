# CST 운영 배포·필수 live 검증 — 2026-11-14

- 상태: **GO — 이 문서를 포함한 PR 병합 시 아래 한정 작업 실행 승인**. 실행 완료와 전체 T01~T08 수용은 별도다.
- 담당·소유: Jay/Codex(root), #401. 사용자의 운영 배포·필수 live 검증 요청에 따른다. #399 ADMIN 확장 계획·#400 TEMP100은 별도 범위다.
- 소스 기준: main `4ae8abf` 및 이 PR의 병합 main. Wrangler 4.118.0/pnpm 10.34.5, 기존 스택·계정·바인딩을 유지한다.
- 대상: 계정 `7543330c65069ee2df1b7b353fb0201c`, Worker `retaste-beta`, D1 `retaste-production` / `5181489d-83a7-4f78-9384-db096cadaa2d`, 기존 `REVIEW_PHOTOS` 버킷. 공개 주소는 기존 배포 런북을 따른다.

## 확인된 기준선

2026-11-14 KST 읽기 확인: 운영 version `510c79ff-7e45-4c1d-acea-2dde795c5b0b`(11/5), D1 최신0039, 대기0040·0041만 있다. 원격 plain vars는 소스와 일치한다. secret은 이름/존재만 확인했으며 값은 열람하지 않는다. 사진 업로드false·학생/온보딩true·두 cron 유지. 기존 운영 ADMIN·사용자 역할·초대·좌석·원문은 보존한다. #397은 dev bootstrap cold504로 분리하며 compiled build/live 차단 증거가 없으면 HOLD다.

| 적용할 불변 migration | SHA-256 |
| --- | --- |
| `0040_reviewer_moderation.sql` | `035d0671b2a299be116739ef191e8341f828a6039a2f589d847f730067b66905` |
| `0041_guest_saved_places.sql` | `adb67a55155834046d3121b7064d1c82a556aa36b0437326cb77b22cdb74a655` |

0040은 레거시 리뷰·사진을 자동 승인하지 않고 `LEGACY_UNREVIEWED`/비공개·집계 제외로 전환한다. 이는 승인된 CST 정책의 적용이며 원문/R2 파일 삭제가 아니다. 적용 전후 리뷰/사진/원문 핵심 집계와 초대·좌석 digest를 비공개 기록에서 대조한다. 실제 권리·방문 근거가 없는 자료를 승인하거나 운영에서 합성 리뷰를 발행하지 않는다.

## 작업 순서와 중단 조건

모든 원격 명령에 `CLOUDFLARE_ACCOUNT_ID=7543330c65069ee2df1b7b353fb0201c`를 지정한다. 기존 지정 계정 인증을 사용한다. Cloudflare connector는 다른 계정만 제공하므로 프로젝트 Wrangler를 사용한다. CLI 인증 갱신/권한 확대/새 공급자는 이 계획에 없다.

1. 필수4 CI·diff/독립 리뷰 후 PR을 squash merge한다. 병합된 main만 빌드·배포한다. `pnpm run build`, `pnpm exec wrangler deploy --config build/server/wrangler.json --dry-run`을 확인한다. 운영 의존성 audit0, fence 경계 unit/typecheck/build를 확인하며 full local suite는 반복하지 않는다.
2. private 운영 디렉터리0700·파일0600을 준비한다. `wrangler deployments list`, D1 migrations list·사전 집계/digest를 저장한다. 현재 버전이 기준선과 다르거나 대기 migration/해시가 다르면 중단하고 계획을 갱신한다.
3. 생성된 `build/server/wrangler.json`을 **같은 디렉터리**의 `wrangler.cst-fence.json`으로 복사하고 오직 `vars.CST_MAINTENANCE="true"`, `assets.run_worker_first=true`만 바꾼다. 이름·DB/bucket·상대경로·cron·다른 vars 동일과 두 필드 diff/파일 hash를 확인한다. clone에는 assets binding이 없으므로 정적 자산도503이며 이 경고는 의도된 점검 동작이다. 정상 config는 assets 기본 라우팅을 유지한다.
4. `pnpm exec wrangler deploy --config build/server/wrangler.cst-fence.json --message cst-schema-fence`로 먼저 전면 점검 Worker를 배포한다. `/`, `/places`, admin POST, 사진 GET/HEAD, RSI, 기존 hashed asset이 503/no-store인지 확인한다. fetch·scheduled 모두 DB/R2/session/RSI 전 차단하며 인증 예외가 없다. 점검 중 RSI skip을 PASS로 세지 않는다. 새 요청 차단 확인 후 최소60초 drain한다. fence 이전에 시작된 구 version HTTP/cron은 저장 Observability의 시작·scheduled 시각과 terminal 결과를 대조해 완료/중단을 확인한다. 오래된 마지막 완료시각이나60초 경과만으로 구 실행 부재를 판단하지 않는다. running·관측 공백·미확인 또는503가 아닌 앱 응답이 있으면 apply하지 않고 fence/관측을 유지한다.
5. fence 상태에서 `pnpm exec wrangler d1 time-travel info DB --json` 복구 bookmark와 `pnpm exec wrangler d1 export DB --remote --output=<private>/pre-migration.sql` 1회를 보관한다. 원문을 출력/커밋하지 않고 크기·hash·SQL 구문/테이블 존재만 확인한다. 백업은 운영자만 접근하며12/10 인수 후 삭제/연장 결정을 남긴다. 새 외부 저장소·자동 백업 job은 만들지 않는다.
6. `pnpm exec wrangler d1 migrations apply DB --remote`로 위2개만 순서대로1회 적용한다. 실패 시 같은 migration 재시도로 덮지 않고 실제 적용 목록/오류를 확인하며 fence를 유지한다. 이전 성공 migration은 남을 수 있다. 적용 후 대기0·핵심 집계/초대digest 동일·legacy비공개·source 분류·신규 테이블/뷰를 읽기 확인한다.
7. **같은 빌드**의 원본 `build/server/wrangler.json`(CST=false/assets기본)을 `pnpm exec wrangler deploy --config build/server/wrangler.json --message cst-production-rollout`로 배포한다. version·트래픽100%·설정 drift0을 확인한다. 정상 배포가 실패하면 fence 유지/재배포로 닫고 전진 수정한다.
8. 아래 필수 live를 수행하고 결과를 비공개 원본/비식별 증거·CST SSOT·wiki에 반영한다. 완료 표시는 실제 결과만 사용한다. 공개 출시/법적 사실/실증 참여·사진 양성 승인 완료를 의미하지 않는다.

## 필수 live와 정확한 쓰기 한도

- 공개 smoke6경로(`/`, `/places`, `/login`, `/admin`→로그인302, `/robots.txt`, `/privacy`), 검색0건/일반검색, 공개 목록→상세(추적 query없음), 익명 보호경로 로그인 이동, 존재하는 레거시 사진 GET/HEAD404·no-store/Vary:Cookie를 확인한다. 공개 원문/실제 주소/사진 ID는 private 기록에만 둔다.
- 신 schema guest 저장은 기존 공개 적격 장소1개에서 신규 전용 guest session1개로 **저장→상태확인→취소→상태확인**만 수행한다. 동일 origin POST2회, 평점/표/리뷰/회원선택 변경0. 작업 후 해당 guest session 정확ID만 삭제(cascade저장0)하고잔존0을 확인한다. IP rate-limit 계수/감사는 기존 보존대로 두며 일괄 삭제하지 않는다.
- RSI token은 현재 없다. 기존 브라우저에 ADMIN session도 없으므로 **기존 `OPERATOR_ADMIN_PROVISIONED` 감사가 지정한 별도 운영 ADMIN에만**30분 임시 session1개를 만든다. 기존 개인계정·계정역할·비밀번호·메일·초대 변경0. `INSERT ... SELECT`에서 audit target/user ID·ADMIN·비탈퇴 조건이 유일한1행인지 확인하며 `crypto.randomUUID()`와 UTC만료를 사용한다. 새 장기 토큰/secret/cron/권한 부여는 하지 않는다. 이 session은 기술적으로 전체 ADMIN bearer이므로 **GET `/admin/operations/rsi-check`405와 동일 origin POST `intent=run`1회** 외에는 사용하지 않는다. cookie/SQL은0600 private파일, 값/실계정정보 출력0. POST재시도0; HTTP200·ok=true·고정6경로와 같은시각 `rsi-admin` 감사1행을 대조한다. 실패는읽기진단하며 PASS로 덮지 않는다. 성공/실패 모두 finally에서 정확 sessionId+userId1행 삭제·잔존0 확인한다. 이 방식은 로그인/인증메일/자격증명 검증을 대체하지 않는다.
- guest→회원 승계·추천취소·리뷰어 승인 양성은 기존 exact CI의 기술증거를 유지한다. 이 운영점검에서 가짜 방문/평점 공개·전역 업로드 활성화로 양성결과를 만들지 않는다. 실자료권리 승인 없는 운영 양성은 NOT_RUN이며 전체 검수의 별도 미완료다.
- 총 수동 HTTP60회 이하(브라우저 자산 요청 제외), D1집계/read40회 이하·백업1·migration2·임시session1·RSI1·guest1. timeout/실패면 추가scope를 자동 확대하지 않는다. 실제 이메일/WorkersAI/유료외부API호출0, 새상품/구독/한도증액0. 기존 Worker/D1 단발 사용량만 발생한다. 반복감시/로컬collector를 재시작하지 않는다.

## 캐시와 복구

기존 사진 응답은 browser3600초/shared86400초 캐시를 선언했다. workers.dev 서비스에 별도 Zone cache purge 권한/대상이 없으면 임의 zone전체 purge를 하지 않는다. 새 직접 GET/HEAD gate404/no-store로 검증하되 **기존 browser/edge 캐시·다운로드 회수를 보장하지 않으며 최대 기존 TTL 노출 가능성은 별도 잔여**다. 알려진 사진 URL은 쿠키 없는 새 요청에서확인하고 Cache-Status/CF-Cache-Status/Age를기록한다. 캐시HIT로사진이보이면전환완료판정중단·fence유지와해당cache정책확인이필요하다.

0040 적용 후 **구 version `510c79ff...`로 단순 rollback 금지**: 구 route는 승인상태를 무시하고 새표출처를GENERAL기본으로쓸수있다. 기본복구는 이 PR의 same-schema fence config를 재배포해503로 닫은 뒤 호환 전진수정한다. 작업중보관한 fenceversion으로 Worker rollback이가능한지도한정확인하며 connected D1/R2는코드와함께복원되지않는다. D1 TimeTravel복원은실제장애/승인범위재판정후 별도수행이며자동실행하지않는다. 이미삭제된사진을백업에서자동재유입하지않는다.

## 결과 기록

실제 배포version/503창/migration/검증·정리 결과는 실행 후 아래에 추가한다. 현재는 실행전이며 로컬 성공을livePASS로세지않는다. [CST SSOT](../plans/2026-11-13-cst-service-ssot.md), [인수 실행서](./cst-acceptance.md), [증거 원장](../evidence/cst-20261210/README.md)을 따른다.

공식근거: [D1 migration 명령](https://developers.cloudflare.com/d1/wrangler-commands/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [Worker rollback 자원제약](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
