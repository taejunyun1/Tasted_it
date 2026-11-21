# 제공받은 장소 목록 보관과 전라도 공개 범위

2026-11-21 · [#474](https://github.com/taejunyun1/Tasted_it/issues/474) · [#475](https://github.com/taejunyun1/Tasted_it/pull/475) · Jay/Codex · **운영 읽기 전용 사전점검 완료 / 반입 보류**.

사용자가 제공한 공유 목록 855곳과 별도 제보 1곳을 모두 보관한다. 이 목록에서 공개 검수를 받을 수 있는 범위는 광주·전남·전북의 식당과 카페다. 타지역 440곳이나 비식음료·근거가 부족한 장소는 공개 목록에서 제외한다. 주점 17곳은 식사 장소인지 확인이 필요하다. 기존 광주·전남 공공데이터·NAVER·EV의 지역 연결 설정은 독립적으로 유지한다.

| 지역 | 전체 | 공개 검수 후보 |
| --- | ---: | ---: |
| 광주 | 155 | 112 |
| 전남 | 203 | 125 |
| 전북 | 58 | 30 |
| 전라도 밖 | 440 | 0 |
| 합계 | 856 | 267 |

267곳은 제출 가능한 초안 후보다. 26곳은 동명, 중복 가능성, 식사 여부, 영업 상세 또는 업종을 추가 확인한다. 563곳은 비노출이다. 공개 목록 108곳과 이름을 대조했다. 기존 D1의 비공개 초안과 같은 주소·유사 상호 및 최신 상태는 운영 검수에서 대조한다. 사진 1장과 직접 전달받은 추천 메모는 내부 확인용이다. 이미지 권리는 `UNVERIFIED`이며 방문·영업 시각, 공개 평점이나 리뷰어 표를 만들지 않는다.

## 반입과 공개 검수

1. `0061_private_place_intake.sql`은 기존 D1에 비공개 배치와 행 테이블을 추가한다. 목록이 빠짐없이 들어가야 `READY`가 되며 재반입 시 라벨·행 수·지역·원문 값 등을 비교한다. `scripts/place-intake.mjs`의 `stagePrivatePlaceIntake(db,text)`는 신뢰된 D1 바인딩을 받는다. 공개 장소, 등급, 사용자 데이터와 R2는 이 경로의 쓰기 대상이 아니다.
2. 입력은 `retaste-place-intake-v1` JSON이다. 최대 1,000행·1.5MB이며 저장은 40행 단위의 준비된 쿼리를 한 D1 batch로 실행한다. 이번 856행은 INSERT 22회와 배치 시작·완료 2회다. 파일 위치·외부 플랫폼 ID·원문 링크는 비공개 증빙에 보관한다.
3. `planPrivatePlaceDrafts`는 광주·전남·전북 식당·카페 조건을 통과한 행만 기존 관리자 CSV 형식의 `DRAFT`로 작성한다. 관리자 가져오기는 초안까지만 저장하므로 운영에서 쓸 때는 기존 공개 장소·비공개 후보의 중복을 다시 대조하고 각 장소의 검수 항목을 만든다. 현행 자동 NAVER 검수는 전북을 지원하지 않아, 확인 가능한 수동 근거와 기존 최종 승인 절차를 검토한다. [장소 공개 절차](./poi-registration.md)
4. 검수를 통과한 지역·장소만 공개한다. 사진 권리와 사용 허락은 사진 검수에서 확인한다. 후보가 전라도 밖으로 이동했거나 식사 제공이 불명확해진 경우 검수에서 제외한다.

## 운영 승인과 복구

필수 CI 통과와 승인된 운영 범위가 확인되면 배포 담당자가 정확한 D1 대상, 쓰기·검수 상한, 현재 장소 수와 원본 보존을 확인한다. B17 고정 9개 마이그레이션과 이 migration을 같은 적용으로 계산하지 않는다. 이 PR은 외부 API, 제공권한, 운영 쓰기, 원격 migration을 실행하지 않는다. 비공개 저장 실패 시 배치가 되돌아간다. 생성된 초안의 공개를 취소해야 하면 정확한 place ID만 기존 검수 회수 절차로 처리한다. 자료의 삭제·보관 기한은 운영 승인 시 결정하고, 원본 사진은 확인 전 업로드하지 않는다.

## 확인 결과

격리된 workerd 로컬 D1에서 실제 자료 856건 저장·일치 재반입, 타지역 440건 전부 `HIDDEN`, 지역별 후보 267건, 운영 후보 CSV의 기존 파서 통과와 canonical 신규 0건을 확인했다. 별도 합성 테스트는 전북 포함, 경기도 광주 제외, 동명 중복, 분류 미등록, 불완전·상이한 보존 배치의 거절을 검증한다.

## 11월 21일 추가 장소 검수

초기 후보 267건과 확인 대기 26건, 총 293건에 행별 판정을 기록했다. 운영의 장소·인허가를 읽기 전용으로 대조했고, 식품안전나라·공식 상권자료·지자체·사업자 근거를 함께 확인했다. 공개 업체검색에서 광주·전남 후보 90건에 응답을 받았다. 이후 서비스가 반복 조회를 제한해 147건의 상호 조회 응답과 도로명 재조회 자료는 얻지 못했다. 자료가 없는 업체를 폐업으로 판정하지 않았다. 9월 상권자료의 존재 정보는 현재 영업의 보조 자료로 사용했다. [식약처 업체검색](https://www.foodsafetykorea.go.kr/portal/specialinfo/searchInfoCompany.do?menu_grp=MENU_NEW04) · [공식 상가정보](https://www.data.go.kr/data/15083033/fileData.do)

자료 검수 통과는 85곳(광주 37, 전남 26, 전북 22), 보류는 204곳, 기존 장소 중복은 3곳, 공개 제외는 1곳이다. 85곳은 자료 검수 결과이며 B09의 최종 공개 승인 기록은 별도로 필요하다. 전체 856건의 최신 반입본은 후보 85, 추가 확인 204, 비노출 567이다. 타지역 440건은 모두 비노출이다. 원본과 각 판단의 출처를 비공개로 보존했다.

## 통과 85곳의 관리자 검수 연결

- 기존 인허가 검수 15곳은 정확한 검수 항목 ID와 인허가 ID, 단계 버전, 상호·주소·좌표를 대조해 연결한다. 기존 단계와 버전은 그대로 유지한다. 12곳은 출처 검수, 2곳은 NAVER 확인, 1곳은 최종 승인 대기 단계에서 이어간다.
- 70곳은 `DRAFT` 장소와 `SOURCE_REVIEW` 검수 항목으로 생성한다. 관리자 검수에는 **사용자 제공 목록**으로 표시한다. 상호 또는 정확한 검수 항목 ID로 찾을 수 있다. 신규 ID는 `intake:<batchId>:<position>`이고 기존 ID는 비공개 연결 계획에 있다. 신규 항목은 학생 검수와 예약 NAVER 자동 조회에서 제외한다.
- 공개는 관리자 장소 운영의 B09 미리보기·커밋을 거친다. 단계별 근거, 영업·식사 여부, 최종 분류, 중복 판정과 승인 기록이 필요하다. 전북 등 자동 확인이 없는 항목은 확인 가능한 수동 근거를 남긴다. 최초 연결 이후 상호·주소·좌표가 달라지거나 현재 지역과 원장 지역이 불일치하면 해당 항목의 공개를 막고 재검수한다.
- 실제 비공개 자료와 기존 검수 상태를 재현한 격리 로컬 D1에서 856곳 보관, 15곳 연결, 70곳 신규 초안, 타지역 440곳 비노출, 재실행 중복 0, 신규 공개 0을 확인했다. 실제 운영 연결 직전에는 해당 검수 항목의 최신 상태와 중복을 다시 조회한다.

## 운영 반입 사전점검

2026-11-21 23:32 KST 운영 D1에서 읽기 전용으로 확인했다.

| 확인 대상 | 운영 조회 결과 |
| --- | --- |
| `0050`·`0051` | 모두 미적용. 원장의 최신 항목은 `0049_admin_place_contract.sql`이며, `0050`의 평가 작업 lease 컬럼과 `0051`의 공공 수집 attempts 컬럼이 없다. `0061`·`0062`도 원장과 대상 테이블에서 미적용이다. |
| LINK 15곳 | 고정 계획 대비 단계·버전 변경 0곳. 출처 검수 12곳(v0), NAVER 확인 2곳(v1), 최종 승인 대기 1곳(v5). 전부 활성·미점유이며 인허가 ID와 상호·주소·좌표가 일치한다. 활성 제외, 기존 장소 연결, 운영 장소와의 중복 후보는 각각 0곳이다. |
| CREATE 70곳 | 운영 장소 756곳(공개 108·초안 2·숨김 646)과 대조해 장소 중복 0곳, slug 충돌 0곳, 반입 계획 내부 중복 0곳을 확인했다. 인허가 후보 1,611건을 상한 도달 없이 조회했다. 동일 상호·주소 1곳과 동일 상호·도로명·건물번호로 층·호 확인이 필요한 8곳을 찾았다. 9곳 중 7곳은 기존 활성 검수, 2곳은 활성·보류 검수 항목이 없다. 대조 범위에서 나머지 61곳은 일치 후보가 없었다. |

**운영 반입 보류.** 동일 인허가 1곳은 신규 초안 생성을 보류하고 인허가 기반 검수로 검토한다. 같은 건물의 8곳은 상세 주소와 지점을 확인해 기존 검수 연결, 인허가 검수 생성 또는 신규 초안 중 해당 경로를 정한다. 검수 결과를 반영한 입력과 연결 계획을 새로 고정하고, 보관본은 856곳 전체를 유지한다. 쓰기 직전에 다시 대조한다. 행별 증빙은 비공개로 보관했다.

## CI 복구 후 실행

1. 최종 PR 커밋의 필수 CI 네 항목이 통과하면 PR을 병합한다. 배포 담당자는 병합된 `main`에서 대상 Worker·D1 계정/ID, Time Travel 복구 지점, 현재 버전, 장소 기준 집계와 적용 migration 목록을 확인한다. 마지막 확인에서 `0050`·`0051`은 대기 중이었다. 해당 변경의 운영 절차와 적용 결과를 먼저 확인한다. 전체 대기 migration을 일괄 적용하거나 B17 후보 DB를 사용하지 않는다.
2. 정확히 `0061_private_place_intake.sql`과 `0062_place_intake_review_links.sql`만 대기함을 확인한 뒤 표준 D1 migration을 적용한다. 새 테이블·가드와 외래키 검사를 확인하고, 병합된 Worker를 배포한 뒤 관리자 검수와 공개 목록의 사전 스모크를 확인한다. 이 시점에는 목록 입력이 없다.
3. 배포 담당자는 기존 계획 SHA-256 `c7130bc0f62ea92c8e8f9d54543a546ec36d426484b8581b57aa2d3547685e6d`의 사용을 보류한다. 중복 판정이 반영된 승인 계획과 비공개 856건 입력의 SHA-256 및 LINK·CREATE 건수를 병합된 PR에서 확인한다. 기존 장소, 기존 인허가·검수 항목과 신규 대상의 중복을 읽기 전용으로 다시 대조한다. 근거, 상태 또는 대상이 바뀌면 실행을 멈추고 재검수한다.
4. 배포 담당자는 검증된 관리자 ID, 비공개 두 파일, 승인 계획 SHA-256과 LINK·CREATE 건수, 그리고 확인한 운영 D1 하나만 `binding: "DB"`, `remote: true`로 설정한 별도 Wrangler JSON을 로컬 환경 변수로 제공한다. 설정의 계정과 DB ID를 독립적으로 대조한 뒤 병합된 저장소 루트에서 아래 명령을 실행한다. [Wrangler D1 바인딩 실행 API](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)

   ```sh
   node --input-type=module <<'NODE'
   import { readFileSync } from "node:fs";
   import { getPlatformProxy } from "wrangler";
   import { enrollPrivatePlaceIntake } from "./scripts/place-intake-enrollment.mjs";

   const { RETASTE_INTAKE_CONFIG, RETASTE_ACCOUNT_ID, RETASTE_D1_ID, RETASTE_ADMIN_ID,
     RETASTE_INTAKE_FILE, RETASTE_INTAKE_PLAN, RETASTE_APPROVED_PLAN_SHA256, RETASTE_EXPECTED_LINK,
     RETASTE_EXPECTED_CREATE } = process.env;
   const previousPlan = "c7130bc0f62ea92c8e8f9d54543a546ec36d426484b8581b57aa2d3547685e6d";
   if (!/^[a-f0-9]{64}$/.test(RETASTE_APPROVED_PLAN_SHA256 ?? "") || RETASTE_APPROVED_PLAN_SHA256 === previousPlan
     || !/^\d{1,2}$/.test(RETASTE_EXPECTED_LINK ?? "") || !/^\d{1,2}$/.test(RETASTE_EXPECTED_CREATE ?? "")) {
     throw Error("PLACE_INTAKE_REVISED_PLAN_REQUIRED");
   }
   const expectedLink = Number(RETASTE_EXPECTED_LINK);
   const expectedCreate = Number(RETASTE_EXPECTED_CREATE);
   const input = readFileSync(RETASTE_INTAKE_FILE, "utf8");
   const plan = readFileSync(RETASTE_INTAKE_PLAN, "utf8");
   const entries = JSON.parse(plan).entries;
   if (JSON.parse(input).rows.length !== 856 || entries.length !== expectedLink + expectedCreate
     || entries.filter((entry) => entry.mode === "LINK").length !== expectedLink
     || entries.filter((entry) => entry.mode === "CREATE").length !== expectedCreate) {
     throw Error("PLACE_INTAKE_COUNT_MISMATCH");
   }
   const config = JSON.parse(readFileSync(RETASTE_INTAKE_CONFIG, "utf8"));
   const [db] = config.d1_databases ?? [];
   if (!RETASTE_ACCOUNT_ID || !RETASTE_D1_ID || config.account_id !== RETASTE_ACCOUNT_ID
     || config.d1_databases?.length !== 1 || db?.binding !== "DB"
     || db.database_id !== RETASTE_D1_ID || db.remote !== true) {
     throw Error("PLACE_INTAKE_TARGET_MISMATCH");
   }
   const proxy = await getPlatformProxy({ configPath: RETASTE_INTAKE_CONFIG, remoteBindings: true, envFiles: [], persist: false });
   try {
     const { batchId, total, linked, created, state } = await enrollPrivatePlaceIntake(proxy.env.DB, input, plan, {
       actorUserId: RETASTE_ADMIN_ID,
       approvedPlanSha256: RETASTE_APPROVED_PLAN_SHA256,
     });
     if (total !== 856 || linked !== expectedLink || created !== expectedCreate) throw Error("PLACE_INTAKE_COUNT_MISMATCH");
     console.log({ batchId, total, linked, created, state });
   } finally {
     await proxy.dispose();
   }
   NODE
   ```

5. 비공개 보관과 검수 등록은 각각 원자적으로 저장한다. 검수 등록이 거절되면 이번 연결·초안 쓰기는 모두 되돌아가고, 이미 성공한 `READY` 보관본은 남는다. 재시도 전 보관·검수·감사 상태를 읽고 입력과 계획을 대조한다. 정상 재실행은 동일 결과의 `EXISTING`을 반환한다. 856건 보관, 승인한 LINK·CREATE 건수, 타지역 440건 검수 연결 0, 신규 `PUBLISHED` 0, 등록 감사 1건을 확인한다.
6. 승인 기록과 커밋 증빙이 있는 항목의 장소 ID를 모은다. 신규 초안은 검수 항목의 `place_id`, 기존 인허가는 `place_source_links`로 확인한다. 이 ID 집합과 해당 배치에서 실제 `PUBLISHED`인 집합을 비교하고 모든 행의 지역과 식당·카페 분류를 다시 확인한다. 비로그인 목록·지도·상세에서 승인 장소를 확인하고 보류·타지역·비식음료 미노출을 확인한다. 전북 지도는 해당 주소 방향으로 이동해 확인하고, 비공개 초안 상세 URL은 404인지 확인한다. Worker RSI 결과도 기록한다.
7. 공개 집합 불일치 시 추가 공개를 중단한다. 잘못 노출된 정확한 장소 ID만 B09 회수로 처리하고 목록·지도·상세를 재확인한다. 비공개 원본과 연결·감사 이력을 보존한다. 해당 범위의 결과를 SSOT와 위키에 남긴다.
