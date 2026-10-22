# Re:Taste `main` 변경 이력 SSOT

- **문서 역할:** `main` 변경 이력의 탐색·요약·영향 인덱스 SSOT
- **상태:** ACCEPTED — [PR #157](https://github.com/taejunyun1/Tasted_it/pull/157) 병합 시 적용
- **마지막 확인:** 2026-08-17 01:37 KST
- **확인한 원격 기준:** [`562d5f4`](https://github.com/taejunyun1/Tasted_it/commit/562d5f42ec2cd765f0df6617b887aeee9f9664b2)
- **이번 기준선 범위:** [`b44b8f5`](https://github.com/taejunyun1/Tasted_it/commit/b44b8f5b621771717dc4b4fa71d5feb46934df41) 제외부터 `562d5f4` 포함까지
- **원본 저장소:** [`taejunyun1/Tasted_it`](https://github.com/taejunyun1/Tasted_it)

이 문서는 원격 `main`에 무엇이, 왜, 어떤 영향과 함께 들어왔는지 찾는 공식 인덱스다. 현재 파일 상태의 원본은 `origin/main`, 승인·운영 범위의 원본은 병합 Pull Request, 여러 변경을 연결해 읽는 기준은 이 문서다. 상세 권한 경계는 [`main 변경 이력 인덱스 SSOT 지정`](./decisions/2026-08-16-main-change-history-ssot.md)을 따른다.

> **정확성 규칙:** 위 기준 커밋과 현재 `origin/main`이 다르면 이 문서를 최신으로 간주하지 않는다. 먼저 누락된 커밋과 병합 PR을 대조하고 이력을 갱신한다. 이 문서만으로 배포, 원격 D1 migration, 운영 데이터 변경 또는 외부 API 호출의 실제 완료를 주장하지 않는다.

## 기준선 이후 등록된 변경

| 상태 | 변경과 영향 | 근거 |
| --- | --- | --- |
| Ready | 2026-10-22 개발용 workerd를 기존 전이 의존성 `1.20261022.1`에 고정하고 실제 바이너리 최대 지원일과 요청일 `2026-08-05`를 검증한다. unit 1137·Workers integration 430 통과. 운영 배포·학생·실모델 변경은 없으며 R3 컨테이너 검증은 후속이다. 복원은 override·관련 lock revert 후 exact-date 검증 BLOCKED 유지다. | [Issue #324](https://github.com/taejunyun1/Tasted_it/issues/324) · [PR #325](https://github.com/taejunyun1/Tasted_it/pull/325) · [개발 runtime 결정](./decisions/2026-10-22-rsi-native-runtime.md) |
| Ready | 2026-10-22 RSI R2/T3 개발 전용 고정 native 평가기를 추가했다. workerd receiver RED/bind GREEN, 여섯 경로·auth 외부 oracle, 합성 NO_CHANGE·조작 거절·split 누수·내용 hash를 검증한다. 임의 코드 실행·실모델·운영 변경·배포와 개선 효과 주장은 제외하며 복원은 R2 revert다. | [Issue #321](https://github.com/taejunyun1/Tasted_it/issues/321) · [PR #322](https://github.com/taejunyun1/Tasted_it/pull/322) · [설계 PR #305](https://github.com/taejunyun1/Tasted_it/pull/305) · [평가 프로토콜](./testing/rsi-evaluation-protocol.md) |
| Ready | 2026-10-22 RSI R1 사건·계보 계약과 로컬 합성 원장·승인 기억 조회를 구현했다. 반복 관측/실행 중복, 상태 전이, digest, 동시 갱신·재시작·예약 예산을 검증한다. 실모델·운영 연결·자기개선 효과는 후속 R2–R6 범위이며 기존 Worker·cron·초대·배정·권한·운영 데이터는 변경하지 않는다. 복원은 R1 코드 revert다. | [Issue #319](https://github.com/taejunyun1/Tasted_it/issues/319) · [PR #320](https://github.com/taejunyun1/Tasted_it/pull/320) · [설계 PR #305](https://github.com/taejunyun1/Tasted_it/pull/305) · [R1 런북](./operations/rsi-research.md) |
| Accepted / 후속 단계별 GO | 2026-10-15 기존 RSI 명칭의 운영 헬스체크와 에이전트 절차 수준의 자기개선을 구분한다. 원인 분석·격리 수정·고정 평가·결과 축적·자기 알고리즘 변경·두 세대 대조 시험의 구현 계획을 채택한다. 2026-10-22 R1은 #320으로 병합됐고 R2–R6은 후속 단계별 PR에서 진행한다. 문서만 변경하며 운영 실행·AI 사용 확대·workflow·권한·cron·binding·migration 변경은 없다. 단계별 구현과 실모델/운영 GO는 후속 PR에서 심사한다. Rollback은 문서 revert. | [Issue #304](https://github.com/taejunyun1/Tasted_it/issues/304) · [PR #305](https://github.com/taejunyun1/Tasted_it/pull/305) · [결정](./decisions/2026-10-15-rsi-agent-improvement.md) · [구현 계획](./superpowers/plans/2026-10-15-rsi-agent-improvement.md) |
| Ready | 2026-10-15 운영 A~D 초대를 보존하며 격리된 Workers/D1에서 네 계정의 가입·인증·로그인·수락과 점포/리뷰/QA 교차 확인을 연결했다. RSI 네트워크 오류의 결과 유실·실패 은폐·기록 누락을 수정하고 기존 운영 감사에 정기 결과 1개만 남기는 한정 예외를 명시했다. unit 941·integration 398·typecheck·build 통과. 새 경로·cron·binding·migration·토큰·공급자는 없다. 병합 main을 지정 계정에 배포하고 실제 정기 실행은 별도 확인한다. Rollback은 사전 Worker `fa76558c-0e37-4ff2-89ba-9eb545459d5c`. | [Issue #297](https://github.com/taejunyun1/Tasted_it/issues/297) · [결정](./decisions/2026-10-15-rsi-result-evidence.md) · [검증](./testing/2026-10-15-student-onboarding-rsi.tdd.md) |
| Ready | 2026-10-15 별도 운영 ADMIN 1개와 미사용 A~D 초대 4개를 인수하고 학생 스위치를 true로 유지한다. 라이브에서 확인한 학생 인증 리디렉션의 캐시 헤더 누락을 Worker 최종 응답에서 보호한다. 회귀 24개·unit 937·integration 393·typecheck·build 통과. 원문 자격증명·초대는 비공개 로컬 전달 파일에만 보관한다. 새 배포 RSI와 실제 학생 수락/작업 전체 흐름은 PENDING이다. Rollback은 학생 false·직전 Worker와 신규 관리자만 비활성화하는 방식이다. 최종 배포 증거는 운영 이슈와 위키에 기록한다. | [Issue #297](https://github.com/taejunyun1/Tasted_it/issues/297) · [학생 운영 런북](./operations/student-workspace.md) |
| Merged | 2026-10-15 학생 A~D 개별 초대·업무 배정·분류·교차 확인·등록 인가 기록·QA를 추가했다. `0037`·`0038`은 additive 학생 테이블이며 원문 점포 공개/리뷰 수정을 수행하지 않는다. main `0cf49ef` CI 네 잡 성공. 지정 계정 migration·최초 false 배포 후 #297에서 학생 활성화·별도 운영 관리자와 초대 인수를 진행한다. 업로드 AI 검사는 별도 PROPOSED다. | [Issue #295](https://github.com/taejunyun1/Tasted_it/issues/295) · [PR #296](https://github.com/taejunyun1/Tasted_it/pull/296) · [`0cf49ef`](https://github.com/taejunyun1/Tasted_it/commit/0cf49ef1b3aaf95f9d378f98987d87e0d679bc15) |
| Proposed | 2026-10-07 베타 준비 문서의 오래된 Draft/CI 대기 표시를 병합·최종 CI 사실로 정정하고, 20:13 KST 공개 HTTP와 배포 재시도 차단·재개 조건을 기록한다. PR #291·#293의 SHA/CI 및 Issue #290의 재점검 기록 대조, 문서 diff·링크 검증. 문서만 변경하며 코드·SQL·migration·환경 변수·외부 서비스·인증 설정 변경과 운영 실행 없음. 배포·원격 D1·라이브 RSI는 UNVERIFIED, 추가 OAuth 권한 연결 PENDING·출시 GO/RSI stage 1–4 HOLD 유지. 이 PR 병합은 추가 권한 연결이나 새 운영 작업을 승인하지 않는다. Rollback은 문서 revert. | [Issue #290](https://github.com/taejunyun1/Tasted_it/issues/290) · [PR #294](https://github.com/taejunyun1/Tasted_it/pull/294) · [`beta-readiness.md`](./operations/beta-readiness.md) |
| Merged | 2026-10-07 최종 공개에서 선택한 분류가 이후 비활성화되거나 활성 하위 분류가 생긴 경우를 막는다. 후보·기존 장소의 공통 공개 함수가 현재 활성 말단 분류를 재확인해 부적격이면 claim·쓰기 전에 `CATEGORY_REQUIRED`로 건너뛴다. 신규 8개·범위 34개·전체 단위 906개·전체 통합 365개와 로컬 typecheck·build, 독립 리뷰 승인. 최종 PR CI `37603222048`와 병합 main CI `37603717573`의 4개 잡 모두 성공. Migration·환경 변수·외부 서비스 변경 없음. 지정 계정 접근 및 추가 권한 승인 대기로 배포·원격 D1·라이브 RSI는 UNVERIFIED. Rollback은 이전에 검증한 Worker 버전 복귀와 이 PR의 코드 되돌리기. | [Issue #292](https://github.com/taejunyun1/Tasted_it/issues/292) · [PR #293](https://github.com/taejunyun1/Tasted_it/pull/293) · [`b1c0793`](https://github.com/taejunyun1/Tasted_it/commit/b1c07932c4c95546cd9d2df34e891584376f49e6) · [`beta-readiness.md`](./operations/beta-readiness.md) |
| Merged | 2026-10-07 베타 운영 준비 런북. SQL 32개 읽기 전용 지표와 근거별 검수 절차를 연결하고, 게스트 통합 테스트 2개 파일의 실행 날짜 의존성을 고정한다. 수정 범위 76개·전체 단위 906개·전체 통합 357개 통과. 최종 PR CI `37592478548`와 병합 main CI `37592951407`의 4개 잡 모두 성공. 지정 운영 계정 접근 차단으로 원격 집계·공개는 UNVERIFIED, 공개 HTTP는 정상 응답 확인. 제품 동작·migration·환경 변수·외부 서비스·배포 변경 없음. Rollback은 문서·SQL·테스트 수정 revert. | [Issue #290](https://github.com/taejunyun1/Tasted_it/issues/290) · [PR #291](https://github.com/taejunyun1/Tasted_it/pull/291) · [`8057bcf`](https://github.com/taejunyun1/Tasted_it/commit/8057bcf4e2ae25dc1d765ef7e511fbc753f82a3a) · [`beta-readiness.md`](./operations/beta-readiness.md) |
| Proposed | 2026-09-08 `0562910` 운영 배포 기록. Worker `739a0b2d-…`. RSI cron 6시간. rollback `0c4e5c32-…`. 재배포·원격 apply 없음. | [Issue #288](https://github.com/taejunyun1/Tasted_it/issues/288) · [PR #289](https://github.com/taejunyun1/Tasted_it/pull/289) |
| Merged | 2026-09-08 RSI 주기를 6시간 cron으로 분리하고 범위 확장 단계를 플랜으로 남긴다. 이번 PR에서 경로 추가 없음. 병합 후 배포. | [Issue #286](https://github.com/taejunyun1/Tasted_it/issues/286) · [PR #287](https://github.com/taejunyun1/Tasted_it/pull/287) · [`0562910`](https://github.com/taejunyun1/Tasted_it/commit/0562910) |
| Merged | 2026-09-08 `b46858c` 운영 배포 기록. Worker `0c4e5c32-…`. rollback `3132ad56-…`. 재배포·원격 apply 없음. | [Issue #284](https://github.com/taejunyun1/Tasted_it/issues/284) · [PR #285](https://github.com/taejunyun1/Tasted_it/pull/285) · [`e37bc7d`](https://github.com/taejunyun1/Tasted_it/commit/e37bc7d) |
| Merged | 2026-09-08 RSI 자검을 기존 cron의 격리 `waitUntil`과 Worker 온디맨드로 옮긴다. 로컬 Node는 루프가 아니다. 새 cron·원격 D1·Workers AI 없음. 병합 후 배포. | [Issue #282](https://github.com/taejunyun1/Tasted_it/issues/282) · [PR #283](https://github.com/taejunyun1/Tasted_it/pull/283) · [`b46858c`](https://github.com/taejunyun1/Tasted_it/commit/b46858c) |
| Merged | 2026-09-08 에이전트 자검 루프를 라이브 Cloudflare Worker HTTP와 Observability 읽기로 고정한다. 배포·원격 D1·Workers AI 없음. | [Issue #280](https://github.com/taejunyun1/Tasted_it/issues/280) · [PR #281](https://github.com/taejunyun1/Tasted_it/pull/281) · [`67c3e5e`](https://github.com/taejunyun1/Tasted_it/commit/67c3e5e) |
| Proposed | 2026-09-04 `pnpm dev`가 시작 전에 로컬 D1 migration과 week1 샘플 시드를 자동 적용한다. fresh local checkout에서도 샘플 공개 경로 404를 줄인다. 운영 배포·원격 D1·관리자 QA fixture 없음. | [Issue #272](https://github.com/taejunyun1/Tasted_it/issues/272) · [PR #273](https://github.com/taejunyun1/Tasted_it/pull/273) |
| Proposed | 2026-08-26 로그인 실패 공개 문구를 하나로 통일한다. 미인증 계정을 화면에 가르지 않음. 배포 없음. | [Issue #269](https://github.com/taejunyun1/Tasted_it/issues/269) · [PR #271](https://github.com/taejunyun1/Tasted_it/pull/271) |
| Proposed | 2026-08-26 장소 상세·빠른정보 시트 Tab 포커스를 안에 가둔다. 새 의존성·배포 없음. | [Issue #268](https://github.com/taejunyun1/Tasted_it/issues/268) · [PR #270](https://github.com/taejunyun1/Tasted_it/pull/270) |
| Proposed | 2026-08-26 검수 자신 있음 플랜에 S1–S4 코드 PR을 적는다. 자동 공개는 계속 문서 밖. 제품 코드·배포 없음. | [Issue #265](https://github.com/taejunyun1/Tasted_it/issues/265) · [PR #267](https://github.com/taejunyun1/Tasted_it/pull/267) |
| Merged | 2026-08-26 검수 화면에 `자동으로 5단계 대기 N건 / 공개 0`. 공개 버튼과 분리. 자동 공개·NAVER·배포 없음. | [Issue #264](https://github.com/taejunyun1/Tasted_it/issues/264) · [PR #266](https://github.com/taejunyun1/Tasted_it/pull/266) · [`91cab8f`](https://github.com/taejunyun1/Tasted_it/commit/91cab8f) |
| Ready | 2026-08-24 `7bc907b` 운영 배포 기록. Worker `f10e59ff-…`. 스위치 true. 재배포·원격 apply 없음. | [Issue #262](https://github.com/taejunyun1/Tasted_it/issues/262) · [PR #263](https://github.com/taejunyun1/Tasted_it/pull/263) |
| Merged | 2026-08-24 검수 조건부 이동 스위치를 `"true"`로 두고 운영 Worker에 배포한다. 자동 공개·일괄 NAVER·원격 apply 없음. | [Issue #260](https://github.com/taejunyun1/Tasted_it/issues/260) · [PR #261](https://github.com/taejunyun1/Tasted_it/pull/261) · [`7bc907b`](https://github.com/taejunyun1/Tasted_it/commit/7bc907b) |
| Merged | 2026-08-24 검수 자신 있음 건너뜀 코드를 제외·노매치·광역 이유로 매핑한다. | [Issue #258](https://github.com/taejunyun1/Tasted_it/issues/258) · [PR #259](https://github.com/taejunyun1/Tasted_it/pull/259) · [`b4d03cf`](https://github.com/taejunyun1/Tasted_it/commit/b4d03cf) |
| Merged | 2026-08-24 검수 버튼 **근거 있는 항목만 다음 단계**. 스위치 기본 false면 이동 0. on이어도 공개 0·NAVER 0. | [Issue #256](https://github.com/taejunyun1/Tasted_it/issues/256) · [PR #257](https://github.com/taejunyun1/Tasted_it/pull/257) · [`815c120`](https://github.com/taejunyun1/Tasted_it/commit/815c120) |
| Merged | 2026-08-24 검수 한 건 성공 뒤 같은 항목만 5단계 대기 체인. `REVIEW_CONFIDENT_ADVANCE_ENABLED` 기본 false. 공개·NAVER 호출 없음. | [Issue #254](https://github.com/taejunyun1/Tasted_it/issues/254) · [PR #255](https://github.com/taejunyun1/Tasted_it/pull/255) · [`80c7e61`](https://github.com/taejunyun1/Tasted_it/commit/80c7e61) |
| Merged | 2026-08-24 검수 1→4 자신 있음 게이트 `confidentAdvanceAllowed`. 광역·노매치·열린 중복·5단계는 false. 공개·NAVER·체인 없음. | [Issue #252](https://github.com/taejunyun1/Tasted_it/issues/252) · [PR #253](https://github.com/taejunyun1/Tasted_it/pull/253) · [`57f3ec2`](https://github.com/taejunyun1/Tasted_it/commit/57f3ec2) |
| Merged | 2026-08-24 사진 삭제 페이징 테스트가 101건 sequential publish로 CI 5초를 넘기지 않게 D1/R2 배치 시드를 쓴다. 제품 코드·배포 없음. | [Issue #250](https://github.com/taejunyun1/Tasted_it/issues/250) · [PR #251](https://github.com/taejunyun1/Tasted_it/pull/251) · [`6c31bb6`](https://github.com/taejunyun1/Tasted_it/commit/6c31bb6) |
| Merged | 2026-08-23 `origin/main` `43503f7`를 운영 Worker에 배포. Version `7445cc93-747f-46e0-ae0c-ef21fadc7a4f`. 원격 migration apply·일괄 NAVER·일괄 공개 없음. rollback은 `7579b600-7302-443b-9753-a4a5aaa3dd05`. 홈 지도 pstatic 스타일 200. nelo는 계속 차단. | [Issue #248](https://github.com/taejunyun1/Tasted_it/issues/248) · [PR #249](https://github.com/taejunyun1/Tasted_it/pull/249) · [`667d764`](https://github.com/taejunyun1/Tasted_it/commit/667d764) |
| Merged | 2026-08-23 라이브 지도 CSP에 `https://*.pstatic.net` allowlist. nelo 수집 도메인은 넣지 않음. 병합 후 배포. | [Issue #246](https://github.com/taejunyun1/Tasted_it/issues/246) · [PR #247](https://github.com/taejunyun1/Tasted_it/pull/247) · [`43503f7`](https://github.com/taejunyun1/Tasted_it/commit/43503f7) |
| Proposed | 2026-08-23 검수 1→4 조건부 자동 이동. 공개는 사람. NAVER 일괄·cron 추가·자동 PUBLISHED 없음. 이 항목 병합은 구현 아님. | [Issue #244](https://github.com/taejunyun1/Tasted_it/issues/244) · [PR #245](https://github.com/taejunyun1/Tasted_it/pull/245) · [`296579a`](https://github.com/taejunyun1/Tasted_it/commit/296579a) · [`docs/superpowers/plans/2026-08-23-confident-review-advance.md`](./superpowers/plans/2026-08-23-confident-review-advance.md) |
| Merged | 2026-08-23 POI 등록 절차를 유저 제안과 관리자 검수 5단계로 문서화한다. 공개 허용은 5단계만. 제품 코드·배포 없음. | [Issue #242](https://github.com/taejunyun1/Tasted_it/issues/242) · [PR #243](https://github.com/taejunyun1/Tasted_it/pull/243) · [`9272920`](https://github.com/taejunyun1/Tasted_it/commit/9272920) · [`docs/operations/poi-registration.md`](./operations/poi-registration.md) |
| Merged | 2026-08-23 Clock B localhost 게스트 재현. 공개 맵·`/places`·상세는 가입 없이 열림. 온보딩은 URL 직접 진입만, 맵 앞 강제 없음. 투표 CTA는 내 취향. 랩 숫자 GO 아님. 제품 코드·배포 없음. | [Issue #240](https://github.com/taejunyun1/Tasted_it/issues/240) · [PR #241](https://github.com/taejunyun1/Tasted_it/pull/241) · [`5ed1eba`](https://github.com/taejunyun1/Tasted_it/commit/5ed1eba) |
| Merged | 2026-08-22 Clock G 런북 정합. NAVER는 지역 10k+`/admin/place-operations`, 배포는 `pnpm run deploy`, week1 운영 `--remote` 시드 삭제. 제품 코드·재배포·라이브 NAVER 없음. | [Issue #238](https://github.com/taejunyun1/Tasted_it/issues/238) · [PR #239](https://github.com/taejunyun1/Tasted_it/pull/239) · [`ca9caa6`](https://github.com/taejunyun1/Tasted_it/commit/ca9caa6) |
| Merged | 2026-08-22 `origin/main` `fdf45d8`를 운영 Worker에 배포. Version `7579b600-7302-443b-9753-a4a5aaa3dd05`. 원격 migration apply·일괄 NAVER·일괄 공개 없음. rollback은 `b2268318-3473-4661-8598-e0560a7d1396`. | [Issue #236](https://github.com/taejunyun1/Tasted_it/issues/236) · [PR #237](https://github.com/taejunyun1/Tasted_it/pull/237) · [`2d355c6`](https://github.com/taejunyun1/Tasted_it/commit/2d355c6) |
| Merged | 2026-08-22 지도 탐색 리스트 점수는 live Bayesian이 아니라 공개 스냅샷 문구(`formatPublicRatingSummary`)를 쓴다. 배포는 `#236`. | [Issue #234](https://github.com/taejunyun1/Tasted_it/issues/234) · [PR #235](https://github.com/taejunyun1/Tasted_it/pull/235) · [`fdf45d8`](https://github.com/taejunyun1/Tasted_it/commit/fdf45d8) |
| Merged | 2026-08-22 CI에 `pnpm run build`와 Playwright smoke(`release.spec.ts` + 홈/장소 1건, chromium, `wrangler.e2e.jsonc`)를 넣는다. 전체 매트릭스·k6·coverage 없음. 배포는 `#236`. | [Issue #232](https://github.com/taejunyun1/Tasted_it/issues/232) · [PR #233](https://github.com/taejunyun1/Tasted_it/pull/233) · [`804df46`](https://github.com/taejunyun1/Tasted_it/commit/804df46) |
| Merged | 2026-08-22 공개 리스트/지도 점수는 최신 non-stale snapshot. 같은 값 재투표는 CHANGE 없음. 재import는 이전 primary를 해제. 홈 버전 `home-curation-v2` 유지. 배포는 `#236`. | [Issue #230](https://github.com/taejunyun1/Tasted_it/issues/230) · [PR #231](https://github.com/taejunyun1/Tasted_it/pull/231) · [`1bde726`](https://github.com/taejunyun1/Tasted_it/commit/1bde726) |
| Merged | 2026-08-22 회원 vote/save·unsave·logout·제안·정정·온보딩·리뷰어 신청/발행 POST가 교차 출처를 거절한다. CSP와 같은 PR이 아니다. 배포는 `#236`. | [Issue #228](https://github.com/taejunyun1/Tasted_it/issues/228) · [PR #229](https://github.com/taejunyun1/Tasted_it/pull/229) · [`e86a120`](https://github.com/taejunyun1/Tasted_it/commit/e86a120) |
| Merged | 2026-08-22 CSP·HSTS와 Permissions-Policy `geolocation=()`를 넣는다. Playwright CI와 같은 PR이 아니다. 배포는 `#236`. | [PR #227](https://github.com/taejunyun1/Tasted_it/pull/227) · [`c551995`](https://github.com/taejunyun1/Tasted_it/commit/c551995) |
| Merged | 2026-08-22 지도 대비를 올리고 홈 `h1`을 하나 남기며 시트는 `prefers-reduced-motion`을 존중한다. 배포는 `#236`. | [PR #226](https://github.com/taejunyun1/Tasted_it/pull/226) · [`d968125`](https://github.com/taejunyun1/Tasted_it/commit/d968125) |
| Merged | 2026-08-22 헤더 `returnTo`와 가입 실패 시 입력을 유지한다. 배포는 `#236`. | [PR #225](https://github.com/taejunyun1/Tasted_it/pull/225) · [`832e18f`](https://github.com/taejunyun1/Tasted_it/commit/832e18f) |
| Merged | 2026-08-22 가상 `slugPrefix` 팩이 공개 slug 리다이렉트 루프를 만들지 않게 한다. 배포 없음. | [PR #224](https://github.com/taejunyun1/Tasted_it/pull/224) · [`b04bc46`](https://github.com/taejunyun1/Tasted_it/commit/b04bc46) |
| Merged | 2026-08-22 관리자 이메일을 가리고 미확인 NAVER를 attention에 넣는다. 배포는 `#236`. | [PR #223](https://github.com/taejunyun1/Tasted_it/pull/223) · [`ab52ac0`](https://github.com/taejunyun1/Tasted_it/commit/ab52ac0) |
| Merged | 2026-08-22 `/admin`을 검수 화면으로 보낸다. 새 대시보드 아님. 배포는 `#236`. | [Issue #221](https://github.com/taejunyun1/Tasted_it/issues/221) · [PR #222](https://github.com/taejunyun1/Tasted_it/pull/222) · [`0c26dea`](https://github.com/taejunyun1/Tasted_it/commit/0c26dea) |
| Merged | 2026-08-22 `origin/main` `7389537` 기준 잔여 작업을 시간 단위로 고정한다. 배포 실행·일괄 공개·두 번째 도시·결제·`k6`는 이 항목에 없다. | [Issue #219](https://github.com/taejunyun1/Tasted_it/issues/219) · [PR #220](https://github.com/taejunyun1/Tasted_it/pull/220) · [`36d0d9e`](https://github.com/taejunyun1/Tasted_it/commit/36d0d9e) · [`docs/superpowers/plans/2026-08-22-remaining-work-hour-plan.md`](./superpowers/plans/2026-08-22-remaining-work-hour-plan.md) |
| Merged | 2026-08-22 NAVER 카테고리 경로는 마지막 업종만 해석한다. 광역 업종은 세부 카테고리로 자동 지정하지 않고 검수 카드에 근거 상태를 표시한다. 원문 미보관. 배포·기존 카테고리 일괄 변경 없음. | [PR #218](https://github.com/taejunyun1/Tasted_it/pull/218) · [`7389537`](https://github.com/taejunyun1/Tasted_it/commit/7389537) · [`docs/superpowers/plans/2026-08-22-naver-category-evidence-v2.md`](./superpowers/plans/2026-08-22-naver-category-evidence-v2.md) |
| Merged | 2026-08-20 NAVER 노매치는 자동으로 03으로 가지 않고 확인필요로 남긴다. 수동 근거 강제 이동·주소 수정·카드 선택·순차 50곳. Worker 요청당 NAVER 1회. | [Issue #214](https://github.com/taejunyun1/Tasted_it/issues/214) · [PR #215](https://github.com/taejunyun1/Tasted_it/pull/215) · [`f42e53a`](https://github.com/taejunyun1/Tasted_it/commit/f42e53a) |
| Merged | 2026-08-20 `f42e53a`를 운영 Worker에 배포하고 검수 2단계 NAVER 표본 2회를 기록한다. 원격 migration apply·일괄 공개 없음. rollback은 `49064c1f-bd3f-4eec-a9e5-5985d384a0c1`. | [Issue #216](https://github.com/taejunyun1/Tasted_it/issues/216) · [PR #217](https://github.com/taejunyun1/Tasted_it/pull/217) · [`6a1c5ea`](https://github.com/taejunyun1/Tasted_it/commit/6a1c5ea) |
| Proposed | 2026-08-19 페르소나 랩 n200 게스트 첫인상 가설. Lightning을 분포로 쓰고 Luna 붕괴는 버린다. 공개 베타 GO·CI·제품 이슈 승격 아님. 키·라이브·새 스택 없음. | [Issue #212](https://github.com/taejunyun1/Tasted_it/issues/212) · [PR #213](https://github.com/taejunyun1/Tasted_it/pull/213) · [`docs/superpowers/plans/2026-08-19-persona-lab-n200.md`](./superpowers/plans/2026-08-19-persona-lab-n200.md) |
| Proposed | 2026-08-19 페르소나 랩 결과와 향후 진입점. 랩은 저장소 밖. 기본 모델 Muse Glimmer. `#209` 하네스 `GO`와 랩 preview를 분리. 키·라이브·새 스택 없음. | [Issue #210](https://github.com/taejunyun1/Tasted_it/issues/210) · [PR #211](https://github.com/taejunyun1/Tasted_it/pull/211) · [`docs/superpowers/plans/2026-08-19-persona-lab-entry.md`](./superpowers/plans/2026-08-19-persona-lab-entry.md) |
| Merged | 2026-08-18 300명 합성 테스트 시나리오 카탈로그. 테스터 200 + 뷰어 100의 풀 여정. 하네스 재작성·라이브 실행·일괄 공개·`k6` 없음. 문서 `PROPOSED`. | [Issue #208](https://github.com/taejunyun1/Tasted_it/issues/208) · [PR #209](https://github.com/taejunyun1/Tasted_it/pull/209) · [`1ab3c50`](https://github.com/taejunyun1/Tasted_it/commit/1ab3c50) · [`docs/superpowers/plans/2026-08-18-synthetic-beta-300-scenarios.md`](./superpowers/plans/2026-08-18-synthetic-beta-300-scenarios.md) |
| Proposed | 2026-08-18 격리 합성 베타 200 테스터 + 100 뷰어 하드테스트 플랜. 라이브 Worker·원격 D1·NAVER·Resend·`k6`·새 binding 없음. 문서 `PROPOSED`. | [Issue #206](https://github.com/taejunyun1/Tasted_it/issues/206) · [PR #207](https://github.com/taejunyun1/Tasted_it/pull/207) · [`docs/superpowers/plans/2026-08-18-synthetic-beta-200.md`](./superpowers/plans/2026-08-18-synthetic-beta-200.md) |
| Merged | 2026-08-18 `origin/main` `57b7f1c`/`e8df8fa`를 운영 계정에 배포. 원격 `0035` apply 후 Worker `49064c1f-bd3f-4eec-a9e5-5985d384a0c1`. 라이브 NAVER·일괄 공개 없음. rollback은 `5f031bd2-c34e-4191-8d1f-656fdc4d46a0`. | [Issue #203](https://github.com/taejunyun1/Tasted_it/issues/203) · [PR #204](https://github.com/taejunyun1/Tasted_it/pull/204) · [PR #205](https://github.com/taejunyun1/Tasted_it/pull/205) · [`e8df8fa`](https://github.com/taejunyun1/Tasted_it/commit/e8df8fa) |
| Merged | 2026-08-18 NAVER 일일 예산을 지역 팩 필드로 나누고 카운터를 지역으로 분리한다. env 한도 상향·원격 migration·배포·실호출은 `#202`에 없음. | [Issue #201](https://github.com/taejunyun1/Tasted_it/issues/201) · [PR #202](https://github.com/taejunyun1/Tasted_it/pull/202) · [`57b7f1c`](https://github.com/taejunyun1/Tasted_it/commit/57b7f1c) |
| Merged | 2026-08-18 소유자 Private 전환 실측을 판정문서에 기록. `private: true`, Jay write 접속, rulesets 403, `has_wiki: false`. 가시성 되돌리기·유료 제품·배포 없음. | [Issue #182](https://github.com/taejunyun1/Tasted_it/issues/182) · [Issue #199](https://github.com/taejunyun1/Tasted_it/issues/199) · [PR #200](https://github.com/taejunyun1/Tasted_it/pull/200) · [`f79d57b`](https://github.com/taejunyun1/Tasted_it/commit/f79d57b) |
| Merged | 2026-08-18 재오딧. 당시 `81a73e8` 대비 `dcafa14` 코드 P0 6건 해제, 라이브는 `#186`. 이후 `#204`에서 `57b7f1c` 배포. | [Issue #197](https://github.com/taejunyun1/Tasted_it/issues/197) · [PR #198](https://github.com/taejunyun1/Tasted_it/pull/198) · [`6797a26`](https://github.com/taejunyun1/Tasted_it/commit/6797a26) |
| Merged | 2026-08-18 검수 처리량. 운영 현황에 7일 공개/일과 ACTIVE 큐를 고정하고 2주 표본을 PR에 남긴다. 배포·일괄 공개·원격 D1 쓰기 없음. | [Issue #195](https://github.com/taejunyun1/Tasted_it/issues/195) · [PR #196](https://github.com/taejunyun1/Tasted_it/pull/196) · [`dcafa14`](https://github.com/taejunyun1/Tasted_it/commit/dcafa14) |
| Merged | 2026-08-18 오딧 블락커 해제. `/places` 온보딩 강제 제거, 14세 가입 확인, 300곳 게이트를 카탈로그 운영으로 분리. 배포·일괄 공개 없음. | [Issue #193](https://github.com/taejunyun1/Tasted_it/issues/193) · [PR #194](https://github.com/taejunyun1/Tasted_it/pull/194) · [`0cab447`](https://github.com/taejunyun1/Tasted_it/commit/0cab447) |
| Merged | 2026-08-18 오딧 2차. `/me` 탈퇴 익명화와 CI integration 잡. 배포·원격 D1·Playwright CI·ADMIN 탈퇴 없음. | [Issue #191](https://github.com/taejunyun1/Tasted_it/issues/191) · [PR #192](https://github.com/taejunyun1/Tasted_it/pull/192) · [`d40dd61`](https://github.com/taejunyun1/Tasted_it/commit/d40dd61) |
| Merged | 2026-08-18 오딧 1차 하드닝. 로그인 한도, E2E D1 id 분리, 토큰 해시 링크, 방침 정합, 보안 헤더. 배포·원격 D1·장소 일괄 공개 없음. | [Issue #189](https://github.com/taejunyun1/Tasted_it/issues/189) · [PR #190](https://github.com/taejunyun1/Tasted_it/pull/190) · [`6fa3eff`](https://github.com/taejunyun1/Tasted_it/commit/6fa3eff) |
| Merged | 2026-08-18 8각도 풀 오딧. `81a73e8`·라이브 집계로 08-07 55건을 재검증한다. 공개 베타 NO-GO 유지. 제품 코드·배포·원격 D1 쓰기 없음. | [Issue #187](https://github.com/taejunyun1/Tasted_it/issues/187) · [PR #188](https://github.com/taejunyun1/Tasted_it/pull/188) · [`fbf5ff3`](https://github.com/taejunyun1/Tasted_it/commit/fbf5ff3) · [`docs/audits/2026-08-18-eight-angle-full-audit.md`](./audits/2026-08-18-eight-angle-full-audit.md) |
| Proposed | 검수 2단계에서 이미 VERIFIED인 항목을 NAVER 재호출 없이 카테고리 확정으로 옮기고, 1단계는 좌표 있는 항목을 먼저 보이게 한다. 배포·원격 D1·NAVER 실호출은 이 PR에 없다. | [Issue #185](https://github.com/taejunyun1/Tasted_it/issues/185) · [PR #186](https://github.com/taejunyun1/Tasted_it/pull/186) |
| Proposed | 광주전남 게이트를 닫는 고도화 슬라이스 순서를 `GO`로 고정하고, 저장소 Private 전환을 "요청하되 Private만으로는 부족하다"로 판정한다. 판정 근거는 비밀값 유출이 아니라 사업 문서·약점 목록 노출이며, 무료 secret scanning과 Free 요금제 branch protection 손실을 비용으로 기록한다. 제품 코드·migration·배포·저장소 공개 범위 변경은 이 PR에 없다. | [Issue #182](https://github.com/taejunyun1/Tasted_it/issues/182) · [PR #183](https://github.com/taejunyun1/Tasted_it/pull/183) · [`docs/superpowers/plans/2026-08-17-advancement-and-private-repo.md`](./superpowers/plans/2026-08-17-advancement-and-private-repo.md) |
| Proposed | Jay 채팅 승인 후 `origin/main` `7a10dd0`(`#180` 지역 상수 모듈)를 운영 계정에 배포한 결과를 기록한다. 원격 migration 대기 없음. | [PR #181](https://github.com/taejunyun1/Tasted_it/pull/181) · [`7a10dd0`](https://github.com/taejunyun1/Tasted_it/commit/7a10dd054f17ba9b3272f36bb52cf4f26edcaa41) |
| Proposed | 지역 상수·주소 판정·bbox·구집 키를 모듈 1개로 모은다. 공개 론칭은 광주전남. 두 번째 도시·새 테이블/binding/배포 없음. | [Issue #178](https://github.com/taejunyun1/Tasted_it/issues/178) · [PR #180](https://github.com/taejunyun1/Tasted_it/pull/180) |
| Proposed | 전남-광주가 끝나기 전에는 공개·운영 시장을 광주전남만 둔다. 이후 확장은 같은 Worker·D1의 지역 팩으로만 한다. 도시별 Worker/D1/포크/계정과 `regions` 테이블은 기각. 제품 코드·migration·배포는 이 PR에 없다. | [Issue #178](https://github.com/taejunyun1/Tasted_it/issues/178) · [PR #179](https://github.com/taejunyun1/Tasted_it/pull/179) · [`docs/superpowers/plans/2026-08-17-region-pack-expansion.md`](./superpowers/plans/2026-08-17-region-pack-expansion.md) |
| Proposed | 라이브 관리자 QA와 NAVER 표본 1–3곳 실호출을 승인한다. 인증은 기존 ADMIN에 대한 단기 D1 세션이며, 호출은 배포 Worker의 기존 `/admin/place-operations` 액션과 CF secrets만 사용한다. `.dev.vars` 재생성·secret 값 열람·일괄 25곳 없음. | [Issue #161](https://github.com/taejunyun1/Tasted_it/issues/161) · [Issue #163](https://github.com/taejunyun1/Tasted_it/issues/163) · [PR #176](https://github.com/taejunyun1/Tasted_it/pull/176) |
| Proposed | 검수 파이프라인 옆에 영업 재검증·정정·병합 탭을 복구한다. 기존 서버 가드를 유지하고 동일 상호 일괄 자동 병합은 넣지 않는다. 배포·원격 D1·NAVER 실호출은 이 PR에 없다. | [Issue #165](https://github.com/taejunyun1/Tasted_it/issues/165) · [PR #175](https://github.com/taejunyun1/Tasted_it/pull/175) |
| Proposed | 검수 1단계에 회원 장소 제안 승인 UI를 복구한다. SUBMITTED 제안을 지도 확인·사유 입력 후 초안 승인하면 `PLACE_SUGGESTION` work item이 5단계 큐에 합류한다. 배포·원격 D1·NAVER 실호출은 이 PR에 없다. | [Issue #164](https://github.com/taejunyun1/Tasted_it/issues/164) · [PR #173](https://github.com/taejunyun1/Tasted_it/pull/173) |
| Proposed | 운영 Cloudflare 계정 SSOT를 정정한다. 두 운영자 로그인은 계정 `7543330c65069ee2df1b7b353fb0201c`에서 Worker `retaste-beta`와 D1 `retaste-production`을 본다. 가정 계정·개인 계정은 쓰기 대상이 아니다. Jay 채팅 승인 후 `origin/main` `5c4285f` 배포 결과를 기록한다. | [Issue #162](https://github.com/taejunyun1/Tasted_it/issues/162) · [Issue #166](https://github.com/taejunyun1/Tasted_it/issues/166) · [PR #174](https://github.com/taejunyun1/Tasted_it/pull/174) |
| Proposed | 검수 1–5단계 요청/응답 계약과 오류 카탈로그를 추가해 알려진 검수 실패가 전역 500 대신 화면 400이 되게 한다. 로그인 `returnTo`는 `/admin`·`/admin/*`를 허용하고, 운영 대시보드는 `PLACE_REVIEW_*` 공개/보류/제외를 집계한다. 배포·원격 D1·NAVER 실호출은 이 PR에 없다. | [Issue #170](https://github.com/taejunyun1/Tasted_it/issues/170) · [Issue #167](https://github.com/taejunyun1/Tasted_it/issues/167) · [Issue #171](https://github.com/taejunyun1/Tasted_it/issues/171) · [PR #172](https://github.com/taejunyun1/Tasted_it/pull/172) |
| Proposed / TJ `GO` | 관리자 HOLD 오딧과 후속 실행 플랜을 문서화한다. 오딧이 비운 라이브 재현·원격 D1·NAVER 실호출·코드/커밋/배포·잔여 이슈 정리를 #161–#168·#170·#171에 포함한다. 제품 코드·migration·운영 데이터는 바꾸지 않는다. 이 PR 병합은 문서 채택이며 배포·원격 쓰기를 승인하지 않는다. | [Issue #160](https://github.com/taejunyun1/Tasted_it/issues/160) · [PR #169](https://github.com/taejunyun1/Tasted_it/pull/169) |
| Ready / CI PASS | 변경 이력 SSOT·권한 경계·PR 템플릿을 도입하고 README/운영 런북의 NAVER 상한 설명을 정합화한다. 제품 코드·migration·운영 설정은 바꾸지 않는다. 기존 typecheck 오류는 #159에서 수정됐고, 최신 기준선에서 로컬 typecheck·전체 단위 테스트·build와 PR CI가 모두 통과했다. 병합 squash SHA는 다음 기준점 정합성 확인에서 기록한다. | [Issue #156](https://github.com/taejunyun1/Tasted_it/issues/156) · [PR #157](https://github.com/taejunyun1/Tasted_it/pull/157) · [Issue #158](https://github.com/taejunyun1/Tasted_it/issues/158) · [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159) · [PR CI](https://github.com/taejunyun1/Tasted_it/actions/runs/31959115738) |

## 기준선 요약

| 항목 | 값 |
| --- | --- |
| 기간 | 2026-08-14 20:40 KST ~ 2026-08-17 01:31 KST |
| 병합 PR / `main` 커밋 | 31 / 31 |
| 순변경 | 197 files, +15,001 / -1,742 lines |
| 커밋별 누적 변경 | +15,917 / -2,658 lines |
| 신규 migration | 7 files: `0029`, `0030`, `0031` 2개, `0032`, `0033`, `0034` |
| 주요 영역 | 음식점 분류, 추천 계층, NAVER 근거 검증, 장소 검수 파이프라인, 운영 감사, 지도·관리자 UX |
| 운영 완료 증거 | 이 문서에서는 확인하지 않음. 각 PR 및 별도 운영 기록 필요 |

### 현재 검증 상태

- 이전 기준선 `5b56dd3`의 [push CI run 31946826546](https://github.com/taejunyun1/Tasted_it/actions/runs/31946826546)과 갱신 전 [PR #157 CI](https://github.com/taejunyun1/Tasted_it/actions/runs/31951020332)는 `PlaceReviewPipeline.tsx:85`의 같은 `TS2339`로 실패했다.
- [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159)는 idle fetcher의 `formData` 접근을 제거하고 순차 요청별 응답 ID를 검증하도록 수정했다. 최신 `origin/main` `562d5f4`의 [push CI run 31958857659](https://github.com/taejunyun1/Tasted_it/actions/runs/31958857659)는 typecheck와 전체 단위 테스트를 통과했다.
- 따라서 현재 기준선과 최신 [PR #157 CI run 31959115738](https://github.com/taejunyun1/Tasted_it/actions/runs/31959115738)의 **CI 상태는 PASS**다. PR #157은 `562d5f4`를 반영했으며, 현재 병합 판단은 **Ready**다.

### 가장 큰 변동

1. **분류와 추천 계약 정리:** 음식점 자동 제외와 복원, 추천 적격성·행동 가치 계층, 장소 분류 v5와 코스 추천 v2가 추가됐다.
2. **외부 근거 전환:** Workers AI 실행 경로를 제거하고 NAVER API HUB 기반 근거 검증 워크벤치로 전환했다. 호출 제한, 저장 최소화, kill switch를 함께 기록했다.
3. **공개 전 검수 강화:** 공공데이터 원천부터 NAVER·카테고리·중복·선택 공개까지 5단계 서버 강제형 파이프라인을 추가하고 레거시 우회 화면을 통합했다.
4. **운영 안전성 보강:** 읽기 전용 통합 감사, 공개 장소 회수/복구 이력, 10건 순차 NAVER 검증, 오류 화면 내 처리를 추가했다.
5. **사용자·관리자 UX 개선:** 모바일 추천 지도 바텀 시트, 장소 위치 선택 카드, 카테고리 모달/일괄 적용, 운영 탭 분리를 반영했다.

## 상세 변경 이력

모든 시각은 `Asia/Seoul` 기준이다. 커밋의 `+/-`는 해당 squash commit의 GitHub 통계이며 바이너리 파일의 크기 변화는 줄 수에 포함되지 않는다.

### 2026-08-22

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| — | 설계 / 잔여 | `7389537` 기준 남은 일을 시간 단위 시계로 고정한다. 라이브는 `#215` 기록, 익명 `/places`는 공개 카드 4. 배포·일괄 공개·도시 2·결제·`k6`는 이 항목에 없다. | 문서. 제품 코드·migration·배포 없음. | [Issue #219](https://github.com/taejunyun1/Tasted_it/issues/219) · [`docs/superpowers/plans/2026-08-22-remaining-work-hour-plan.md`](./superpowers/plans/2026-08-22-remaining-work-hour-plan.md) |
| 08:09 | NAVER / 검수 | 카테고리 경로의 마지막 업종만 매핑한다. `카페,디저트` 같은 광역 leaf는 세부 카테고리 자동 지정을 하지 않는다. 카드에 세부 추천·광역 확인·미확정을 표시한다. | 코드·테스트. 원문 미보관. 기존 공개 카테고리 일괄 변경 없음. 병합 SHA `7389537`. 이 시각의 배포 기록 없음. | [PR #218](https://github.com/taejunyun1/Tasted_it/pull/218) · [`docs/superpowers/plans/2026-08-22-naver-category-evidence-v2.md`](./superpowers/plans/2026-08-22-naver-category-evidence-v2.md) |

### 2026-08-20

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 20:58 | 운영 / 라이브 | `f42e53a`(`#215`)를 `retaste-beta`에 배포했다. 홈 200, 비로그인 `/admin` 302. NAVER 표본 2회는 둘 다 확인필요(`NOT_FOUND`)로 2단계에 남았다. 24h 호출 980→982. 세션 1행 삭제. | Worker `3115d0dc-673c-40c1-b08d-62811c772f8b`. rollback `49064c1f-bd3f-4eec-a9e5-5985d384a0c1`. 원격 migration apply 없음(최신 `0035`). 상호·주소·secret 기록 없음. | [Issue #214](https://github.com/taejunyun1/Tasted_it/issues/214) · [PR #215](https://github.com/taejunyun1/Tasted_it/pull/215) · [Issue #216](https://github.com/taejunyun1/Tasted_it/issues/216) · [PR #217](https://github.com/taejunyun1/Tasted_it/pull/217) |
| 14:22 | 관리자 / 검수 | NAVER 노매치가 다음 단계로 안 넘어가던 원인을 확인필요로 표시하고, 20자 수동 근거로만 강제 이동한다. 주소 수정은 광주전남만. 순차 검증 50곳, 요청당 NAVER 1회. | 검수 UI·서버·테스트. 병합 SHA `f42e53a`. | [Issue #214](https://github.com/taejunyun1/Tasted_it/issues/214) · [PR #215](https://github.com/taejunyun1/Tasted_it/pull/215) |

### 2026-08-19

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 14:24 | 설계 / 테스트 | 게스트 첫인상 n200 가설을 기록한다. Lightning 분포, Luna 붕괴 폐기. 사람 localhost 재현 전에는 제품 이슈가 아니다. | 문서 4파일. 제품 코드·키·랩 러너·배포·원격 D1 없음. | [Issue #212](https://github.com/taejunyun1/Tasted_it/issues/212) · [PR #213](https://github.com/taejunyun1/Tasted_it/pull/213) · [`docs/superpowers/plans/2026-08-19-persona-lab-n200.md`](./superpowers/plans/2026-08-19-persona-lab-n200.md) |
| 13:00 | 설계 / 테스트 | 페르소나 랩 실험 결과만 남기고 다음 진입점(E1 하네스 / E2 랩 preview)을 분리한다. 300 시나리오 로컬 브랜치는 Archive로 닫는다. | 문서 3파일. 제품 코드·키·랩 러너·배포·원격 D1 없음. | [Issue #210](https://github.com/taejunyun1/Tasted_it/issues/210) · [PR #211](https://github.com/taejunyun1/Tasted_it/pull/211) · [`docs/superpowers/plans/2026-08-19-persona-lab-entry.md`](./superpowers/plans/2026-08-19-persona-lab-entry.md) |

### 2026-08-18

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 19:15 | 설계 / 테스트 | 300명 합성 테스트의 시나리오만 고정한다. `#207` 슬라이스 하네스는 그대로 두고, 가입부터 관찰까지 페르소나·스텝·기대를 카탈로그로 둔다. | 문서 3파일. 제품 코드·하네스 재작성·migration·배포·원격 D1·NAVER/Resend 실호출 없음. | [Issue #208](https://github.com/taejunyun1/Tasted_it/issues/208) · [PR #209](https://github.com/taejunyun1/Tasted_it/pull/209) · [`docs/superpowers/plans/2026-08-18-synthetic-beta-300-scenarios.md`](./superpowers/plans/2026-08-18-synthetic-beta-300-scenarios.md) |
| 15:29 | 운영 / 배포 | `#204` 병합 후 Jay가 원격 `0035` apply와 `origin/main` `e8df8fa` 배포를 실행한다. `#188`–`#202`가 라이브. | 원격 `0035` 적용. Worker `49064c1f-bd3f-4eec-a9e5-5985d384a0c1`. 홈·`/places` GET 200. 라이브 NAVER·일괄 공개 없음. rollback은 `5f031bd2-c34e-4191-8d1f-656fdc4d46a0`. | [Issue #203](https://github.com/taejunyun1/Tasted_it/issues/203) · [PR #204](https://github.com/taejunyun1/Tasted_it/pull/204) · [PR #205](https://github.com/taejunyun1/Tasted_it/pull/205) · [`e8df8fa`](https://github.com/taejunyun1/Tasted_it/commit/e8df8fa) |

### 2026-08-17

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 17:53 | 운영 / 배포 | Jay 채팅 승인으로 이미 병합된 `origin/main` `7a10dd0`를 운영 계정에 배포한다. 지역 상수 모듈(`#180`)이 라이브에 포함된다. | 문서 2파일. 제품 코드·migration apply·D1 create·NAVER 실호출 없음. Worker 버전 `099d8361-989b-488d-bd94-91163551bfb6`. rollback은 직전 버전 `a78d44c8-953a-4331-9854-ed15a986b35b`. | [PR #181](https://github.com/taejunyun1/Tasted_it/pull/181) · [`7a10dd0`](https://github.com/taejunyun1/Tasted_it/commit/7a10dd054f17ba9b3272f36bb52cf4f26edcaa41) |
| 17:40 | 지역 / 상수 | 주소·bbox·구집 키를 지역 팩 모듈 1개로 모은다. 이후 도시가 매처를 포크하지 않게 한다. 공개 론칭은 광주전남. | 코드·테스트. migration·환경 변수·배포·원격 D1·NAVER 호출 없음. | [Issue #178](https://github.com/taejunyun1/Tasted_it/issues/178) · [PR #180](https://github.com/taejunyun1/Tasted_it/pull/180) |
| 17:20 | 설계 / 제약 | 전남-광주 완료 전에는 두 번째 도시를 실어내지 않고, 이후 확장은 지역 팩 한 모듈로만 한다. 상수 정리는 #178. 제주가 게이트 후 첫 도시다. | 문서 2파일. 제품 코드·migration·환경 변수·배포·원격 D1·NAVER 호출 없음. | [Issue #178](https://github.com/taejunyun1/Tasted_it/issues/178) · [PR #179](https://github.com/taejunyun1/Tasted_it/pull/179) |
| 16:20 | 운영 / 라이브 QA | 관리자 라이브 클릭 재현과 NAVER 검수 표본 실호출을 승인한다. 로컬 E2E `qa-admin-session`은 쓰지 않고, 기존 ADMIN 행에 2시간 세션을 만든 뒤 배포 Worker 액션을 호출한다. | 병합 후: `origin/main` 배포, 세션 1행 insert/delete, NAVER 1–3회. 일일 상한 20000, kill switch `NAVER_LOCAL_SEARCH_ENABLED`. 상호·주소·이메일·secret 값 기록 없음. | [Issue #161](https://github.com/taejunyun1/Tasted_it/issues/161) · [Issue #163](https://github.com/taejunyun1/Tasted_it/issues/163) · [PR #176](https://github.com/taejunyun1/Tasted_it/pull/176) |
| 15:22 | 관리자 / 운영 탭 | 검수 옆에 영업 재검증·정정·수동 병합 탭을 복구한다. 동일 상호 후보는 보여 주되 일괄 자동 병합은 하지 않는다. | 코드·테스트·E2E 증거. migration·환경 변수·원격 D1·NAVER 실호출 없음. 배포는 병합 후 `origin/main`. | [Issue #165](https://github.com/taejunyun1/Tasted_it/issues/165) · [PR #175](https://github.com/taejunyun1/Tasted_it/pull/175) |
| 14:22 | 운영 / Cloudflare | 두 운영자 로그인이 같은 owner 계정에서 Worker/D1를 본다는 결론으로 오딧·플랜·런북을 정정한다. 원격 migration은 대기 없음. Jay 채팅 승인 후 `origin/main` `5c4285f`를 계정 `7543330c…`에 배포한 결과를 기록한다. | 문서 4파일. 제품 코드·migration apply·D1 create·NAVER 실호출 없음. Worker 버전 `194a3423-7964-4c58-98d5-0f2d0d822d0d`. rollback은 직전 버전 `d899f619-3df5-49a1-85f6-c5d3b9de87bf`. | [Issue #162](https://github.com/taejunyun1/Tasted_it/issues/162) · [Issue #166](https://github.com/taejunyun1/Tasted_it/issues/166) · [PR #174](https://github.com/taejunyun1/Tasted_it/pull/174) |
| 13:52 | 관리자 / 제안 승인 | 검수 1단계에 회원 장소 제안 목록과 지도 확인 승인 UI를 복구한다. 승인된 DRAFT만 기존 5단계 큐에 합류한다. | 코드·테스트·E2E 증거. migration·환경 변수·배포·원격 D1·NAVER 실호출 없음. | [Issue #164](https://github.com/taejunyun1/Tasted_it/issues/164) · [PR #173](https://github.com/taejunyun1/Tasted_it/pull/173) |
| 13:40 | 관리자 / 검수 계약 | 검수 단계별 송수신·예외 규칙, 관리자 `returnTo`, 운영 대시보드 파이프라인 지표를 코드로 고정한다. 알려진 검수 오류는 화면 400으로 남긴다. | 코드·테스트 12파일. migration·환경 변수·배포·원격 D1·NAVER 실호출 없음. | [Issue #170](https://github.com/taejunyun1/Tasted_it/issues/170) · [Issue #167](https://github.com/taejunyun1/Tasted_it/issues/167) · [Issue #171](https://github.com/taejunyun1/Tasted_it/issues/171) · [PR #172](https://github.com/taejunyun1/Tasted_it/pull/172) |
| 13:05 | 관리자 / 오딧 | 관리자 HOLD 오딧과 후속 실행 플랜을 추가한다. 라이브 로그인 재현, 원격 D1 목록, NAVER 실호출, 코드/커밋/배포, Codex 잔여 이슈 정리를 후속 이슈 #161–#168에 포함한다. 상태는 `PROPOSED`이며 TJ 컨펌 전 후속 착수하지 않는다. | 문서 3파일. 제품 코드·migration·환경 변수·배포·원격 D1·NAVER 호출 없음. | [Issue #160](https://github.com/taejunyun1/Tasted_it/issues/160) · [PR #169](https://github.com/taejunyun1/Tasted_it/pull/169) |
| 01:31 | NAVER / CI 안정화 | React Router v8 fetcher가 idle일 때 존재하지 않는 `formData`를 읽던 타입 오류를 제거했다. 각 순차 요청에 고유 ID를 부여하고 현재 요청과 일치하는 응답만 반영해 지연 응답의 교차 소비도 차단했다. | 코드·테스트 3파일, +15/-4. route action·DB·migration·환경 변수·의존성·배포 변화 및 실제 NAVER 호출 없음. | [Issue #158](https://github.com/taejunyun1/Tasted_it/issues/158) · [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159) · [`562d5f4`](https://github.com/taejunyun1/Tasted_it/commit/562d5f42ec2cd765f0df6617b887aeee9f9664b2) |

### 2026-08-16

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 21:21 | 안정화 / CI | `admin-place-operations`의 `autoWorkItem`이 `unknown[]`로 추론되던 대상 오류를 정리했다. 다만 현재 `main` CI는 별도 `PlaceReviewPipeline.tsx:85` 오류로 여전히 실패하므로 전체 typecheck 복구로 해석하지 않는다. | 코드 1파일, +8/-1. 데이터·API·설정 변화 없음. 잔여 CI 실패는 [#158](https://github.com/taejunyun1/Tasted_it/issues/158)에서 추적한다. | [PR #155](https://github.com/taejunyun1/Tasted_it/pull/155) · [`5b56dd3`](https://github.com/taejunyun1/Tasted_it/commit/5b56dd321c85619b347518fd23ec13e1ed45ad16) |
| 21:04 | NAVER / 검수 | 최대 10건을 단건 순차 처리해 Worker 1102 위험을 낮추고, 수동·자동 흐름을 분리했다. 확인된 NAVER 매핑 카테고리는 검수 작업에 반영한다. | 코드·테스트 7파일, +164/-18. 기존 NAVER 호출 경계를 사용하며 신규 migration 없음. | [PR #154](https://github.com/taejunyun1/Tasted_it/pull/154) · [`c171382`](https://github.com/taejunyun1/Tasted_it/commit/c171382) |
| 07:42 | NAVER / 검수 UX | 화면에서는 최대 25곳을 선택하되 서버는 앞 10곳만 처리하고 나머지 선택을 유지한다. 자동 3단계 이동을 제거하고 관리자가 결과 확인 후 직접 이동하게 했다. | 외부 호출은 요청당 최대 10건. 신규 비밀값·migration·일괄 데이터 변경 없음. | [PR #152](https://github.com/taejunyun1/Tasted_it/pull/152) · [`1b34d2e`](https://github.com/taejunyun1/Tasted_it/commit/1b34d2e) |
| 07:28 | NAVER / 성능 | 화면과 서버의 NAVER 검증 한도를 모두 10건으로 고정하고 계약 테스트를 추가해 Worker CPU 리소스 초과를 완화했다. | 일일 20,000회 상한은 유지하고 요청당 처리량만 축소. 재발 시 비동기 큐 검토가 남았다. | [PR #151](https://github.com/taejunyun1/Tasted_it/pull/151) · [`9d3bf10`](https://github.com/taejunyun1/Tasted_it/commit/9d3bf10) |

### 2026-08-15

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 22:47 | 관리자 오류 처리 | 비음식점 자동 제외 배치 예외를 전체 오류 페이지 대신 현재 화면 오류 메시지로 반환한다. | 코드·테스트 2파일, +13/-2. DB·외부 API 변화 없음. | [PR #149](https://github.com/taejunyun1/Tasted_it/pull/149) · [`22899fd`](https://github.com/taejunyun1/Tasted_it/commit/22899fd) |
| 22:39 | NAVER / 화면 전환 | 성공 직후 서버 redirect를 제거하고 현재 화면에 결과를 유지한 뒤 클라이언트가 3단계로 이동하도록 바꿨다. 직전 #145의 즉시 redirect 방식을 안전한 전환으로 교정했다. | migration·운영 데이터·추가 NAVER 호출 없음. | [PR #147](https://github.com/taejunyun1/Tasted_it/pull/147) · [`d208921`](https://github.com/taejunyun1/Tasted_it/commit/d208921) |
| 22:29 | NAVER / 화면 전환 | NAVER 검수 성공 뒤 카테고리 확정 3단계로 이동하고 페이지를 1로 초기화하되 필터를 보존하도록 했다. | UI 흐름과 회귀 테스트만 변경. 이후 #147과 #152가 전환 방식을 보완했다. | [PR #145](https://github.com/taejunyun1/Tasted_it/pull/145) · [`9af4788`](https://github.com/taejunyun1/Tasted_it/commit/9af4788) |
| 22:11 | 원천 검수 / 자동 제외 | 현재 페이지 전체 선택을 토글로 통합하고 최대 25곳의 확실한 비음식점만 `EXCLUDED/AUTO_NON_FOOD`로 기록한다. 원천·장소 데이터와 기존 공개 상태는 삭제하지 않는다. | 기존 복원 흐름으로 되돌릴 수 있는 감사 이력이 생긴다. 신규 migration·외부 호출 없음. | [PR #143](https://github.com/taejunyun1/Tasted_it/pull/143) · [`4a107dc`](https://github.com/taejunyun1/Tasted_it/commit/4a107dc) |
| 21:35 | 관리자 IA / 레거시 정리 | 공개 후 운영·후보 승인 우회 화면을 제거하고 `/admin/place-operations` 1~5단계로 통합했다. 기존 후보 경로는 권한 확인 후 1단계로 redirect한다. | 16파일, +89/-1,155로 레거시 UI를 크게 축소. 데이터 자체는 변경하지 않는다. | [PR #141](https://github.com/taejunyun1/Tasted_it/pull/141) · [`c27bead`](https://github.com/taejunyun1/Tasted_it/commit/c27bead) |
| 21:14 | 검수 파이프라인 UI | 원천 → NAVER → 카테고리 → 중복 → 선택 공개의 5단계 화면과 blocking overlay, 단계 탐색, 카드·툴바를 추가했다. 중복 미판정은 자동 공개하지 않는다. | 기존 NAVER 키·한도를 사용한다. 신규 공급자·binding·의존성 없음. | [PR #139](https://github.com/taejunyun1/Tasted_it/pull/139) · [`8e8a68c`](https://github.com/taejunyun1/Tasted_it/commit/8e8a68c) |
| 20:28 | 검수 파이프라인 기반 | 검수 작업·중복 결정·초기 backfill을 위한 `0034_place_review_pipeline.sql`, 5단계 게이트, 서버 페이지네이션과 작업 생성 로직을 추가했다. | 원격 D1에는 `0034` 적용 필요. rollback은 기존 migration 수정이 아니라 forward-fix를 사용한다. | [PR #137](https://github.com/taejunyun1/Tasted_it/pull/137) · [`a62af55`](https://github.com/taejunyun1/Tasted_it/commit/a62af55) |
| 19:48 | 설계 / 계획 | 648건 이상을 다루는 5단계 검수, 25건 일괄 처리, 동시 공개 claim, backfill·forward-fix·배포 게이트를 설계하고 구현을 3개 PR로 분리했다. | 문서 2파일만 추가. 이 PR 자체는 migration·NAVER 호출·배포를 실행하지 않았다. | [PR #136](https://github.com/taejunyun1/Tasted_it/pull/136) · [`82f602d`](https://github.com/taejunyun1/Tasted_it/commit/82f602d) |
| 19:23 | 모바일 지도 UX | 홈 추천 목록을 모바일 바텀 시트로 바꾸고 장소 선택 시 peek로 접으며 지도 중심·마커 선택을 동기화했다. 데스크톱 좌측 패널 구조는 유지한다. | DB·외부 서비스 변화 없음. 데스크톱/모바일 증거와 E2E를 추가했다. | [PR #134](https://github.com/taejunyun1/Tasted_it/pull/134) · [`47f1070`](https://github.com/taejunyun1/Tasted_it/commit/47f1070) |
| 16:26 | 관리자 IA | 긴 장소 운영 화면을 근거 감사, NAVER 검증, 영업 재검증, 장소 제안, 정보 정정, 중복·이력 탭으로 분리하고 URL에 탭 상태를 보존한다. | migration·외부 호출·설정 변화 없음. | [PR #133](https://github.com/taejunyun1/Tasted_it/pull/133) · [`f916feb`](https://github.com/taejunyun1/Tasted_it/commit/f916feb) |
| 16:16 | NAVER / 중복 운영 | 앱 내부 NAVER 일일 상한을 200에서 20,000으로 높이고 사용량을 표시한다. 프랜차이즈를 제외하고 동일 정규화 상호와 동일 주소 또는 100m 이내인 장소만 관리자 확인으로 병합한다. | `wrangler.jsonc` 기본값이 20,000으로 변경. 배포만으로 자동 병합되지는 않으며 관리자 작업이 필요하다. | [PR #131](https://github.com/taejunyun1/Tasted_it/pull/131) · [`80f6270`](https://github.com/taejunyun1/Tasted_it/commit/80f6270) |
| 15:58 | 장소 제안 UX | 공통 input CSS 충돌을 피하도록 주소 라디오를 카드 버튼으로 바꾸고, 주소 변경 시 이전 위치 확정을 해제한다. | 저장 구조·외부 API 호출 방식 변화 없음. | [PR #129](https://github.com/taejunyun1/Tasted_it/pull/129) · [`1f3bec3`](https://github.com/taejunyun1/Tasted_it/commit/1f3bec3) |
| 15:46 | NAVER / 공개 회수 | 상호·주소/100m·구체 카테고리가 모두 확인된 후보만 자동 분류한다. 공개 장소 회수는 `PUBLISHED`를 `HIDDEN`으로 바꾸고 실행시각 감사 로그로 같은 실행만 복구한다. | `0033_naver_place_liveness.sql` 필요. NAVER 일일 한도 공유, 화면 실행 최대 25곳. | [PR #127](https://github.com/taejunyun1/Tasted_it/pull/127) · [`201da3f`](https://github.com/taejunyun1/Tasted_it/commit/201da3f) |
| 15:03 | 관리자 카테고리 UX | 긴 기본 select를 blocking 모달/모바일 시트로 바꾸고 선택한 최대 25개 후보에 같은 카테고리를 일괄 적용한다. | 기존 승인 action 형식을 유지해 서버·DB 계약 변화 없음. | [PR #126](https://github.com/taejunyun1/Tasted_it/pull/126) · [`c729ee0`](https://github.com/taejunyun1/Tasted_it/commit/c729ee0) |
| 14:03 | 외부 근거 / 운영 전환 | Workers AI binding·실행 경로·사용량 UI를 제거하고 NAVER API HUB 기반 근거 워크벤치로 전환했다. 동기화/관리자 선택은 실행당 최대 25곳이며 응답 원문·장소 ID·사진·리뷰를 저장하지 않는다. | `0031_remove_workers_ai.sql`은 AI 실행 이력을 삭제하는 파괴 migration이다. `NAVER_API_HUB_KEY_ID/KEY`와 원격 적용·배포 절차가 필요하며 실제 실행 완료는 이 문서에서 미확인이다. | [PR #125](https://github.com/taejunyun1/Tasted_it/pull/125) · [`f8613c1`](https://github.com/taejunyun1/Tasted_it/commit/f8613c1) |
| 13:29 | 분류 v5 / 코스 v2 | 제외 → 구체 업태 → 일반 fallback → 신뢰/수동 검토를 병행 저장하는 분류 v5와 KST 시간대·영업시간·메뉴 궁합 기반 코스 v2를 추가했다. | `0031_place_category_v5_profiles.sql`, `0032_place_course_context.sql` 필요. 두 기능 플래그 기본값은 `false`; 공개 일괄 변경 없음. | [PR #122](https://github.com/taejunyun1/Tasted_it/pull/122) · [`dc2005e`](https://github.com/taejunyun1/Tasted_it/commit/dc2005e) |
| 11:44 | NAVER / 활성화 안전 | NAVER 지역검색 플래그를 운영 활성화하고, 꺼진 상태에서는 100건 개별 실패를 만들지 않고 배치 전체를 중단하도록 했다. | 당시 일일 상한은 200이었으며 #131에서 20,000으로 변경됐다. 원문 응답·provider ID는 저장하지 않는다. | [PR #121](https://github.com/taejunyun1/Tasted_it/pull/121) · [`dcf7b42`](https://github.com/taejunyun1/Tasted_it/commit/dcf7b42) |
| 03:15 | 관리자 QA | 비활성 NAVER 상태를 실행 전에 차단해 정확한 안내를 보여주고, 최근 발행 날짜를 KST로 고정해 SSR 수화 불일치를 제거했다. | 데이터·실제 NAVER 호출·flag 변경 없음. | [PR #119](https://github.com/taejunyun1/Tasted_it/pull/119) · [`fe5be20`](https://github.com/taejunyun1/Tasted_it/commit/fe5be20) |
| 02:48 | NAVER 카테고리 검증 | 상호와 정규화 주소 또는 100m 좌표 일치를 요구하는 NAVER Local Search 검증, 최소 결과 저장, 관리자 preview/apply, 공개 장소 재분류를 추가했다. | `0030_naver_local_category_verification.sql`, NAVER secrets, `NAVER_LOCAL_SEARCH_ENABLED` kill switch가 추가됐다. 당시 안전 기본 상한은 200. | [PR #117](https://github.com/taejunyun1/Tasted_it/pull/117) · [`c0d707d`](https://github.com/taejunyun1/Tasted_it/commit/c0d707d) |
| 01:05 | 음식점 분류 | 원천 업태의 정종·대포집·소주방·포차 신호를 포차 카테고리로 우선하고, 구체 업태와 AI가 충돌하면 수동 검토로 보낸다. 관리자 최종 선택을 항상 허용한다. | 기존 분류·검수 로직과 테스트 변경. 신규 migration 없음. | [PR #116](https://github.com/taejunyun1/Tasted_it/pull/116) · [`e3593d5`](https://github.com/taejunyun1/Tasted_it/commit/e3593d5) |
| 01:03 | 주소 정규화 | `전남광주` 축약 주소를 광주광역시 주소로 정규화하고 지도 검색과 서버 승인에 같은 표준 주소를 사용한다. | 기존 승인 실패를 수정하며 migration·환경 변수·추가 외부 API 변화 없음. | [PR #114](https://github.com/taejunyun1/Tasted_it/pull/114) · [`3868d20`](https://github.com/taejunyun1/Tasted_it/commit/3868d20) |
| 00:06 | 운영 감사 | 평가·사진·Golden Pick·보존기간·추천 적격성을 bounded D1 snapshot으로 읽는 ADMIN 전용 감사 화면과 runbook을 추가했다. | 읽기 전용이며 이메일·전화·세션·원문 주소·R2 key·원문 JSON을 DTO/UI에 내보내지 않는다. migration·자동 수정 없음. | [PR #112](https://github.com/taejunyun1/Tasted_it/pull/112) · [`cdac614`](https://github.com/taejunyun1/Tasted_it/commit/cdac614) |

### 2026-08-14

| 시각 | 영역 | 변경과 이유 | 데이터·운영 영향 | 근거 |
| --- | --- | --- | --- | --- |
| 22:42 | 추천 계층 | 홈·목록의 추천 적격성, 행동별 취향 가치, `DIRECT/ADJACENT/EXPLORATION` 관계를 공통 계층으로 분리했다. 기존 순서와 공개 `FAMILIAR` 응답은 유지했다. | 내부 리팩터링이며 DB·환경 변수·AI 호출 변화 없음. | [PR #111](https://github.com/taejunyun1/Tasted_it/pull/111) · [`56b05f2`](https://github.com/taejunyun1/Tasted_it/commit/56b05f2) |
| 21:53 | 사업 모델 감사 | 수익 준비도를 약 30/100으로 평가하고 첫 유료 후보를 수동 Revisit로 두는 고고도 플랜을 기록했다. | 문서 상태는 `PROPOSED`. 결제·PSP·캠페인 구현 또는 과금 승인이 아니다. | [PR #108](https://github.com/taejunyun1/Tasted_it/pull/108) · [`469dbdb`](https://github.com/taejunyun1/Tasted_it/commit/469dbdb) |
| 21:53 | 추천 계획 | x-algorithm 코드를 이식하지 않고 자격/점수 분리, 행동 가치, 취향 일치와 탐색 할인 패턴만 참조하는 계획을 추가했다. | 문서만 변경. Phoenix·벡터 검색·Queue·광고 blender는 HOLD. | [PR #107](https://github.com/taejunyun1/Tasted_it/pull/107) · [`c6282f9`](https://github.com/taejunyun1/Tasted_it/commit/c6282f9) |
| 20:40 | 음식점 분류 / 일괄 적용 | 식육·숯불구이를 `고기·구이`로 우선 재분류하고 확실한 비음식 업종을 자동 제외한다. 공개 장소 100곳씩 preview/apply하고 관리자가 복원할 수 있다. | `0029_auto_not_restaurant_exclusion.sql` 필요. 카테고리와 제외 결과는 감사 이력으로 추적한다. | [PR #110](https://github.com/taejunyun1/Tasted_it/pull/110) · [`e254970`](https://github.com/taejunyun1/Tasted_it/commit/e254970) |

## Migration·설정·외부 연동 변동 인벤토리

### D1 migration

| 파일 | 도입 PR | 목적 | 운영 주의 |
| --- | --- | --- | --- |
| `0029_auto_not_restaurant_exclusion.sql` | [#110](https://github.com/taejunyun1/Tasted_it/pull/110) | 자동 비음식점 제외·분류 적용 기반 | 적용 후 관리자 preview/apply가 별도로 필요 |
| `0030_naver_local_category_verification.sql` | [#117](https://github.com/taejunyun1/Tasted_it/pull/117) | NAVER 카테고리 최소 검증 결과 저장 | secrets·kill switch·quota 확인 필요 |
| `0031_place_category_v5_profiles.sql` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | 분류 v5 shadow 프로필 | `PLACE_CATEGORY_V5_ENABLED=false` 기본 |
| `0031_remove_workers_ai.sql` | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | Workers AI 실행 이력 제거 | 파괴 변경. 백업·승인·정확한 적용 순서 확인 필요 |
| `0032_place_course_context.sql` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | 코스 추천 v2 컨텍스트 | `COURSE_CONTEXT_V2_ENABLED=false` 기본 |
| `0033_naver_place_liveness.sql` | [#127](https://github.com/taejunyun1/Tasted_it/pull/127) | NAVER 공개 장소 재검증·회수 이력 | 같은 실행시각 감사 로그로만 복구 |
| `0034_place_review_pipeline.sql` | [#137](https://github.com/taejunyun1/Tasted_it/pull/137) | 5단계 검수 작업·중복 결정·backfill | 기존 migration 수정 금지, 문제는 forward-fix |

`0031` 접두사가 두 파일에 중복된 것이 현재 `main`의 사실이다. 이 문서는 원격 적용 순서나 적용 완료를 추정하지 않는다. 운영 전에는 정확한 파일명과 `wrangler d1 migrations list` 결과, 병합 PR의 승인 범위를 대조해야 한다.

### 런타임 설정과 공급자

| 항목 | 최종 확인값 / 상태 | 변경 근거 | 주의 |
| --- | --- | --- | --- |
| `NAVER_LOCAL_SEARCH_ENABLED` | `true` in `wrangler.jsonc` | [#121](https://github.com/taejunyun1/Tasted_it/pull/121) | 장애 시 `false`로 중단 후 재배포 |
| `NAVER_LOCAL_SEARCH_DAILY_LIMIT` | `20000` in `wrangler.jsonc` | [#131](https://github.com/taejunyun1/Tasted_it/pull/131) | API Hub 전체 사용량과 앱 기록 사용량은 다를 수 있음 |
| `NAVER_API_HUB_KEY_ID`, `NAVER_API_HUB_KEY` | Worker secrets 필요 | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | 값은 문서·로그·PR에 노출 금지 |
| Workers AI binding | 제거 | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | `0031_remove_workers_ai.sql`의 원격 적용 여부 별도 확인 |
| `PLACE_CATEGORY_V5_ENABLED` | `false` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | shadow 검수 전 공개 변경 금지 |
| `COURSE_CONTEXT_V2_ENABLED` | `false` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | off이면 기존 코스 추천 유지 |

## 갱신 절차

### 변경 PR 작성자

1. Issue 또는 Draft PR에 담당자, 범위, 소유 파일을 먼저 기록한다.
2. Draft PR 번호를 확보한 뒤 이 문서의 최신 날짜 아래에 항목을 추가한다.
3. 변경 이유, 사용자/운영 영향, migration·환경 변수·외부 연동, 검증, rollback, PR 링크를 빠짐없이 적는다.
4. 같은 날의 후속 수정은 별도 행으로 남기고, 무엇을 대체하거나 보완했는지 명시한다.
5. 독립 이력 가치가 없는 변경은 PR 템플릿에 미기록 사유를 적는다.

### 기준 커밋 정합성 확인

```bash
git fetch origin
git rev-parse origin/main
git log --first-parent --date=iso-local --format='%h %ad %s' <기록된-커밋>..origin/main
git diff --stat <기록된-커밋>..origin/main
gh pr list --repo taejunyun1/Tasted_it --state merged --base main --limit 100
```

누락이 없을 때만 `마지막 확인`, `확인한 원격 기준`, 기준선 통계를 갱신한다. GitHub API나 로컬 원격 참조를 확인하지 못했으면 `HOLD / UNVERIFIED`로 기록하고 기준 커밋을 전진시키지 않는다.

## 읽는 법과 제한

- **코드가 실제로 존재하는가?** `origin/main` 커밋과 파일을 확인한다.
- **무엇이 승인됐는가?** 링크된 병합 PR의 본문과 승인 SSOT를 확인한다.
- **원격 migration·배포가 실행됐는가?** PR의 운영 댓글, Cloudflare/D1 증거 또는 별도 운영 기록을 확인한다.
- **이 문서가 최신인가?** 기록된 SHA와 현재 `origin/main`을 비교한다.
- **로컬 `worklog/`과 다른가?** `worklog/`는 로컬 실행 참고 기록이므로 저장소 이력은 이 문서와 원본 Git/PR을 따른다.

---

# Re:Taste `main` Change History SSOT

- **Document role:** SSOT for discovering, summarizing, and tracing changes on `main`
- **Status:** ACCEPTED when [PR #157](https://github.com/taejunyun1/Tasted_it/pull/157) is merged
- **Last verified:** 2026-08-17 01:37 KST
- **Verified remote baseline:** [`562d5f4`](https://github.com/taejunyun1/Tasted_it/commit/562d5f42ec2cd765f0df6617b887aeee9f9664b2)
- **Baseline range:** after [`b44b8f5`](https://github.com/taejunyun1/Tasted_it/commit/b44b8f5b621771717dc4b4fa71d5feb46934df41), through `562d5f4`
- **Source repository:** [`taejunyun1/Tasted_it`](https://github.com/taejunyun1/Tasted_it)

This is the official index for understanding what entered remote `main`, why it changed, and what it affected. `origin/main` is authoritative for current files, merged Pull Requests are authoritative for approval and operational scope, and this document is authoritative for navigating changes across them. See the [SSOT decision](./decisions/2026-08-16-main-change-history-ssot.md) for the full boundary.

> **Accuracy rule:** If the recorded baseline differs from current `origin/main`, do not treat this document as current. Reconcile missing commits and merged PRs first. This document alone never proves that a deployment, remote D1 migration, production-data operation, or external API call was executed.

## Changes Registered After the Baseline

| Status | Change and impact | Evidence |
| --- | --- | --- |
| Proposed | Until 전남-광주 is complete, keep 광주전남 as the only launch market and expand later only via a region pack on one Worker and one D1. Rejects city-specific Workers, D1 shards, forks, a second account, and a `regions` table. No product code, migration, or deploy in this PR. | [Issue #178](https://github.com/taejunyun1/Tasted_it/issues/178) · [PR #179](https://github.com/taejunyun1/Tasted_it/pull/179) · [`docs/superpowers/plans/2026-08-17-region-pack-expansion.md`](./superpowers/plans/2026-08-17-region-pack-expansion.md) |
| Ready / CI PASS | Introduces the history SSOT, authority boundary, and PR template; reconciles the NAVER limit explanation in README and the operations runbook. It changes no product code, migration, or runtime setting. #159 fixed the pre-existing typecheck failure, and local typecheck, full unit tests, build, and PR CI all pass on the updated baseline. Record the squash SHA during the next baseline reconciliation. | [Issue #156](https://github.com/taejunyun1/Tasted_it/issues/156) · [PR #157](https://github.com/taejunyun1/Tasted_it/pull/157) · [Issue #158](https://github.com/taejunyun1/Tasted_it/issues/158) · [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159) · [PR CI](https://github.com/taejunyun1/Tasted_it/actions/runs/31959115738) |

## Baseline Summary

| Item | Value |
| --- | --- |
| Period | 2026-08-14 20:40 KST to 2026-08-17 01:31 KST |
| Merged PRs / `main` commits | 31 / 31 |
| Net change | 197 files, +15,001 / -1,742 lines |
| Cumulative per-commit change | +15,917 / -2,658 lines |
| New migrations | 7 files: `0029`, `0030`, two `0031` files, `0032`, `0033`, `0034` |
| Major areas | restaurant classification, recommendation layers, NAVER evidence, place-review pipeline, operations audit, map/admin UX |
| Production execution evidence | Not verified here; inspect each PR and separate operations records |

### Current Verification Status

- The previous `5b56dd3` [push CI run 31946826546](https://github.com/taejunyun1/Tasted_it/actions/runs/31946826546) and the pre-sync [PR #157 CI](https://github.com/taejunyun1/Tasted_it/actions/runs/31951020332) failed on the same `TS2339` at `PlaceReviewPipeline.tsx:85`.
- [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159) removed access to idle fetcher `formData` and validates a response ID for each sequential request. The [push CI run 31958857659](https://github.com/taejunyun1/Tasted_it/actions/runs/31958857659) for current `origin/main` `562d5f4` passes typecheck and the full unit suite.
- The current baseline and the latest [PR #157 CI run 31959115738](https://github.com/taejunyun1/Tasted_it/actions/runs/31959115738) both have **PASS** status. PR #157 incorporates `562d5f4` and is now **Ready** for merge review.

### Major Changes

1. **Classification and recommendation contracts:** added automatic non-food exclusion and restoration, recommendation eligibility/action-value layers, category v5, and course recommendation v2.
2. **External evidence transition:** removed Workers AI execution and moved to a NAVER API HUB evidence workbench with quotas, minimal persistence, and kill switches.
3. **Stronger pre-publication review:** added a server-enforced five-step pipeline from public source through NAVER, category, duplicate review, and explicit publication; consolidated legacy bypass screens.
4. **Operational safety:** added read-only integrated audit, publication recall/restore history, sequential ten-item NAVER verification, and in-screen error handling.
5. **User and admin UX:** added a mobile recommendation-map bottom sheet, place-location cards, category modal/batch apply, and operations tabs.

## Detailed History

All timestamps use `Asia/Seoul`. `+/-` values are GitHub squash-commit statistics; binary size changes are not represented as lines.

### 2026-08-17

| Time | Area | Change and rationale | Data/operations impact | Evidence |
| --- | --- | --- | --- | --- |
| 01:31 | NAVER / CI stabilization | Removed the type error caused by reading unavailable `formData` while a React Router v8 fetcher is idle. Each sequential request now has a unique ID and only a matching response is applied, preventing delayed cross-request consumption. | Three code/test files, +15/-4. No route-action, DB, migration, environment, dependency, deployment, or real NAVER-call change. | [Issue #158](https://github.com/taejunyun1/Tasted_it/issues/158) · [PR #159](https://github.com/taejunyun1/Tasted_it/pull/159) · [`562d5f4`](https://github.com/taejunyun1/Tasted_it/commit/562d5f42ec2cd765f0df6617b887aeee9f9664b2) |

### 2026-08-16

| Time | Area | Change and rationale | Data/operations impact | Evidence |
| --- | --- | --- | --- | --- |
| 21:21 | Stabilization / CI | Fixed the targeted `autoWorkItem` `unknown[]` inference in `admin-place-operations`. Current `main` CI still fails on a separate `PlaceReviewPipeline.tsx:85` error, so this is not treated as full typecheck recovery. | One code file, +8/-1. No data, API, or configuration change. The remaining CI failure is tracked in [#158](https://github.com/taejunyun1/Tasted_it/issues/158). | [PR #155](https://github.com/taejunyun1/Tasted_it/pull/155) · [`5b56dd3`](https://github.com/taejunyun1/Tasted_it/commit/5b56dd321c85619b347518fd23ec13e1ed45ad16) |
| 21:04 | NAVER / Review | Split up to ten checks into sequential single-item operations, separated manual and automatic flows, and applied verified NAVER category mappings to review work. | Seven code/test files, +164/-18. Reuses existing NAVER boundaries; no migration. | [PR #154](https://github.com/taejunyun1/Tasted_it/pull/154) · [`c171382`](https://github.com/taejunyun1/Tasted_it/commit/c171382) |
| 07:42 | NAVER / Review UX | Allows selecting 25 places while processing only the first ten, preserves the remaining selection, and requires a manual transition after reviewing results. | At most ten external calls per request. No new secret, migration, or bulk data change. | [PR #152](https://github.com/taejunyun1/Tasted_it/pull/152) · [`1b34d2e`](https://github.com/taejunyun1/Tasted_it/commit/1b34d2e) |
| 07:28 | NAVER / Performance | Fixed both UI and server limits at ten and added a contract test to reduce Worker 1102 CPU exhaustion. | Keeps the 20,000 daily cap; only per-request throughput changed. Async queue remains the fallback if 1102 recurs. | [PR #151](https://github.com/taejunyun1/Tasted_it/pull/151) · [`9d3bf10`](https://github.com/taejunyun1/Tasted_it/commit/9d3bf10) |

### 2026-08-15

| Time | Area | Change and rationale | Data/operations impact | Evidence |
| --- | --- | --- | --- | --- |
| 22:47 | Admin error handling | Returns automatic non-food exclusion failures inside the current screen instead of an error page. | Two code/test files, +13/-2. No DB or external API change. | [PR #149](https://github.com/taejunyun1/Tasted_it/pull/149) · [`22899fd`](https://github.com/taejunyun1/Tasted_it/commit/22899fd) |
| 22:39 | NAVER / Transition | Removed the immediate server redirect, kept results visible, and moved to step 3 safely on the client, correcting #145. | No migration, production-data change, or extra NAVER call. | [PR #147](https://github.com/taejunyun1/Tasted_it/pull/147) · [`d208921`](https://github.com/taejunyun1/Tasted_it/commit/d208921) |
| 22:29 | NAVER / Transition | Moved successful verification to category step 3, reset pagination, and preserved filters. | UI flow and regression tests only; later refined by #147 and #152. | [PR #145](https://github.com/taejunyun1/Tasted_it/pull/145) · [`9af4788`](https://github.com/taejunyun1/Tasted_it/commit/9af4788) |
| 22:11 | Source review / Exclusion | Unified page selection as a toggle and records only clear non-food venues as `EXCLUDED/AUTO_NON_FOOD`, without deleting sources, places, or public state. | Adds auditable, restorable exclusion using existing paths; no migration or external call. | [PR #143](https://github.com/taejunyun1/Tasted_it/pull/143) · [`4a107dc`](https://github.com/taejunyun1/Tasted_it/commit/4a107dc) |
| 21:35 | Admin IA / Legacy | Consolidated post-publication operations and candidate approval into `/admin/place-operations` steps 1–5; old candidate routes now redirect after auth. | 16 files, +89/-1,155, removing substantial legacy UI without changing data. | [PR #141](https://github.com/taejunyun1/Tasted_it/pull/141) · [`c27bead`](https://github.com/taejunyun1/Tasted_it/commit/c27bead) |
| 21:14 | Review pipeline UI | Added the source → NAVER → category → duplicate → selected-publication UI, blocking overlay, navigation, cards, and toolbar; undecided duplicates cannot auto-publish. | Uses existing NAVER keys and limits; no new provider, binding, or dependency. | [PR #139](https://github.com/taejunyun1/Tasted_it/pull/139) · [`8e8a68c`](https://github.com/taejunyun1/Tasted_it/commit/8e8a68c) |
| 20:28 | Review pipeline foundation | Added `0034_place_review_pipeline.sql`, stage gates, database pagination, work-item creation, duplicate decisions, and initial backfill. | Remote D1 requires `0034`; use forward-fix rather than editing the migration. | [PR #137](https://github.com/taejunyun1/Tasted_it/pull/137) · [`a62af55`](https://github.com/taejunyun1/Tasted_it/commit/a62af55) |
| 19:48 | Design / Plan | Designed the five-stage pipeline for 648+ rows, 25-item batches, concurrent publication claims, backfill, forward-fix, and deployment gates. | Two documentation files only; no migration, NAVER call, or deploy executed by this PR. | [PR #136](https://github.com/taejunyun1/Tasted_it/pull/136) · [`82f602d`](https://github.com/taejunyun1/Tasted_it/commit/82f602d) |
| 19:23 | Mobile map UX | Replaced the mobile recommendation list with a bottom sheet; selection collapses it to peek and synchronizes map center and marker. Desktop layout remains. | No DB or provider change; adds desktop/mobile evidence and E2E. | [PR #134](https://github.com/taejunyun1/Tasted_it/pull/134) · [`47f1070`](https://github.com/taejunyun1/Tasted_it/commit/47f1070) |
| 16:26 | Admin IA | Split the long operations page into audit, NAVER, liveness, suggestion, correction, and duplicate/history tabs with URL state. | No migration, external call, or configuration change. | [PR #133](https://github.com/taejunyun1/Tasted_it/pull/133) · [`f916feb`](https://github.com/taejunyun1/Tasted_it/commit/f916feb) |
| 16:16 | NAVER / Duplicate ops | Raised the internal daily limit from 200 to 20,000 and added admin-reviewed merging only for non-franchises with normalized same name plus same address or 100m proximity. | `wrangler.jsonc` now uses 20,000. Deploy does not merge anything automatically. | [PR #131](https://github.com/taejunyun1/Tasted_it/pull/131) · [`80f6270`](https://github.com/taejunyun1/Tasted_it/commit/80f6270) |
| 15:58 | Place suggestion UX | Replaced radio inputs with card buttons to avoid shared-input CSS conflicts and clears confirmation when the address changes. | No storage or external-call contract change. | [PR #129](https://github.com/taejunyun1/Tasted_it/pull/129) · [`1f3bec3`](https://github.com/taejunyun1/Tasted_it/commit/1f3bec3) |
| 15:46 | NAVER / Publication recall | Auto-classifies only when name, address/100m, and concrete category agree; recalls `PUBLISHED` to `HIDDEN` and restores only the matching run timestamp. | Requires `0033_naver_place_liveness.sql`; shares the NAVER daily quota and caps a screen run at 25. | [PR #127](https://github.com/taejunyun1/Tasted_it/pull/127) · [`201da3f`](https://github.com/taejunyun1/Tasted_it/commit/201da3f) |
| 15:03 | Admin category UX | Replaced the long select with a blocking modal/mobile sheet and applies one category to up to 25 selected candidates. | Keeps the existing action payload and server/DB contract. | [PR #126](https://github.com/taejunyun1/Tasted_it/pull/126) · [`c729ee0`](https://github.com/taejunyun1/Tasted_it/commit/c729ee0) |
| 14:03 | External evidence / Ops | Removed Workers AI binding/execution/usage UI and moved to a NAVER API HUB evidence workbench with 25-item runs and minimal persistence. | `0031_remove_workers_ai.sql` destructively removes AI run history. Requires API HUB secrets and separately verified remote execution. | [PR #125](https://github.com/taejunyun1/Tasted_it/pull/125) · [`f8613c1`](https://github.com/taejunyun1/Tasted_it/commit/f8613c1) |
| 13:29 | Category v5 / Course v2 | Added exclusion → concrete source → general fallback → confidence/manual-review category v5 and KST/hour/menu compatibility course v2. | Requires `0031_place_category_v5_profiles.sql` and `0032_place_course_context.sql`; both flags default to `false`. | [PR #122](https://github.com/taejunyun1/Tasted_it/pull/122) · [`dc2005e`](https://github.com/taejunyun1/Tasted_it/commit/dc2005e) |
| 11:44 | NAVER / Safe enablement | Enabled regional search in production configuration and stops the whole batch safely when disabled rather than recording 100 failures. | The cap was 200 at this point and was superseded by #131. Raw responses and provider IDs remain unstored. | [PR #121](https://github.com/taejunyun1/Tasted_it/pull/121) · [`dcf7b42`](https://github.com/taejunyun1/Tasted_it/commit/dcf7b42) |
| 03:15 | Admin QA | Blocks a disabled NAVER run before execution with precise guidance and fixes recent-publication dates to KST to avoid hydration mismatches. | No data, real NAVER call, or flag change. | [PR #119](https://github.com/taejunyun1/Tasted_it/pull/119) · [`fe5be20`](https://github.com/taejunyun1/Tasted_it/commit/fe5be20) |
| 02:48 | NAVER category evidence | Added Local Search matching by name plus normalized address or 100m, minimal evidence storage, admin preview/apply, and published-place reclassification. | Added `0030_naver_local_category_verification.sql`, NAVER secrets, and a kill switch; initial safe cap was 200. | [PR #117](https://github.com/taejunyun1/Tasted_it/pull/117) · [`c0d707d`](https://github.com/taejunyun1/Tasted_it/commit/c0d707d) |
| 01:05 | Restaurant classification | Prioritizes source categories such as sake house, pub, and pocha; conflicts between concrete source and AI require manual review, while admin choice remains authoritative. | Existing classification/review code and tests only; no migration. | [PR #116](https://github.com/taejunyun1/Tasted_it/pull/116) · [`e3593d5`](https://github.com/taejunyun1/Tasted_it/commit/e3593d5) |
| 01:03 | Address normalization | Normalizes abbreviated `전남광주` addresses to Gwangju Metropolitan City and uses the same address for map search and server approval. | Fixes approval failures without migration, environment, or extra API changes. | [PR #114](https://github.com/taejunyun1/Tasted_it/pull/114) · [`3868d20`](https://github.com/taejunyun1/Tasted_it/commit/3868d20) |
| 00:06 | Operations audit | Added an ADMIN-only bounded D1 snapshot and runbook for ratings, photos, Golden Pick, retention, and recommendation eligibility. | Read-only; excludes email, phone, sessions, raw address, R2 keys, and raw JSON. No migration or automatic repair. | [PR #112](https://github.com/taejunyun1/Tasted_it/pull/112) · [`cdac614`](https://github.com/taejunyun1/Tasted_it/commit/cdac614) |

### 2026-08-14

| Time | Area | Change and rationale | Data/operations impact | Evidence |
| --- | --- | --- | --- | --- |
| 22:42 | Recommendation layers | Shared recommendation eligibility, action values, and `DIRECT/ADJACENT/EXPLORATION` relations across home and lists while retaining existing order and public `FAMILIAR` output. | Internal refactor only; no DB, environment, or AI-call change. | [PR #111](https://github.com/taejunyun1/Tasted_it/pull/111) · [`56b05f2`](https://github.com/taejunyun1/Tasted_it/commit/56b05f2) |
| 21:53 | Business-model audit | Assessed monetization readiness at roughly 30/100 and proposed manual Revisit as the first paid candidate. | Document remains `PROPOSED`; it does not approve payments, PSP, campaigns, or public billing. | [PR #108](https://github.com/taejunyun1/Tasted_it/pull/108) · [`469dbdb`](https://github.com/taejunyun1/Tasted_it/commit/469dbdb) |
| 21:53 | Recommendation plan | Added a plan that references only eligibility/scoring separation, action values, taste match, and exploration discounts from x-algorithm without porting its code. | Documentation only; Phoenix, vector search, Queue, and ad blender remain HOLD. | [PR #107](https://github.com/taejunyun1/Tasted_it/pull/107) · [`c6282f9`](https://github.com/taejunyun1/Tasted_it/commit/c6282f9) |
| 20:40 | Classification / Batch apply | Prioritizes meat/charcoal source categories as grilled meat, auto-excludes clear non-food venues, and adds 100-place preview/apply with admin restoration. | Requires `0029_auto_not_restaurant_exclusion.sql`; category and exclusion changes are audited. | [PR #110](https://github.com/taejunyun1/Tasted_it/pull/110) · [`e254970`](https://github.com/taejunyun1/Tasted_it/commit/e254970) |

## Migration, Configuration, and Provider Inventory

### D1 migrations

| File | Introduced by | Purpose | Operational note |
| --- | --- | --- | --- |
| `0029_auto_not_restaurant_exclusion.sql` | [#110](https://github.com/taejunyun1/Tasted_it/pull/110) | Automatic non-food exclusion and category-application foundation | Admin preview/apply remains a separate action |
| `0030_naver_local_category_verification.sql` | [#117](https://github.com/taejunyun1/Tasted_it/pull/117) | Minimal NAVER category evidence | Verify secrets, kill switch, and quota |
| `0031_place_category_v5_profiles.sql` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | Category v5 shadow profiles | `PLACE_CATEGORY_V5_ENABLED=false` by default |
| `0031_remove_workers_ai.sql` | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | Remove Workers AI run history | Destructive; verify backup, approval, and exact order |
| `0032_place_course_context.sql` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | Course recommendation v2 context | `COURSE_CONTEXT_V2_ENABLED=false` by default |
| `0033_naver_place_liveness.sql` | [#127](https://github.com/taejunyun1/Tasted_it/pull/127) | NAVER re-verification and recall history | Restore only the matching run timestamp |
| `0034_place_review_pipeline.sql` | [#137](https://github.com/taejunyun1/Tasted_it/pull/137) | Five-stage work items, duplicate decisions, backfill | Never edit; use a forward-fix |

Two files currently share the `0031` prefix on `main`. This document does not infer remote execution order or completion. Before operations, compare exact filenames, `wrangler d1 migrations list`, and the merged PR approval scope.

### Runtime configuration and providers

| Item | Last verified value/state | Evidence | Note |
| --- | --- | --- | --- |
| `NAVER_LOCAL_SEARCH_ENABLED` | `true` in `wrangler.jsonc` | [#121](https://github.com/taejunyun1/Tasted_it/pull/121) | Set `false` and redeploy to stop on incident |
| `NAVER_LOCAL_SEARCH_DAILY_LIMIT` | `20000` in `wrangler.jsonc` | [#131](https://github.com/taejunyun1/Tasted_it/pull/131) | API Hub total usage may differ from app-recorded usage |
| `NAVER_API_HUB_KEY_ID`, `NAVER_API_HUB_KEY` | Worker secrets required | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | Never expose values in docs, logs, or PRs |
| Workers AI binding | Removed | [#125](https://github.com/taejunyun1/Tasted_it/pull/125) | Verify remote `0031_remove_workers_ai.sql` separately |
| `PLACE_CATEGORY_V5_ENABLED` | `false` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | No public change before shadow review |
| `COURSE_CONTEXT_V2_ENABLED` | `false` | [#122](https://github.com/taejunyun1/Tasted_it/pull/122) | Off retains the previous course recommendation |

## Update Procedure

### Pull Request author

1. Record the owner, scope, and owned files in an Issue or Draft PR first.
2. Obtain the Draft PR number and add an entry under the latest date in this document.
3. Include rationale, user/operational impact, migrations, environment variables, external integrations, verification, rollback, and the PR link.
4. Keep follow-up fixes as separate rows and say what they supersede or refine.
5. For a change with no independent historical value, explain the omission in the PR template.

### Baseline reconciliation

```bash
git fetch origin
git rev-parse origin/main
git log --first-parent --date=iso-local --format='%h %ad %s' <recorded-commit>..origin/main
git diff --stat <recorded-commit>..origin/main
gh pr list --repo taejunyun1/Tasted_it --state merged --base main --limit 100
```

Advance the baseline only after confirming that no merged PR is missing. If GitHub or the remote ref cannot be verified, record `HOLD / UNVERIFIED` and do not advance it.

## How to Read This Document

- **Does the code exist?** Inspect the `origin/main` commit and file.
- **What was approved?** Read the linked merged PR and the approval SSOT.
- **Was a remote migration or deployment executed?** Inspect PR operations comments, Cloudflare/D1 evidence, or a separate operations record.
- **Is this current?** Compare the recorded SHA with current `origin/main`.
- **What if local `worklog/` differs?** `worklog/` is local reference evidence; repository history follows this index and the underlying Git/PR sources.
