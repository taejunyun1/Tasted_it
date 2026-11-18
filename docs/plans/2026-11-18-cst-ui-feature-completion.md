# CST UI/UX·기능 구현 완료 원장

사용자 목표 **“UI/UX 개선안을 적용한 기능구현 100% 달성”**을 요구사항별 코드·화면·검증 증거로 추적한다. 이 원장은 목표를 첫 수정 묶음으로 줄이지 않으며, 코드 존재·부분 테스트·배포 준비를 전체 완료로 세지 않는다.

- 추적: [#471](https://github.com/taejunyun1/Tasted_it/issues/471). 통합·완료 판단 담당은 Codex root다.
- 작성 기준: 2026-11-18, `origin/main@941a205`, UI 코드 `a4912db`(가독성 `03b624c` 포함). ADMIN 후속 비교 기준은 별도 통합 브랜치 `e23ccf4` / [PR #470](https://github.com/taejunyun1/Tasted_it/pull/470)이다.
- 요구 원본: [CST 서비스 SSOT](2026-11-13-cst-service-ssot.md), [전체 감사 §9](../audits/2026-08-07-full-product-design-technical-audit.md), [기술 검수 T01~T08](../operations/cst-acceptance.md).
- 시각 기준: [현행 디자인 가이드](../design-system/retaste-design-guide.md)와 `app/styles/design-system.css`. 구 감사의 결함·상태 요구는 대조하되 과거 흑백·폰트·모서리 수치를 최신 크림·녹색·라임/역할별 토큰 위에 되돌리지 않는다.
- 외부 조건: #397은 HOLD. 운영자 명칭·문의처·보관/삭제 기간은 사용자 답변대로 **정책 확인 필요**다. 필수 CI는 결제 제한으로 막혀 있으며 우회하지 않는다.

## 1. 상태와 완료 증거

| 상태 | 의미 |
|---|---|
| `CODE_PRESENT` | 현재 코드 경로를 확인했다. 해당 요구 전체의 동작·화면 통과는 아직 입증하지 않았다. |
| `IN_PROGRESS` | 담당자와 수정 범위가 확정되어 구현·회귀 검증 중이다. |
| `GAP` | 현재 코드에서 요구 누락 또는 반대 동작을 확인했다. |
| `VERIFY` | 코드/기존 시험은 있으나 현재 통합본의 필요한 조합·화면 증거를 더 확인해야 한다. |
| `VERIFIED_LOCAL_SCOPED` | 지정 SHA·로컬 범위에서 실제 실행 기록이 있다. 운영 완료를 뜻하지 않는다. |
| `EXTERNAL_GATE` | 실제 정책·계정·운영·외부 제공자 증거가 필요하다. 가짜 값이나 합성 결과로 닫지 않는다. |
| `SUPERSEDED_VISUAL` | 과거 시각 수치만 최신 디자인 가이드로 대체한다. 원래 기능·접근성 요구를 삭제하지 않는다. |

코드 상태와 검증 상태를 분리한다. 시험 파일 링크는 실행 결과가 아니다. `PASS`로 닫을 때는 정확한 SHA, 명령/시나리오, 환경, 결과와 화면 증거를 붙인다. 초기 실패와 수정 후 결과도 함께 남긴다. 현재 원장은 완료 백분율을 산출하지 않는다.

## 2. UI/UX 감사 §9의 전체 적용 항목

원래 감사는 §9.10~9.15 뒤에 §9.8~9.9가 배치되어 있다. 아래에서는 번호 순서로 전부 추적한다.

| ID | 요구와 현재 확인 | 상태 | 완료에 필요한 수정·증거 |
|---|---|---|---|
| UX-9.1a | 카테고리 개수와 bbox 결과, 동일 검색의 전체 개수 의미 일치. | `VERIFIED_LOCAL_SCOPED` | 같은 공개/검색/TEMP 조건으로 범위·전체 건수와 전체 경계를 분리했다. 통합 D1 3건, 125개 집계와 desktop/mobile 4건 범위 확장 확인. 대량 목록 처리 자체는 별도 #428 및 검색 접근성 범위를 따른다. |
| UX-9.1b | 범위 0건 안내와 사용자가 선택한 경우에만 광역 이동. | `VERIFIED_LOCAL_SCOPED` | 0건에서 클릭 전 bbox 불변, 전체 결과 버튼 후 동일 검색/선택/보기 유지와 결과2곳을 desktop/mobile로 확인했다. |
| UX-9.1c | 카테고리 전환 중 기존 지도와 마지막 성공 결과 보존. | `IN_PROGRESS` | 느린 요청·연속 선택·실제 전송 실패에서 이전 지도/마커와 최종 요청의 결속을 별도 단위로 검증 중이다. |
| UX-9.1d | 단일 h1·모바일 탭 타깃·카테고리 그룹 이름/선택 상태. `header-layout.spec.ts`, `MapExplorerPanel` 관련 구현이 있다. | `VERIFY` | 320/390/768/1440에서 h1 1개, 44px 조작 영역, 실제 접근성 트리의 그룹/pressed 의미 확인. |
| UX-9.2a | 내 주변의 대기/권한 거부/권역 안/권역 밖/timeout/미지원 상태. | `VERIFIED_LOCAL_SCOPED` | 위치 성공/거부/timeout/미지원/권역 밖 안내 및 URL 조건 보존 구현. 네이티브 브라우저 허용/거부4건과 모의 실패 상태 검증. Permissions-Policy는 self만 허용한다. |
| UX-9.2b | 권역 밖 기본 bbox와 읽을 수 있는 안내, 지도 조작 후 상태 정리. | `VERIFIED_LOCAL_SCOPED` | 기존 위치 정책과 사용자 조작 시 안내 정리를 유지한다. 모바일 거절 안내가 전환 버튼 아래에 표시되는 실제 좌표/화면 검증 완료. 실제 사용자 GPS 실증은 별도다. |
| UX-9.3a | 목록/지도/시트/상세의 동일 평가 출처·표본 미달·stale. `place.server.ts`의 snapshot 결합과 상세 평가 경로가 있다. | `VERIFY` | 같은 fixture의 네 화면 점수/표본·stale 대조, 무효화→재계산 후 일치. |
| UX-9.3b | 회원/리뷰어 근거·영향 상한·마지막 계산 시각을 현재 정책과 일치하게 표시. | `VERIFY` | 실제 렌더 값과 평가 서비스 응답 비교. 과거 감사의 임의 예시 숫자를 고정 정책으로 사용하지 않음. |
| UX-9.3c | 실제 장소명과 공개 적격 자료의 고유 meta/공유 정보. | `VERIFIED_LOCAL_SCOPED` | `b2d4dfe`에서 slug 대신 공개 이름/설명·canonical·OG·JSON-LD를 연결했다. compiled Worker 공개/비공개/TEMP·악성 텍스트/host·sitemap 분할 브라우저6건, 관련 단위28·D1 2건의 범위다. |
| UX-9.3d | 상세 시트 요청 식별·실패/재시도·저장 pending/결과 피드백. | `VERIFIED_LOCAL_SCOPED` | 통합 브라우저4건으로 A→B 전환 중 이전 자료 비노출, 실제 읽기 실패·수동 재시도, 저장 응답 유실 후 재조회 전 잠금,404 확인. 진짜 동시 역순 응답·403 브라우저는 미실행으로 남긴다. |
| UX-9.3e | 사진 미제공 시 공간·설명, meter 이름/대체 텍스트, 점수 변경 안내. | `VERIFY` | 사진 없음/미확인/있음과 부족/갱신 상태의 데스크톱·모바일 화면 및 접근성 확인. |
| UX-9.4a | 안전한 로그인·이메일 가입·인증 뒤 맥락 복귀. | `VERIFIED_LOCAL_SCOPED` | 가입→합성 메일함→인증→로그인→원래 상세 복귀를 desktop/mobile로 확인. 토큰 fragment와 위험 returnTo 차단 유지. 실제 외부 메일은 호출하지 않았다. |
| UX-9.4b | 가입 실패에도 이름/이메일·폼 유지, 비밀번호 재직렬화 금지. | `VERIFIED_LOCAL_SCOPED` | 허용된 이름/이메일 보존과 비밀번호 HTML 기본값 비직렬화를 집중 단위로 확인했다. signup의 성공 알림을 status로 통합했다. |
| UX-9.4c | 로그인/가입/비밀번호 제출 상태·중복 방지·오류 역할/필드 연결/초점. | `VERIFIED_LOCAL_SCOPED` | 인증 폼별 pending/오류/초점과 비밀번호 재설정429 후 재시도 폼을 desktop/mobile4건으로 확인했다. |
| UX-9.4d | 모바일 보조 링크와 버튼의 44px·오류 후 키보드 이동. | `VERIFY` | 느린 제출·서버 오류·비밀번호 재설정 429에서 폼 유지/재입력/재제출 및 실제 조작 크기. |
| UX-9.5a | 정정 메일 설정 사전 검사·메일 rate limit·안전한 오류. | `VERIFIED_LOCAL_SCOPED` | 메일 미설정/제한 시 새 정정 요청0, 제한된 재입력 필드와 private/no-store를 로컬D1로 확인했다. 실제 메일 전달은 별도다. |
| UX-9.5b | 로그인 사용자의 확인 이메일 처리, 제출 pending·성공/실패 안내·입력 보존. | `VERIFIED_LOCAL_SCOPED` | 기존 확인 이메일 절차를 유지해 기본 계정 이메일을 수정 가능하게 표시하고,429 실패 후 입력/선택·재시도 폼을 desktop/mobile로 확인했다. |
| UX-9.5c | 상세→정정 대상 고정, 큰 목록 대신 찾을 수 있는 대상 선택. 상세 진입 경로·target 검증은 있다. | `VERIFY` | 상세 대상·뒤로가기·대상 없음/잘못된 ID와 큰 목록에서 접근 가능한 선택 확인. |
| UX-9.6a | 후보 ID 직접 처리·실제 전체 집계·표시 상한. `/admin/candidates`는 폐기된 직접 승인 대신 통합 운영 경로로 이동한다. | `VERIFY` | 대체 경로 `admin/place-operations`에서 필터 밖/대량 후보·ID별 결과·총계/상한 대조. 폐기된 화면을 다시 만들지 않음. |
| UX-9.6b | 승인 실패의 항목별 이유·진행 상태·빈 결과·키보드 페이지네이션. 통합 검수 UI와 B08/B09 결과 계약이 있다. | `VERIFY` | 필터된 선택·경합·일부 실패에서 실제 적용/건너뜀 수와 사유, 비활성 페이지 링크의 키보드 동작. |
| UX-9.7a | 홈/목록/카테고리/상세의 고유 제목·설명·canonical. | `VERIFIED_LOCAL_SCOPED` | `b2d4dfe`: 설정된 origin 또는 허용된 요청 host만 사용, query 없는 canonical. 잘못된 host로 공개 URL을 만들지 않으며 상세 실패는 안전한 기본 meta다. |
| UX-9.7b | 상세 OG·요약 카드와 Restaurant JSON-LD. | `VERIFIED_LOCAL_SCOPED` | 공개 확인된 이름·주소·음식 분류만 구조화했다. 미검수 사진/좌표/평점은 생성하지 않는다. TEMP는 noindex·JSON-LD 제외. 브라우저와 escaping 단위 범위 확인. |
| UX-9.7c | robots/sitemap과 공개 적격 장소/카테고리 포함. | `VERIFIED_LOCAL_SCOPED` | sitemap index와 100개 단위 하위 문서, 공통 공개 조건·TEMP 제외, XML escaping·마지막 페이지/중복 경계를 실제 로컬 D1/브라우저에서 확인했다. |
| UX-9.8a | 최신 레이아웃/색/간격/반경 토큰. 현행 guide/CSS·design-system-contract 시험이 있다. | `CODE_PRESENT` | 수정 화면이 기존 토큰/가이드 사용, 고유 정보 위계 유지. 구 색·모서리 수치의 역적용 금지. |
| UX-9.8b | 본문 줄 간격·한글 줄바꿈·12px 라벨·44px 조작·숫자 정렬. | `VERIFIED_LOCAL_SCOPED` / `VERIFY` | `03b624c`: 실제 small-text를 확인한 뒤 기존 CSS의12px 미만 크기152개만 공통 토큰으로 바꿨다. 가독성6건(320/390/1440, 공개·회원·ADMIN), 실패 지도320/200% 확대2건, 읽기 전용19조합의 구조/오버플로 확인. 실제 외부 폰트 로드·전체 대비 측정은 별도다. |
| UX-9.8c | 오류·필드·빈 상태·pending·sheet의 일관된 접근성 계약. 기존 공통 패턴과 개별 구현이 혼재한다. | `IN_PROGRESS` | 진행 중 폼/sheet의 필수 동작을 먼저 통일하고 나머지 화면 대조. 불필요한 거대 컴포넌트 프레임워크 도입 금지. |
| UX-9.8d | 폰트 전달 비용/레이아웃 안정성. 현행 root는 외부 stylesheet를 사용한다. | `VERIFY` | 실제 font load·fallback/CLS 확인 후 필요 최소 보완. 현행 SUIT 스택을 과거 Noto-only 제안으로 바꾸지 않음. |
| UX-9.9 | 의미 없는 그라디언트·통일 pill·마케팅 블록·가짜 수치·장식 아이콘 확장 금지. | `SUPERSEDED_VISUAL` / `VERIFY` | 시각 수치는 최신 guide 우선, 내용/의미를 해치는 장식 금지 원칙 유지. 수정 화면 시각 리뷰로 확인. |
| UX-9.10a | 목록 조회와 추천 후보 조회의 목적/범위 구분. | `CODE_PRESENT` | 현재 목록 조회는 1회다. 추천은 별도 정렬·liveness/적격 조건의 최대500 후보이고 검색 목록100건과 동등하지 않다. 이전 감사의 동일 listPlaces 중복은 현 소스에서 재현되지 않아 두 조회를 합치지 않는다. U02의 조용한100건 절단은 `a4912db`에서 페이지 처리로 보완했다. 문자열 검색은 D1 LIKE 패턴 한도 오류를 피하고 %/_를 실제 문자로 취급한다. |
| UX-9.10b | 검색 pending·결과 건수 live 안내·실제 네트워크 오류 복구·필터 유지. | `VERIFIED_LOCAL_SCOPED` | 검색 pending·현재 결과 수·실제 root+list 네트워크 실패 후 검색 조건을 보존하는 오류 화면과 명시적 문서 GET 재검색을 desktop/mobile로 확인했다. |
| UX-9.10c | 모바일 다음 카드 힌트·시맨틱 목록·44px 링크. PlaceDiscoveryRail/Card와 반응형 CSS가 있다. | `VERIFY` | 320/390에서 카드 폭·다음 카드 단서·키보드 순서·화면 밖 콘텐츠 접근 확인. 현재 guide와 충돌하는 과거 폭 수치를 맹목 적용하지 않음. |
| UX-9.11a | 회원 취향 집계의 DB 반복 조회 방지. | `CODE_PRESENT` | 현재 getPlaceFlavorPrint는 공개 근거 결속 전 LEARNING/0을 반환하며 DB를 조회하지 않는다. getMemberTasteGraph는 SQL1회다. 기존 반복 JS 호출을 N+1 DB로 판정하지 않고, 추후 유효 Flavor 공개 시 batch 요구를 유지한다. |
| UX-9.11b | meter 이름/대체 텍스트·학습중·빈 상태·모바일 줄바꿈. 현재 회원 허브/학습 UI가 존재한다. | `VERIFY` | LEARNING/VISIBLE 각각의 합성 입력과 접근성 트리. 근거 없는 VISIBLE 값을 생성하지 않음. |
| UX-9.11c | 저장 해제 pending·중복 방지·성공/실패 안내. | `VERIFIED_LOCAL_SCOPED` | `3b70923`: 요청 중1회/결과 초점·목록 갱신, 전송 전 실패와 commit 뒤 응답 유실 모두 명시적 현재 목록 재조회 전 잠금. compiled Worker desktop/mobile4건·집중 단위/D1, 기존 탈퇴·소유권 경계 유지. |
| UX-9.12 | 리뷰어 신청 오류 SR/필드 연결·수집 용도·선택 복원·pending. | `VERIFIED_LOCAL_SCOPED` | 사전 필드 검증·일반 오류 비노출·입력/카테고리 보존·pending 중 Enter 재제출 차단·첫 오류 초점을 확인했다. 집중단위8건과 desktop/mobile 신청/좁은 footer4건 PASS. |
| UX-9.13a | 평가 대상의 한정 검색·모든 적격 장소 접근·만료 세션 복귀. | `VERIFIED_LOCAL_SCOPED` | `f61d26e`~`fac9a96`: 페이지20건으로43건 전체 접근, 이름/주소 검색·선택/초안/HOLD 보존. 실제 만료 세션은 로그인 뒤 평가 화면으로 복귀한다. compiled Worker6건·D1 6건·집중 단위에서 확인했다. |
| UX-9.13b | 공개 적격 이력·403/읽기 가능 상태·Golden Pick 확인·44px. 기존 ReviewerVisitFlow와 공개 적격/권리 gate가 있다. | `VERIFY` | 일반/휴면/정지/리뷰어의 진입 및 부정 요청, Golden Pick 전 확인·실패 복구·이력 cursor. |
| UX-9.14a | 관리자 skip-link/403/표 이름·빈 상태. root의 전용403과 다수 admin id=main은 구현되어 있다. | `VERIFY` | ADMIN 각 화면 및 차단 화면의 main 1개·skip-link 목적지·표 이름·빈 목록 실제 확인. |
| UX-9.14b | 관리자 입력 검증·실패 피드백·pending·영수증/실제 결과 구분. B01~B09 배포 기록, B10~B16 통합 로컬 증거가 있다. | `VERIFIED_LOCAL_SCOPED` / `EXTERNAL_GATE` | 기존 범위별 증거 유지. #470 정확한 최종 CI·병합·배포·해당 live 검증 후 운영 상태를 별도 갱신. |
| UX-9.15a | 상세 fetcher 실패/재시도 및 요청별 데이터 결속. | `VERIFIED_LOCAL_SCOPED` | `b757ae2`: A→B 전환 중 A 자료 비노출, 실제 읽기 실패의 사용자 재시도, 저장 결과불명 잠금·재조회,404를 compiled Worker4건으로 확인했다. 브라우저403과 진짜 동시 역순은 아직 별도 확인 대상이다. |
| UX-9.15b | 지도 재검증 실패에서 마지막 성공 상태·연결 안내·명시적 재시도. | `IN_PROGRESS` | map 담당: SDK 실패 재시도와 별개로 데이터 요청 실패/응답 순서 확인. 온라인 복귀 안내 수명 검증. |
| UX-9.15c | 실패 중 결과 불명의 파괴적 요청을 자동 재시도하지 않음. 서비스워커/오프라인 캐시 추가 없음. | `VERIFY` | 저장·투표 응답 유실 시 현재 상태 조회 후 재시도, 새 worker/cache 등록0. |

## 3. CST 이용자·데이터 기능 전체 연결

아래 표는 상위 SSOT의 U/D 요구를 생략 없이 연결한다. UI 수정 완료가 해당 기능의 모든 서버·데이터 조건을 자동 충족하지 않는다.

| ID | 현재 코드·기존 증거 위치 | 현재 상태와 다음 증거 |
|---|---|---|
| U01 홈 큐레이션 | `routes/home.tsx`, `home-curation.server.ts`, `tests/e2e/home-curation.spec.ts` | `CODE_PRESENT/VERIFY`: 공개 적격/지역/음식종류·빈 결과. UX-9.1·T01/T04에 연결. |
| U02 검색·목록 | `routes/place-list.tsx`, `place.server.ts`, `tests/e2e/map-category-query.spec.ts` | `IN_PROGRESS`: 검색 pending·실패 복구는 검증했으며, `a4912db`에서100건 초과 결과의 전체 개수·페이지 접근을 구현했다. 통합 회귀를 진행한다. 지역/초기화/0건/뒤로가기·T01/T07은 조합 증거를 연결한다. |
| U03 지도/목록 상태 | `routes/map-category.tsx`, `PlaceMap.tsx`, map-state·location-policy, 관련 e2e | `IN_PROGRESS`: 내 주변/실패 복구·조건 보존, UX-9.1/2/15·T01/T07. |
| U04 상세·사진·외부 정보 | `routes/place-detail.tsx`, PlaceDetailSheet, `place-correction-entry` 검증 파일 | `IN_PROGRESS/VERIFY`: 시트 오류/저장, 확인일·미확인/미제공 표시, 정정 접수·T04/T05/T07. |
| U05 반응·취소 | VoteControl, `place-detail.tsx` action, vote-event/withdraw 경로, `vote-withdraw.spec.ts` | `CODE_PRESENT/VERIFY`: 본인/타인·중복/취소·재계산과 UI 결과 일치·T02/T06. |
| U06 guest 저장·승계 | GuestSaveControl/GuestMergeRetry, guest-saves/merge 서비스, `guest-save-merge.spec.ts` | `CODE_PRESENT/IN_PROGRESS`: 이메일 복귀 누락 보완, commit 전 실패·만료·동시 재시도/누락0·T02/T03. |
| U07 리뷰어 공개 | reviewer-publication/reviewer-moderation, 공개 프로필/방문·사진 경로와 관련 통합/e2e | `CODE_PRESENT/VERIFY`: 승인 전/회수/다른 소유자·직접 사진 접근·T04/T06. 실제 권리는 `EXTERNAL_GATE`. |
| U08 코스·주차/충전 | `course-recommendation.tsx`, course/parking 서비스, course 정책/통합 검증 | `CODE_PRESENT/VERIFY`: 코스 위치 거부/시간초과/미지원 안내는 구현·로컬 검증했다. 제공/미제공·시간/거리·T08은 별도 조합 검증이다. 기존 false flag는 임의 활성화하지 않음. |
| U09 인증·권한·탈퇴 | login/signup/verify/OAuth/me, session/account 서비스·인증 통합 검증 | `IN_PROGRESS/VERIFY`: UX-9.4의 모든 링크/실패/복귀, 역할·만료·탈퇴 부정경로·T03/T04. 실제 외부 인증 전달은 별도. |
| D01 출처·반입 | admin-import/data-sync, import 서비스·`place-import.test.ts` | `CODE_PRESENT/VERIFY`: 같은 원천 재반입·시각/결과/원천키·감사, T05. 원격 수집 운영은 별도 gate. |
| D02 분류·중복·제외 | place-review pipeline, category/duplicate/exclusion 정책·통합 검증 | `CODE_PRESENT/VERIFY`: 체인·비음식점·폐업/이전·동명이점/중복 fixture·이유, T05. 실제 영업 사실은 별도. |
| D03 검수·보완 | reviewer/admin 검수와 후보/정정 UI, moderator CAS·감사·결과 | `CODE_PRESENT/VERIFY`: 승인/반려/보완/경합·권리 상태 조합, T04/T05. |
| D04 공개/회수 | place-operations/publication-recall, B09 증거·관련 통합/e2e | `CODE_PRESENT/VERIFY`: ADMIN만 확정, hidden 검색/추천/직접 조회 제외·전후/사유, T04/T05. |
| D05 평가 규칙 | rating/recompute·eligible input, 고정 기대값/무효화·재계산 검증 | `CODE_PRESENT/VERIFY`: 최소표본 경계·리뷰어 상한·외부평점 배제·재계산 동일값, T06. 새 수치 정책 생성0. |
| D06 운영·복구 | 운영 런북, 합성 D1 복원 증거, B17 migration 보존 리허설 | `VERIFIED_LOCAL_SCOPED/EXTERNAL_GATE`: 합성 보존/복원과 실제 운영 R2/삭제 후 복원을 구분. T08 실제 복구 증거·보존/RPO/RTO 정책은 미완료. |

## 4. 화면 흐름 전체 연결

| ID | 끝까지 확인할 흐름 | 연결과 남은 경계 |
|---|---|---|
| S01 | 홈→지역/분류→목록/지도→상세 | U01~03, UX-9.1/2. loading/빈 결과·명시적 범위 변경. |
| S02 | 목록↔지도→선택→뒤로가기/reload | U02/03, UX-9.10/15. query/bbox/view/선택 ID·결과 집합 일치. |
| S03 | 상세→공개 리뷰어/저장·반응/정정/외부 링크 | U04~07, UX-9.3/5. 실패 후 원래 대상·현재 상태 보존. |
| S04 | 공개 리뷰어→승인 방문·평가·사진→장소 | U07, UX-9.13. 미승인·정지·철회 자료 제외. |
| S05 | 내 취향/저장→상세·인증, guest 선택→계정 | U06, UX-9.11. 만료/실패·재시도·중복0, 저장 해제 피드백. |
| S06 | 로그인/가입/인증/재설정→원래 화면·탈퇴 | U09, UX-9.4. 빈/잘못된/만료 토큰·429·외부 returnTo·비밀번호 비노출. |
| S07 | 상세 지정 대상→제안/정정→접수→관리자 대기 | U04, D01~03, UX-9.5. 접수 즉시 공개변경0·처리 상태의 한국어 표시. |
| S08 | ADMIN 검수→사유/미리보기→확정/경합→이력 | D03~06, UX-9.6/14. 역할별 차단과 실제 결과/큐 대기를 구분, B01~B17 전체 범위 유지. |

## 5. 실행 순서와 소유권

| 순서 | 단위 | 담당/상태 |
|---|---|---|
| 1 | 리뷰어 신청·인증 폼·토큰·정정 접수·코스 위치 안내 | `7459da0`~`a2aab6e`, 로컬 검증 범위 완료 |
| 1 | 카테고리 위치/SDK 복구·bbox 집계·상세 시트 | `ee8e697`·`d15f629`·`b757ae2`·`e7e8d1c`, 로컬 검증 범위 완료 |
| 2 | 회원 저장 해제·리뷰어 전체 검색/인증 복귀·공개 meta/sitemap | `3b70923`·`fac9a96`·`b2d4dfe`, compiled Worker 범위 검증 완료 |
| 2 | 숨은 맛집 후보 1000개 D1 변수 한도 | `7aae134`, JSON 배열의 바인딩1개로 동일 후보/중앙값 유지, D1 3건 확인 |
| 3 | 공통 가독성·44px·실패 지도 레이아웃 | `03b624c`, 한정 로컬 검증 완료 |
| 3 | 공개 목록100건 초과 접근 | `a4912db`, 실제 총계·100/25 페이지·복귀·literal 검색, 통합 검증 중 |
| 3 | 지도 데이터 실패의 마지막 성공 보존 | 별도 단위, 세션/역할 변경과 응답 경합 검증 중 |
| 4 | U/D/S와 T01~T08 조합 검증·독립 리뷰·정확한 통합 CI | 전체 증거 충족 전 목표 active. CI/운영/실제 정책은 외부 gate |

각 코드 작업은 전용 branch/worktree와 소유 파일을 #471에 남긴다. 현재 병렬 수정은 문서가 아니라 최종 통합 코드에서 다시 확인한다. 코드 수정이 없는 항목은 필요한 기존 회귀를 선택해 검증하며, 광범위한 동일 시험 반복으로 진행률을 부풀리지 않는다.

## 6. 통합·운영 및 목표 종료 조건

1. 위 표의 모든 적용 요구에 대해 구현 없음/누락/반대 동작을 해소하고, 사용자 흐름·실패·접근성·모바일 증거를 연결한다. 기존 구현도 현재 통합본에서 요구 범위가 충족되는지 확인한다.
2. 미정 정책·실제 외부 전달·도메인·현장 실증은 별도 사실로 남긴다. 이를 “코드 완료”로 만들어 기능 gate를 통과시키지 않는다. 반대로 구현과 독립된 외부 gate 때문에 가능한 구현을 중단하지 않는다.
3. #470의 B10~B16 후속과 새 UI 변경을 통합할 때 메뉴·route·권한·작업종류·기존 증거를 보존한다. 현재 #470의 로컬 검증은 실제 CI 또는 배포 성공이 아니다.
4. 정확한 최종 head의 필수 CI·독립 diff 검토를 통과하기 전 병합하지 않는다. 운영 반영은 merged main과 승인된 한정 실행 계획을 따른다. 실제 Worker/RSI·사용자 경로를 확인하기 전 운영 완료로 올리지 않는다.
5. 상위 SSOT와 이 원장, 실제 실행 증거 사이에 누락·모순·미검증 항목이 없을 때만 목표 완료를 검토한다. 기능 구현 완료·운영 검증·정식 공개 준비 상태는 계속 구분한다.

운영자/문의처/보존 기간 미정, 필수 CI 결제 차단, 실제 운영 복구·외부 인증/메일 전달의 미실행은 현재 남은 사실이다. 이 원장을 작성했다는 이유로 어느 것도 해제하지 않는다.

## 7. 11/18 통합 검증 기록

- 코드 `fac9a96`까지 인증/정정/상세/회원 저장/리뷰어 검색/공개 meta의 각 집중 검증과 독립 리뷰를 완료했다. 후반 추가 단위4파일17건·D1 4파일15건, compiled Worker 회원4·meta6·리뷰어6·상세4건이 통과했다. 초기 환경 캐시 실패와 기대값 교정은 전체 목표 성공으로 합산하지 않는다.
- `03b624c`: 가독성·조작 검증6건 통과. 기존 핵심 흐름34건은 최초30 PASS/2 SKIP/2 FAIL이었다. 실패는 지도 재시도 안내와 위치 미니맵의 겹침이며, 정상 흐름 배치 및 여백 교정 후 해당2건을 재실행해 PASS했다. 두 SKIP은 데스크톱에서의 모바일 전용 시트다. 기존11/13 스크린샷을 덮지 않고 이번 guest 증거는 `cst-guest-save-20261118/`로 분리했다.
- `a4912db`: 공개 목록 페이지 처리와 검색 literal 비교. 세부 범위/초기 실패/공식 함수 근거는 [페이지 처리 증거](../evidence/2026-11-18-public-place-pagination.md)를 따른다.
- 이 기록은 로컬 합성 Worker/D1과 브라우저 증거다. 실제 운영 배포·외부 메일/OAuth·권리 확인·전체 T01~T08 또는 현장 실증 성공이 아니다. 남은 코드 수정/통합과 필수 CI 후에만 새 운영 버전을 검증한다.
