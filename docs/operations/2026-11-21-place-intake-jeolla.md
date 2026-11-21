# 제공받은 장소 목록 보관과 전라도 공개 범위

2026-11-21 · [#474](https://github.com/taejunyun1/Tasted_it/issues/474) · [#475](https://github.com/taejunyun1/Tasted_it/pull/475) · Jay/Codex · **보류 후속 확인 및 83곳 연결 계획 갱신 / 운영 반입 대기**.

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

아래 수량은 중복 재판정 이전의 격리 검증 범위다. 현행 운영 범위는 [보류 후속 확인](#보류-2곳-후속-확인)을 따른다.

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

이 조회에서 9곳을 기존 CREATE 계획에서 보류했다. 현행 판정과 반입 입력은 아래에 기록한다.

## 중복 9곳 재판정과 갱신 계획

다음은 보류 2곳의 후속 조회 이전에 고정한 계획이다.

11월 21일 보존 지도 상세주소, 식약처 인허가, 지자체·사업자 근거와 운영 검수 이력을 대조했다. 일부 지도 상세는 재조회가 제한돼 보존 자료로 대조했다. 층·호 미기재 항목은 공란으로 유지했다. 업소의 동일성은 상호·주소·지점과 상세 주소의 일치 여부를 종합해 판단했다. [식품안전나라 업체검색](https://www.foodsafetykorea.go.kr/portal/specialinfo/searchInfoCompany.do?menu_grp=MENU_NEW04) · [소상공인시장진흥공단 상권자료](https://www.data.go.kr/data/15083033/fileData.do)

| 판정 | 수량 | 처리 |
| --- | ---: | --- |
| 동일 업소·활성 검수 확인 | 6 | 기존 검수에 LINK. 6곳은 1층이며 이 중 1곳은 103호까지 확인했다. 나머지 5곳은 호수 미기재다. |
| 동일 업소·기존 체인 제외 유지 | 1 | 공식 지점과 동일한 업소다. 층·호는 미기재다. 기존 관리자 제외를 유지하고 보관본에서 `HIDDEN`으로 둔다. |
| 동일 업소·신규 인허가 재검수 대기 | 1 | 1층 인허가와 장소가 일치하며 호수는 미기재다. 이전 관리자 제외 사유인 실제 영업 여부는 확인이 더 필요하다. 기존 제외 이력을 유지하고 `REVIEW`로 둔다. 추후 운영 여부와 제외 판단을 재검토해 승인된 `PUBLIC_DATA` 검수 경로가 확보되면 진행한다. |
| 동일 업소 미확정 | 1 | 지도 상세는 1층, 인허가는 지하 1층이다. 인접 건물 2층에도 동명 업소가 안내되어 있다. `REVIEW`로 두고 실제 영업장의 상세 주소를 확인한다. |

갱신한 입력은 **856곳 전량 보존**, 검수 대상 82곳(광주 35·전남 25·전북 22), 추가 확인 206곳, 비노출 568곳이다. 기존 15곳과 이번에 확인한 6곳을 합한 LINK 21곳, 신규 비공개 초안 CREATE 61곳의 대상과 검수 단계·버전을 고정했다. 9곳 중 남은 3곳은 보관본에 남기고 이번 등록에서 제외했다. 등록 뒤 보류 행을 재개할 경우, 별도 승인 범위에서 원장과 기존 연결을 보존하는 후속 절차를 확정한다.

- 856건 입력 SHA-256 `4a9682938497052f1319b22fb0977ed747d620ef5141ff64d30a977e6db0e0c0`
- 82건 연결 계획 SHA-256 `33bc8233f5028d7786b185f22abefe9d119565fee25eb96fdb63b69217ae54cb`

갱신 파일을 격리 workerd D1에서 실행해 856건 전량 보관, 기존 단계·버전 유지 21건, 신규 비공개 초안 61건, 재등록 중복 0건, 신규 공개 0건을 확인했다. 별도 확인 대상 3건과 타지역 440건에는 검수 연결이 없었다. 운영 검수 상태는 읽기 전용으로 조회했다.

## 보류 2곳 후속 확인

- 층이 충돌한 곳은 업소가 작성한 지도 출입 안내, 골프클럽의 복어요리전문점 채용 공고, 동일 상호의 인허가가 같은 도로명주소를 가리켜 동일 업소로 판단했다. 인접 건물의 2층 표기는 다른 시설의 방문 후기에 나온 정보다. 활성 인허가 검수에 연결한다. 사업자 안내의 1층과 인허가의 지하 1층은 각각 보존한다. 운영자는 실제 출입 층과 공개할 주소를 확인하기까지 이 항목을 공개 승인 대기로 유지한다. B09가 공개에 쓰는 연결 주소는 고정된다. 인허가 주소 정정이 필요하면 반입 전에 계획을 다시 고정하고, 이미 연결된 경우에는 별도 승인된 연결 정정 절차를 확보한 뒤 공개한다.
- 인허가 재검수 대상은 일치한 주소의 장소 페이지에서 11월 3일과 14일 결제 인증 방문을 확인했다. 과거 영업 불확실 판단을 재검토할 근거를 비공개 후속 계획에 기록했다. 기존 관리자 제외 이력으로 활성 검수 항목이 없어 원장의 `REVIEW`를 유지한다. 승인된 인허가 재검수 뒤 활성 항목 ID와 버전을 읽어 후속 연결을 고정한다.

현행 원장은 856곳을 전량 보존한다. 기존 검수 LINK 22곳과 신규 비공개 초안 CREATE 61곳을 합해 83곳(광주 36·전남 25·전북 22)을 등록한다. 추가 확인 205곳과 비노출 568곳을 유지하며, 이전 체인점 제외 1곳은 `HIDDEN`이다.

- 856건 입력 SHA-256 `1d89bd318b79aebf2ed532f26ecb9006f22f5a522549b2a0daf39cf1857b4419`
- 83건 연결 계획 SHA-256 `704588118b52d704f16353090c701d4d84273eaabbc01f4650b3288bac4fe740`

격리 workerd D1에서 원장 856건, LINK 22건의 단계·버전 유지, 신규 초안 61건, 재실행 중복 0건, 신규 공개 0건을 확인했다. 인허가 재검수 1건, 체인 제외 1건과 타지역 440건은 검수 연결이 없었다.

## CI 복구 후 실행

[병합된 #446](https://github.com/taejunyun1/Tasted_it/pull/446)의 운영 범위는 [#448](https://github.com/taejunyun1/Tasted_it/pull/448)의 B10 합동 전환을 전제로 한다. B10은 대상 대기 migration이 `0050`·`0051`·`0052` 세 파일일 때 실행한다. #475가 먼저 병합되면 `0061`·`0062`도 대기 목록에 들어가므로 B10 적용을 먼저 완료한다. 최신 읽기 전용 조회의 운영 기준은 `0049`다.

1. B10 선행 적용을 확인하고 최신 `main`을 반영한 이 PR의 최종 커밋에서 필수 CI 네 항목을 확인한 뒤 병합한다. 배포 담당자는 병합된 `main`에서 대상 Worker·D1 계정/ID, Time Travel 복구 지점, 현재 버전, 장소 기준 집계와 적용 migration 목록을 확인한다. B17 후보 DB는 별도 운영 범위로 유지한다.
2. 정확히 `0061_private_place_intake.sql`과 `0062_place_intake_review_links.sql`만 대기함을 확인한 뒤 표준 D1 migration을 적용한다. 새 테이블·가드와 외래키 검사를 확인하고, 병합된 Worker를 배포한 뒤 관리자 검수와 공개 목록의 사전 스모크를 확인한다. 이 시점에는 목록 입력이 없다.
3. 배포 담당자는 최신 계획의 SHA-256과 비공개 입력 SHA-256, LINK 22곳과 CREATE 61곳을 병합된 PR에서 확인한다. 기존 장소, 기존 인허가·검수 항목과 신규 대상의 중복을 읽기 전용으로 다시 대조한다. 근거, 상태 또는 대상이 바뀌면 실행을 멈추고 재검수한다.
4. 배포 담당자는 검증된 관리자 ID, 비공개 두 파일, 승인 계획 SHA-256과 LINK·CREATE 건수, 그리고 확인한 운영 D1 하나만 `binding: "DB"`, `remote: true`로 설정한 별도 Wrangler JSON을 로컬 환경 변수로 제공한다. 설정의 계정과 DB ID를 독립적으로 대조한 뒤 병합된 저장소 루트에서 아래 명령을 실행한다. [Wrangler D1 바인딩 실행 API](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)

   ```sh
   node --input-type=module <<'NODE'
   import { readFileSync } from "node:fs";
   import { getPlatformProxy } from "wrangler";
   import { enrollPrivatePlaceIntake } from "./scripts/place-intake-enrollment.mjs";

   const { RETASTE_INTAKE_CONFIG, RETASTE_ACCOUNT_ID, RETASTE_D1_ID, RETASTE_ADMIN_ID,
     RETASTE_INTAKE_FILE, RETASTE_INTAKE_PLAN, RETASTE_APPROVED_PLAN_SHA256, RETASTE_EXPECTED_LINK,
     RETASTE_EXPECTED_CREATE } = process.env;
   const reviewedPlan = "704588118b52d704f16353090c701d4d84273eaabbc01f4650b3288bac4fe740";
   if (RETASTE_APPROVED_PLAN_SHA256 !== reviewedPlan
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

## 보류 17곳 재검수

2026-11-22 · 담당 Jay/Codex. 이 실행서가 병합되고 필수 CI가 통과하면 지정 운영 ADMIN이 기존 #475 배치의 **138번과 163번**만 재개할 수 있다. 두 건의 운영 인허가는 `OPEN/PENDING`이며 고정 연결의 상호·주소·좌표와 일치한다. 운영 기준선에서 원장 856건, 검수 연결 83건, 공개 66곳, 보류 17곳, 타지역 440건 비노출을 확인했다.

- 138번은 `CATEGORY_CONFIRMATION`에서 제과로 검수한다. 운영 인허가에서 현재 주소는 정상이고 다른 주소의 동명 업소는 폐업으로 확인됐다. 현재 매장의 공지는 식음료 영업을 뒷받침한다. [업체 공지](https://www.instagram.com/p/Df-16iAEooY/)
- 163번은 기존 기타 분류를 해제하고 `FINAL_APPROVAL`에서 `CATEGORY_CONFIRMATION`으로 되돌려 양식을 검수한다. 운영 인허가와 업소가 제공한 메뉴·채용 자료의 주소 및 요리가 일치한다. 인허가 원문의 업종 항목은 보존한다. [업소 공고](https://www.jobkorea.co.kr/Recruit/GI_Read/49007249) · [현행 메뉴](https://www.diningcode.com/profile.php?rid=XQOKfcd1tBIT)
- 나머지 15곳은 비노출이다. 다점포·체인 7곳, 브랜드 관계 미확정 3곳, 상세주소 2곳, 상호·임시 휴무·포장 전용 각 1곳이다. 같은 건물에서 2호가 확인된 1곳은 현재 고정 주소에 호수가 빠져 있으므로 승인된 연결 정정 뒤 재검수한다.

승인하는 비공개 계획의 SHA-256은 아래 두 값으로 제한한다. 계획에는 해당 반입 번호와 검수·인허가 식별자, 확인한 보류 단계와 버전, 현재 분류 및 목표 분류, 지정 ADMIN과 감사 기록 식별자, 재개 사유를 고정한다. 원본 자료와 운영 식별자는 로컬에서 보존한다.

| 반입 위치 | 재개 계획 SHA-256 |
| --- | --- |
| 138 | `2491a25880f7e601eca4933cdf8866399d2bee818228847d7e5f8bbb8a418091` |
| 163 | `7fa5728c3d38817c0555eb896266299df16e8eb0dd1487a65406f65fd4c1ccd1` |

1. 병합 코드에서 이 두 계획의 해시를 검증한다. 운영 Worker가 #475 배포본인지 대조한다. 기존 #475 반입 설정에서 예상 계정과 D1 ID를 맞추고 `binding: "DB"`, `remote: true`인 바인딩 한 개만 사용한다. 지정 운영 ADMIN이 기존 계정으로 정상 로그인하고 비밀번호 재인증한다.
2. `getPlatformProxy({ configPath, remoteBindings: true, envFiles: [], persist: false })`의 운영 D1 프록시에서 `reopenHeldPlaceIntakeReview(proxy.env.DB, planText, { approvedPlanSha256 })`를 계획당 한 번 호출한다. 검수와 감사 기록만 변경한다. 보류 상태, 버전, 고정 원장·인허가 일치, 미연결·미제외·미점유, 최근 ADMIN 인증 중 하나라도 달라지면 재개를 중단한다. 중간 오류 시 감사와 검수 행을 다시 읽고 재시도 여부를 정한다. [Wrangler 실행 API](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy) · [D1 배치 트랜잭션](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
3. 운영 B09에서 최신 버전의 두 검수 항목만 활성 최하위 분류로 확정한다. 중복 검사를 통과한 곳은 각각 미리보기의 동일 업소·공개 조건을 확인하고 재인증 세션에서 확정한다. 준비 작업과 B09 확정은 별도 영수증으로 확인한다.
4. 재개 후 분류나 중복 검증이 실패하면 기존 관리자 보류 동작으로 해당 검수를 다시 보류한다. 확정 뒤 실제 노출이 조건과 다르면 해당 장소만 B09 회수로 처리하고 다시 확인한다. 영수증 또는 응답 누락 시 실제 상태를 먼저 읽고 같은 작업을 다시 제출할지 판단한다.
5. 최종 대상의 B09 공개 영수증·공개 감사·분류와 비로그인 목록·지도·상세를 확인한다. 이번 쓰기 외의 공개 집합, 15곳 보류, 원장 856건, 타지역 440건과 링크 제한은 읽기 전용으로 대조한다. 실행 결과는 [#475 운영 기록](https://github.com/taejunyun1/Tasted_it/pull/475)과 SSOT·위키에 반영한다.

이 실행은 기존 D1과 ADMIN 앱을 사용한다. 작업 한도는 재개 2건·감사 2건·B09 공개 2곳이다. 별도 비용 서비스·개인정보 반출·Worker 배포·migration은 범위에 포함되지 않는다. B17과 #397은 HOLD다.
