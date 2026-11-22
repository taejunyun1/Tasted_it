# CST UI/UX·기능 구현 완료 원장

사용자 목표 **“UI/UX 개선안을 적용한 기능구현 100% 달성”**을 요구사항별 코드·화면·검증 증거로 추적한다. 이 원장은 목표를 첫 수정 묶음으로 줄이지 않으며, 코드 존재·부분 테스트·배포 준비를 전체 완료로 세지 않는다.

- 추적: [#471](https://github.com/taejunyun1/Tasted_it/issues/471). 통합·완료 판단 담당은 Codex root다.
- 초기 작성 기준은 2026-11-18의 `origin/main@941a205`와 UI 코드 `a5ce06a`([PR #472](https://github.com/taejunyun1/Tasted_it/pull/472))다. #472의 UI와 ADMIN 후속을 통합한 [PR #470](https://github.com/taejunyun1/Tasted_it/pull/470)은 2026-11-22에 필수 CI 네 항목을 통과해 `d319b51`로 병합했다. [통합 CI](https://github.com/taejunyun1/Tasted_it/actions/runs/44918253562)
- 요구 원본: [CST 서비스 SSOT](2026-11-13-cst-service-ssot.md), [전체 감사 §9](../audits/2026-08-07-full-product-design-technical-audit.md), [기술 검수 T01~T08](../operations/cst-acceptance.md).
- 시각 기준: [현행 디자인 가이드](../design-system/retaste-design-guide.md)와 `app/styles/design-system.css`. 구 감사의 결함·상태 요구는 대조하되 과거 흑백·폰트·모서리 수치를 최신 크림·녹색·라임/역할별 토큰 위에 되돌리지 않는다.
- 외부 조건은 B17 운영 전환과 #397 HOLD, 운영자 명칭·문의처·보관/삭제 기간의 **정책 확인 필요**다. 필수 CI는 복구됐다. #470의 UI 통합본은 운영 배포 증거를 별도로 확인해야 한다.

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
| UX-9.1c | 카테고리 전환·지연 응답·읽기 실패에서 기존 지도와 마지막 성공 결과 보존. | `VERIFIED_LOCAL_SCOPED` | `6afcdc3`/`a901b5a`: 이전 응답이 새 검색을 덮지 않으며 실패는 명시적으로 재시도한다. root의 같은 지도 경로 GET query 변경만 재검증을 줄이고, POST/수동 재검증/경로 변경은 보존했다. |
| UX-9.1d | 단일 h1·모바일 탭 타깃·카테고리 그룹 이름/선택 상태. | `VERIFIED_LOCAL_SCOPED` | `8248172`: 390/768의 실제 그룹 이름·열림/선택 분리·44px 제어·Tab 이동, 320/390/768/1440의 h1/가로 넘침·메뉴 조작을 확인했다. [최종 접근성 증거](../evidence/2026-11-18-explorer-accessibility.json). |
| UX-9.2a | 내 주변의 대기/권한 거부/권역 안/권역 밖/timeout/미지원 상태. | `VERIFIED_LOCAL_SCOPED` | 위치 성공/거부/timeout/미지원/권역 밖 안내 및 URL 조건 보존 구현. 네이티브 브라우저 허용/거부4건과 모의 실패 상태 검증. Permissions-Policy는 self만 허용한다. |
| UX-9.2b | 권역 밖 기본 bbox와 읽을 수 있는 안내, 지도 조작 후 상태 정리. | `VERIFIED_LOCAL_SCOPED` | 기존 위치 정책과 사용자 조작 시 안내 정리를 유지한다. 모바일 거절 안내가 전환 버튼 아래에 표시되는 실제 좌표/화면 검증 완료. 실제 사용자 GPS 실증은 별도다. |
| UX-9.3a | 목록/지도/시트/상세의 동일 평가 출처·표본 미달·stale. | `VERIFIED_LOCAL_SCOPED` | `e9634b6`: 공개 적격 표본 수를 batch로 통일하고 stale 점수는 노출하지 않는다. fresh/stale/missing3상태×4뷰를 desktop/320px에서 확인했다. 기존 재계산4건·추가 D1 4건 통과. |
| UX-9.3b | 평가 근거·조건부 리뷰어 상한·실제 계산 시각. | `VERIFIED_LOCAL_SCOPED` | 유효 결과의 실제 시각은 공개 결과 계산, stale-only의 기존 시각은 이전 계산으로 구분한다. 근거 없음은 미계산. 일반 반응이 있을 때의30% 상한 설명을 현행 정책에 맞췄다. |
| UX-9.3c | 실제 장소명과 공개 적격 자료의 고유 meta/공유 정보. | `VERIFIED_LOCAL_SCOPED` | `b2d4dfe`에서 slug 대신 공개 이름/설명·canonical·OG·JSON-LD를 연결했다. compiled Worker 공개/비공개/TEMP·악성 텍스트/host·sitemap 분할 브라우저6건, 관련 단위28·D1 2건의 범위다. |
| UX-9.3d | 상세 시트 요청 식별·실패/재시도·저장 pending/결과 피드백. | `VERIFIED_LOCAL_SCOPED` | 통합 브라우저4건으로 A→B 전환 중 이전 자료 비노출, 실제 읽기 실패·수동 재시도, 저장 응답 유실 후 재조회 전 잠금,404 확인. 실제 A 응답 보류→B 표시→늦은 A 해제도 추가 검증했다. 403 구분은 client 단위 증거이며 실제 공개 적격성 거절은404 경계로 확인한다. |
| UX-9.3e | 사진 없음 설명/높이와 이름 있는 평가 지표. | `VERIFIED_LOCAL_SCOPED` | `e9634b6`/`a5ce06a`: 미제공 설명·Flavor meter 이름/대체값, 모바일 no-photo220px, 점수/메타 줄바꿈·정렬을 실제 화면/경계 값으로 확인했다. |
| UX-9.4a | 안전한 로그인·이메일 가입·인증 뒤 맥락 복귀. | `VERIFIED_LOCAL_SCOPED` | 가입→합성 메일함→인증→로그인→원래 상세 복귀를 desktop/mobile로 확인. 토큰 fragment와 위험 returnTo 차단 유지. 실제 외부 메일은 호출하지 않았다. |
| UX-9.4b | 가입 실패에도 이름/이메일·폼 유지, 비밀번호 재직렬화 금지. | `VERIFIED_LOCAL_SCOPED` | 허용된 이름/이메일 보존과 비밀번호 HTML 기본값 비직렬화를 집중 단위로 확인했다. signup의 성공 알림을 status로 통합했다. |
| UX-9.4c | 로그인/가입/비밀번호 제출 상태·중복 방지·오류 역할/필드 연결/초점. | `VERIFIED_LOCAL_SCOPED` | 인증 폼별 pending/오류/초점과 비밀번호 재설정429 후 재시도 폼을 desktop/mobile4건으로 확인했다. Google·NAVER 로그인 실패 후 검증된 목적지와 재시도 링크를 유지한다. [OAuth 복구 검증](../evidence/cst-oauth-recovery-20261122/summary.json) |
| UX-9.4d | 모바일 보조 링크와 버튼의 44px·오류 후 키보드 이동. | `VERIFIED_LOCAL_SCOPED` | 기존 인증 오류/초점 회귀와 compiled 읽기 점검을 연결한다. 390px 로그인 주요 버튼49.59px·OAuth48px·입력51.59px, 보조 링크44px이며 느린 제출/429 폼 유지·재제출은9.4c 범위다. |
| UX-9.5a | 정정 메일 설정 사전 검사·메일 rate limit·안전한 오류. | `VERIFIED_LOCAL_SCOPED` | 메일 미설정/제한 시 새 정정 요청0, 제한된 재입력 필드와 private/no-store를 로컬D1로 확인했다. 실제 메일 전달은 별도다. |
| UX-9.5b | 로그인 사용자의 확인 이메일 처리, 제출 pending·성공/실패 안내·입력 보존. | `VERIFIED_LOCAL_SCOPED` | 기존 확인 이메일 절차를 유지해 기본 계정 이메일을 수정 가능하게 표시하고,429 실패 후 입력/선택·재시도 폼을 desktop/mobile로 확인했다. |
| UX-9.5c | 상세→정정 대상 고정, 큰 목록 대신 찾을 수 있는 대상 선택. | `VERIFIED_LOCAL_SCOPED` | `d4b7b17`:20개 키셋 검색/페이지와1,005번째 직접 대상, 전송 지연/실패 중 선택·초안·복귀 링크 보존, 같은 경로 대상 이동, 합성 IME 이벤트, 회수 후 서버 거절/명시적 재선택을 compiled desktop/mobile6건·D1 14건으로 확인했다. [정정 검색 증거](../evidence/correction-search-20261118/summary.json). 실제 메일→관리자 S07 전체는 별도다. |
| UX-9.6a | 후보 ID 직접 처리·실제 전체 집계·표시 상한. | `VERIFIED_LOCAL_SCOPED` | 활성 검수는 선택 ID 직접 조회와 SQL count를 사용한다. `4267bce`의 회원 제안도25개/정확한 총계로201번째 항목까지 접근 가능하며 양방향 페이지를 보존했다. |
| UX-9.6b | 항목별 실패 이유·진행 상태·빈 결과·키보드 페이지. | `VERIFIED_LOCAL_SCOPED` | `4267bce`: 완전/일부 건너뜀·NAVER 순차 확인 결과의 ID/한국어 이유, 비활성 페이지의 Tab/Enter 제외, 두 큐의 독립 페이지 보존을 합동 브라우저/D1에서 확인했다. |
| UX-9.7a | 홈/목록/카테고리/상세의 고유 제목·설명·canonical. | `VERIFIED_LOCAL_SCOPED` | `b2d4dfe`: 설정된 origin 또는 허용된 요청 host만 사용, query 없는 canonical. 잘못된 host로 공개 URL을 만들지 않으며 상세 실패는 안전한 기본 meta다. |
| UX-9.7b | 상세 OG·요약 카드와 Restaurant JSON-LD. | `VERIFIED_LOCAL_SCOPED` | 공개 확인된 이름·주소·음식 분류만 구조화했다. 미검수 사진/좌표/평점은 생성하지 않는다. TEMP는 noindex·JSON-LD 제외. 브라우저와 escaping 단위 범위 확인. |
| UX-9.7c | robots/sitemap과 공개 적격 장소/카테고리 포함. | `VERIFIED_LOCAL_SCOPED` | sitemap index와 100개 단위 하위 문서, 공통 공개 조건·TEMP 제외, XML escaping·마지막 페이지/중복 경계를 실제 로컬 D1/브라우저에서 확인했다. |
| UX-9.8a | 최신 레이아웃/색/간격/반경 토큰. 현행 guide/CSS·design-system-contract 시험이 있다. | `CODE_PRESENT` | 수정 화면이 기존 토큰/가이드 사용, 고유 정보 위계 유지. 구 색·모서리 수치의 역적용 금지. |
| UX-9.8b | 본문 줄 간격·한글 줄바꿈·12px 라벨·44px 조작·숫자 정렬. | `VERIFIED_LOCAL_SCOPED` / `VERIFY` | `03b624c`: 실제 small-text를 확인한 뒤 기존 CSS의12px 미만 크기152개만 공통 토큰으로 바꿨다. 가독성8건(320/390/768/1440, 공개·회원·ADMIN), 실패 지도320/200% 확대2건, 읽기 전용19조합의 구조/오버플로 확인. 기존 대비 미달6쌍과 상세2쌍은5.40–6.63:1로 보완·재확인했다. 이미지/그라데이션 등 전체 대비는 별도 범위다. |
| UX-9.8c | 오류·필드·빈 상태·pending·sheet의 일관된 접근성 계약. | `VERIFIED_LOCAL_SCOPED` / `VERIFY` | `df80fed`의 Golden·코스 조회 오류, guest·탈퇴 결과불명, S07 정정 처리 상태를 compiled24건으로 검증했다. 전체 화면/모든 조합을 일괄 인증한 것은 아니다. [통합 증거](../evidence/recovery-integrated-20261118/summary.json). |
| UX-9.8d | 외부 폰트의 실제 전달·fallback·레이아웃 안정성. | `VERIFIED_LOCAL_SCOPED` | `a901b5a`의 익명 QA 홈 320/1440 최초·캐시4회에서 CSS2/폰트6 HTTP200, 재방문8개 캐시, SUIT/Mono 실제 사용·관측CLS0. 숨은 모바일 카드·실사용자 필드 성능은 검증 범위 밖이다. [폰트 증거](../evidence/2026-11-18-font-delivery.json). |
| UX-9.9 | 의미 없는 그라디언트·통일 pill·마케팅 블록·가짜 수치·장식 아이콘 확장 금지. | `SUPERSEDED_VISUAL` / `VERIFY` | 시각 수치는 최신 guide 우선, 내용/의미를 해치는 장식 금지 원칙 유지. 수정 화면 시각 리뷰로 확인. |
| UX-9.10a | 목록 조회와 추천 후보 조회의 목적/범위 구분. | `CODE_PRESENT` | 현재 목록 조회는 1회다. 추천은 별도 정렬·liveness/적격 조건의 최대500 후보이고 검색 목록100건과 동등하지 않다. 이전 감사의 동일 listPlaces 중복은 현 소스에서 재현되지 않아 두 조회를 합치지 않는다. U02의 조용한100건 절단은 `a4912db`에서 페이지 처리로 보완했다. 문자열 검색은 D1 LIKE 패턴 한도 오류를 피하고 %/_를 실제 문자로 취급한다. |
| UX-9.10b | 검색 pending·결과 건수 live 안내·실제 네트워크 오류 복구·필터 유지. | `VERIFIED_LOCAL_SCOPED` | 검색 pending·현재 결과 수·실제 root+list 네트워크 실패 후 검색 조건을 보존하는 오류 화면과 명시적 문서 GET 재검색을 desktop/mobile로 확인했다. |
| UX-9.10c | 모바일 카드 탐색·의미 있는 목록·44px 링크. | `VERIFIED_LOCAL_SCOPED` / `SUPERSEDED_VISUAL` | `8248172`에서 이름 있는 list/listitem과 다음 카드 Tab/뷰포트 진입을390/768px에서 확인했다. 현행 guide는 단일 열도 허용하므로 과거74vw 제안은 대체한다. Golden 가로 레일 키보드의 별도 상태는 이 결과에 포함하지 않는다. |
| UX-9.11a | 회원 취향 집계의 DB 반복 조회 방지. | `CODE_PRESENT` | 현재 getPlaceFlavorPrint는 공개 근거 결속 전 LEARNING/0을 반환하며 DB를 조회하지 않는다. getMemberTasteGraph는 SQL1회다. 기존 반복 JS 호출을 N+1 DB로 판정하지 않고, 추후 유효 Flavor 공개 시 batch 요구를 유지한다. |
| UX-9.11b | meter 이름/대체 텍스트·학습중·빈 상태·모바일 줄바꿈. | `VERIFIED_LOCAL_SCOPED` | `25155ad`의 기존 합성 회원을 읽기 전용으로 확인했다. 320/390/768px에서 배지0개·이름 있는 progress0/5·설명/탐색 링크·빈 저장/평가 화면과 넘침0을 확인했다. [학습 화면 증거](../evidence/2026-11-18-learning-ui.json). VISIBLE 그래프는 현재 서버가 항상LEARNING을 반환하는 미도달 상태이며 가짜 값으로 활성화하지 않는다. |
| UX-9.11c | 저장 해제 pending·중복 방지·성공/실패 안내. | `VERIFIED_LOCAL_SCOPED` | `3b70923`: 요청 중1회/결과 초점·목록 갱신, 전송 전 실패와 commit 뒤 응답 유실 모두 명시적 현재 목록 재조회 전 잠금. compiled Worker desktop/mobile4건·집중 단위/D1, 기존 탈퇴·소유권 경계 유지. |
| UX-9.12 | 리뷰어 신청 오류 SR/필드 연결·수집 용도·선택 복원·pending. | `VERIFIED_LOCAL_SCOPED` | 사전 필드 검증·일반 오류 비노출·입력/카테고리 보존·pending 중 Enter 재제출 차단·첫 오류 초점을 확인했다. 집중단위8건과 desktop/mobile 신청/좁은 footer4건 PASS. |
| UX-9.13a | 평가 대상의 한정 검색·모든 적격 장소 접근·만료 세션 복귀. | `VERIFIED_LOCAL_SCOPED` | `f61d26e`~`fac9a96`: 페이지20건으로43건 전체 접근, 이름/주소 검색·선택/초안/HOLD 보존. 실제 만료 세션은 로그인 뒤 평가 화면으로 복귀한다. compiled Worker6건·D1 6건·집중 단위에서 확인했다. |
| UX-9.13b | 공개 적격 이력·권한·Golden Pick 최종 확인·조작 영역. | `VERIFIED_LOCAL_SCOPED` / `EXTERNAL_GATE` | `ad15c2c`: STEP05 요청/비요청·사유와 실제 multipart 일치를 desktop/mobile4건 검증했다. 관리자 승인 전 공개0을 유지한다. 실제 자료의 권리는 별도 사실이다. |
| UX-9.14a | 관리자 skip-link/403/표 이름·빈 상태. | `VERIFIED_LOCAL_SCOPED` / `VERIFY` | `4267bce` ADMIN 결과 회귀와 읽기 점검에서 skip-link 후 실제 본문 Tab 이동, h1/main 각1개, 표 caption/열 이름과 동기화403 구분을 확인했다. 읽기 점검 표는13행이므로0행 화면은 재실행하지 않았으며 모든 ADMIN 경로의 전체 상태 검증으로 확대하지 않는다. |
| UX-9.14b | 관리자 입력 검증·실패 피드백·pending·영수증/실제 결과 구분. B01~B09 배포 기록, B10~B16 통합 로컬 증거가 있다. | `VERIFIED_LOCAL_SCOPED` / `EXTERNAL_GATE` | 기존 범위별 증거 유지. #470 정확한 최종 CI·병합·배포·해당 live 검증 후 운영 상태를 별도 갱신. |
| UX-9.15a | 상세 fetcher 실패/재시도 및 요청별 데이터 결속. | `VERIFIED_LOCAL_SCOPED` | `b757ae2`: A→B 전환 중 A 자료 비노출, 실제 읽기 실패의 사용자 재시도, 저장 결과불명 잠금·재조회,404를 compiled Worker4건으로 확인했다. 실제 늦은 A 응답은 B 선택을 덮지 않는다. 403 구분은 client 단위 증거이며 실제 공개 거절은404로 확인한다. |
| UX-9.15b | 지도 데이터 재검증 실패에서 마지막 결과·연결 안내·명시적 재시도. | `VERIFIED_LOCAL_SCOPED` | `6afcdc3`/`a901b5a`: 홈/추천/카테고리 실제 전송 실패, 지연 응답, 세션/로그아웃/역할 변화 후 이전 개인화 폐기·Back 재노출 차단. AX 제목/본문과 읽기 링크는 유지하고 입력/버튼만 잠근다. 통합 브라우저24건에는 목록 페이지/실제 메뉴 클릭도 포함한다. |
| UX-9.15c | 실패 중 결과 불명의 파괴적 요청을 자동 재시도하지 않음. 서비스워커/오프라인 캐시 추가 없음. | `VERIFIED_LOCAL_SCOPED` / `VERIFY` | guest 저장과 회원 탈퇴의 전송 전/commit후 유실·재조회 실패에서 추가 쓰기0, 명시적현재조회 후 복구를 `df80fed`에서 확인했다. 기존 회원저장/시트 증거에 더해 투표·취소의 전송 전/commit 후 유실과409 경합도 현재 조회 전 잠금·자동 재전송0으로 확인했다. 새worker/cache0. |

## 3. CST 이용자·데이터 기능 전체 연결

아래 표는 상위 SSOT의 U/D 요구를 생략 없이 연결한다. UI 수정 완료가 해당 기능의 모든 서버·데이터 조건을 자동 충족하지 않는다.

| ID | 현재 코드·기존 증거 위치 | 현재 상태와 다음 증거 |
|---|---|---|
| U01 홈 큐레이션 | `routes/home.tsx`, `home-curation.server.ts`, `tests/e2e/home-public-acceptance.spec.ts` | `VERIFIED_LOCAL_SCOPED`: 기존 Golden 실패 복구에 더해 공개 적격 후보와 홈 카드의 ID 일치, 전체 지도 전환 뒤 실제 음식 분류·0건 및 빈 지역을 로컬 D1→브라우저로 확인했다. 회수 상태는 HIDDEN fixture이며 실제 회수 조작은 U07/D04 증거를 따른다. |
| U02 검색·목록 | `routes/place-list.tsx`, `place.server.ts`, `tests/e2e/map-category-query.spec.ts` | `VERIFIED_LOCAL_SCOPED`: `4267bce` 통합에서100건 초과 페이지·실제 총계·0건 복구·metadata 경계를 확인했다. 지역/초기화/0건/뒤로가기·T01/T07은 조합 증거를 연결한다. |
| U03 지도/목록 상태 | `routes/map-category.tsx`, `PlaceMap.tsx`, map-state·location-policy, 관련 e2e | `VERIFIED_LOCAL_SCOPED`: `4267bce` 지도 읽기 실패·조건 보존·세션 경계와 `8248172` 그룹/선택 의미를 확인했다. UX-9.1/2/15·T01/T07의 하위 범위다. |
| U04 상세·사진·외부 정보 | `routes/place-detail.tsx`, PlaceDetailSheet/PlaceInformation, public-information 및 관련 검증 | `VERIFIED_LOCAL_SCOPED`: 장소 정보 확인일·기록된 영업시간·미제공/미확인 상태를 상세와 시트에 동일하게 표시한다. 일반 장소의 일괄 검수 완료 배지를 제거했다. 실제 A 지연→B 표시→A 늦은 응답에서도 B를 유지하며, S07 접수/검토는 별도 연결한다. 영업시간 기록은 현재 영업 증명이 아니다. |
| U05 반응·취소 | VoteControl, vote service, `vote-outcomes`·`vote-withdraw` 검증 | `VERIFIED_LOCAL_SCOPED`: 같은 값 재제출은 이력을 늘리지 않고 이유만 변경하면 포인터·집계를 보존한다. 무효화 이후 재입력·경합409, 제출 잠금·진행/완료 안내, 전송 전/commit 후 응답 유실 뒤 명시적 현재 조회를 확인했다. 산식의 전체 조건은 D05를 따른다. |
| U06 guest 저장·승계 | GuestSaveControl/GuestMergeRetry, guest-saves/merge 서비스 및 관련 검증 | `VERIFIED_LOCAL_SCOPED/EXTERNAL_GATE`: 기존 결과 불명 복구에 더해 만료 전/정확 만료/만료 후, 다른 두 계정 동시 승계, 늦은 실패의 원본/목적지 rollback·재시도, 인증 세션의 목적지 제한을 합성 D1으로 확인했다. 기존 이메일 복귀·승계 UI 증거를 유지하며 실제 외부 인증 전달은 별도다. |
| U07 리뷰어 공개 | reviewer-publication/moderation, 공개 프로필/방문·사진 경로 및 관련 검증 | `VERIFIED_LOCAL_SCOPED/EXTERNAL_GATE`: 승인 전·반려·회수·수정 상태와 본인/타인의 공개/preview, 프로필→상세 사진을 확인했다. 실제 자료의 권리와 운영 적용은 별도다. [공개 경계 증거](../evidence/cst-publication-completion-20261118/summary.json). |
| U08 코스·주차/충전 | `course-recommendation.tsx`, course/parking 서비스, course 정책/통합 검증 | `VERIFIED_LOCAL_SCOPED/VERIFY`: 기존 [U08 증거](../evidence/2026-11-18-course-parking-acceptance.json)에 더해 `df80fed`의 [통합 증거](../evidence/recovery-integrated-20261118/summary.json)에서 주차 제공/미제공, 거리·요금 우선순위, EV 후보 없음/복구, 조회 실패 후 조건 보존을 실제 로컬 D1→화면 10건으로 확인했다. 조회 실패는 브라우저 HTTP 503 주입이며 실제 공급자 장애가 아니다. 로컬 시험에만 기존 flag를 켰고 운영 flag·실제 공급자·전체 T08은 미검증이다. |
| U09 인증·권한·탈퇴 | login/signup/verify/OAuth/me, session/account 서비스·인증 통합 검증 | `VERIFIED_LOCAL_SCOPED/VERIFY`: UX-9.4의 링크/실패/복귀와 `b2228c1` 탈퇴 중복 방지·결과불명·명시적 인증 확인·성공 탈퇴 후 접근 거절을 연결했다. 통합탈퇴4건은 합성 계정이며 실제 외부 인증 전달/전체T03/T04는 별도. |
| D01 출처·반입 | admin-import/data-sync, import·candidate-sync 검증 | `VERIFIED_LOCAL_SCOPED`: 서로 다른 완료 run으로 동일 원천을 재수집해 source ID·firstSeen·기존 검수 건수·장소를 보존하고 lastSeen·원천 변경 자료·수집 결과를 갱신함을 확인했다. CSV 반입의 재전송 영수증·감사 및 공개 자료 덮어쓰기 차단은 기존 집중 검증을 따른다. 실제 외부 수집 실행은 별도다. |
| D02 분류·중복·제외 | place-review pipeline, 분류/제외/중복 및 재검증 서비스 | `VERIFIED_LOCAL_SCOPED`: 기존 체인·비음식점 분류에 더해 DISTINCT/LINK_EXISTING/MERGE 결정·사유·감사·stale 거절과 MOVED의 주소 보존·공개/추천 제외를 확인했다. 중복 결정 기록은 실제 장소 병합·공개가 아니며 B09 별도 확정 절차를 따른다. 실제 영업 사실은 별도다. |
| D03 검수·보완 | reviewer/admin 검수와 후보/정정 UI, moderator CAS·감사·결과 | `VERIFIED_LOCAL_SCOPED/VERIFY`: `4267bce`의 항목별 결과·제안201번째 접근·독립 페이지 상태는 확인했다. 승인/반려/보완/경합·권리 전체 조합은 T04/T05 범위로 남긴다. |
| D04 공개/회수 | place-operations/publication-recall, B09 및 public-consumer 검증 | `VERIFIED_LOCAL_SCOPED`: 관리자 미리보기에는 변화가 없고 확정 뒤 상세404·검색/추천 후보/공개 방문 제외·직접 사진404가 함께 적용됨을 D1과 리소스 로더로 확인했다. 원본·본인 preview는 보존하며 B09의 실제 브라우저 회수/영수증 증거와 연결한다. |
| D05 평가 규칙 | rating/recompute·eligible input, rating-v2·reviewer-similarity/trust·NAVER adapter 검증 | `VERIFIED_LOCAL_SCOPED`: 7/8/9 및 하위집단 최소표본, 일반 반응이 있을 때의 리뷰어30% 상한과 일반0 예외, 신뢰·감쇠의 독립 기대값, 같은 입력의 id/hash/단일 snapshot, 외부 별점 필드 배제를 기존 집중 시험으로 재확인했다. 새 수치 정책 생성0이며 실제 운영 재계산/수용은 별도다. |
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
| S07 | 상세 지정 대상→제안/정정→접수→관리자 대기 | `VERIFIED_LOCAL_SCOPED`: 정보 정정은 폼·모의 메일·토큰 확인·검토·적용을 확인했다. 폐업 신고는 검증 후 같은 장소의 B09 회수 미리보기와 재인증, 확정 영수증에 이어진다. 함께 기록된 장소 변경 이력과 감사, 비공개 상세 404까지 대조했다. 실제 외부 메일과 운영 수용은 남아 있다. [폐업 신고 검증](../evidence/cst-correction-recall-20261122/summary.json) |
| S08 | ADMIN 검수→사유/미리보기→확정/경합→이력 | D03~06, UX-9.6/14. 역할별 차단과 실제 결과/큐 대기를 구분, B01~B17 전체 범위 유지. |

## 5. 실행 순서와 소유권

| 순서 | 단위 | 담당/상태 |
|---|---|---|
| 1 | 리뷰어 신청·인증 폼·토큰·정정 접수·코스 위치 안내 | `7459da0`~`a2aab6e`, 로컬 검증 범위 완료 |
| 1 | 카테고리 위치/SDK 복구·bbox 집계·상세 시트 | `ee8e697`·`d15f629`·`b757ae2`·`e7e8d1c`, 로컬 검증 범위 완료 |
| 2 | 회원 저장 해제·리뷰어 전체 검색/인증 복귀·공개 meta/sitemap | `3b70923`·`fac9a96`·`b2d4dfe`, compiled Worker 범위 검증 완료 |
| 2 | 숨은 맛집 후보 1000개 D1 변수 한도 | `7aae134`, JSON 배열의 바인딩1개로 동일 후보/중앙값 유지, D1 3건 확인 |
| 3 | 공통 가독성·44px·실패 지도 레이아웃 | `03b624c`, 한정 로컬 검증 완료 |
| 3 | 공개 목록100건 초과 접근 | `a4912db`/`4267bce`, 실제 총계·100/25 페이지·복귀·literal 검색의 통합 범위 검증 완료 |
| 3 | 지도 데이터 실패의 마지막 성공 보존 | `6afcdc3`/`a901b5a`/`4267bce`, 세션/역할 변경·응답 경합·실제 메뉴 클릭의 통합 범위 검증 완료 |
| 3 | 정정 대상 검색·대량 목록 | `24ef03e`→`d4b7b17`, 통합 compiled6건과 집중 검증 완료 |
| 4 | U/D/S와 T01~T08 조합 검증·독립 리뷰·정확한 통합 CI | 전체 증거 충족 전 목표 active. CI/운영/실제 정책은 외부 gate |

각 코드 작업은 전용 branch/worktree와 소유 파일을 #471에 남긴다. 현재 병렬 수정은 문서가 아니라 최종 통합 코드에서 다시 확인한다. 코드 수정이 없는 항목은 필요한 기존 회귀를 선택해 검증하며, 광범위한 동일 시험 반복으로 진행률을 부풀리지 않는다.

## 6. 통합·운영 및 목표 종료 조건

1. 위 표의 모든 적용 요구에 대해 구현 없음/누락/반대 동작을 해소하고, 사용자 흐름·실패·접근성·모바일 증거를 연결한다. 기존 구현도 현재 통합본에서 요구 범위가 충족되는지 확인한다.
2. 미정 정책·실제 외부 전달·도메인·현장 실증은 별도 사실로 남긴다. 이를 “코드 완료”로 만들어 기능 gate를 통과시키지 않는다. 반대로 구현과 독립된 외부 gate 때문에 가능한 구현을 중단하지 않는다.
3. #470의 B10~B16 후속과 새 UI 변경을 통합할 때 메뉴·route·권한·작업종류·기존 증거를 보존한다. #470 병합과 필수 CI 결과는 위 작성 기준에 기록했다. 운영 적용은 Worker 버전과 사용자 경로로 확인한다.
4. 정확한 최종 head의 필수 CI·독립 diff 검토를 통과하기 전 병합하지 않는다. 운영 반영은 merged main과 승인된 한정 실행 계획을 따른다. 실제 Worker/RSI·사용자 경로를 확인하기 전 운영 완료로 올리지 않는다.
5. 상위 SSOT와 이 원장, 실제 실행 증거 사이에 누락·모순·미검증 항목이 없을 때만 목표 완료를 검토한다. 기능 구현 완료·운영 검증·정식 공개 준비 상태는 계속 구분한다.

운영자·문의처·보존 기간과 실제 운영 복구·외부 인증 및 메일 전달의 수용 확인이 남아 있다.

## 7. 11/18 통합 검증 기록

- 코드 `fac9a96`까지 인증/정정/상세/회원 저장/리뷰어 검색/공개 meta의 각 집중 검증과 독립 리뷰를 완료했다. 후반 추가 단위4파일17건·D1 4파일15건, compiled Worker 회원4·meta6·리뷰어6·상세4건이 통과했다. 초기 환경 캐시 실패와 기대값 교정은 전체 목표 성공으로 합산하지 않는다.
- `03b624c`: 가독성·조작 검증6건 통과. 기존 핵심 흐름34건은 최초30 PASS/2 SKIP/2 FAIL이었다. 실패는 지도 재시도 안내와 위치 미니맵의 겹침이며, 정상 흐름 배치 및 여백 교정 후 해당2건을 재실행해 PASS했다. 두 SKIP은 데스크톱에서의 모바일 전용 시트다. 기존11/13 스크린샷을 덮지 않고 이번 guest 증거는 `cst-guest-save-20261118/`로 분리했다.
- `a4912db`: 공개 목록 페이지 처리와 검색 literal 비교. 세부 범위/초기 실패/공식 함수 근거는 [페이지 처리 증거](../evidence/2026-11-18-public-place-pagination.md)를 따른다.
- 이 기록은 로컬 합성 Worker/D1과 브라우저 증거다. 실제 운영 배포·외부 메일/OAuth·권리 확인·전체 T01~T08 또는 현장 실증 성공이 아니다. 남은 코드 수정/통합과 필수 CI 후에만 새 운영 버전을 검증한다.

### 지도 통합 후 추가 검증

`a901b5a`에서 `map-read-recovery`·`public-place-pagination`·`header-overlay` desktop/mobile24건을 실행해 전부 PASS했다. 동시 root 전송 실패로 화면이 사라지는 원래 결함, viewer 변경 후 Back으로 개인화가 되살아나는 결함, 모바일 메뉴를 가리는 시트, 마지막 결과의 과도한 inert를 각각 수정했다. 원래 오류 재현과 수정 전/후 검증은 해당 시험과 커밋에 남는다. 모바일 로그아웃은 form 강제 제출을 제거하고 실제 클릭으로 재검증했다.

남은 구현은 평가 표본수/시각/조건부 문구·사진/지표 접근성, Golden Pick 최종 확인, ADMIN 항목별 결과/페이지/표/403 구분이다. 이전 감사의 중복 조회·N+1 등 현재 재현되지 않는 가설을 수정 목적으로 되살리지 않는다. #470 합류·최종 필수 CI·운영 적용은 여전히 별도다.

### 평점·최종 확인·가독성 합류

`e9634b6`·`ad15c2c`·`a5ce06a`를 통합했다. 집중 단위13건, D1 추가4건+기존 재계산4건, 평점/Golden Pick 브라우저6건, 화면8건과 모바일 시트 재확인1건이 통과했다. 페이지별 title/canonical과 필터/noindex, 범위 밖/반복 badge 경계는 추가 단위5건으로 확인했다. 기존 공개 metadata/페이지 브라우저10건은 마지막 경계2건 보완 전 실행이므로 최종 통합에서 해당 경계만 재확인한다.

[대비 검증](../evidence/2026-11-18-contrast.json)은 계산 가능한 단색 배경의 확인된 실패만 보완한 증거다. 전 페이지·모든 상태의 WCAG 인증으로 확대하지 않는다. ADMIN 후속 5개 표현/탐색 누락은 `0644633`에서 별도 검증했으며 #470에 합류 후 실제 통합 화면을 확인해야 한다.

## 8. ADMIN 합동 검증 — 2026-11-18

UI PR #472의 `711eabc`와 기존 B17을 `1a8c250`으로 합치고 ADMIN UX `0644633`을 `4267bce`로 반영했다. 평가 집계 함수의 B17 적용일 인자와 UI 표본/시각을 모두 보존했다. 타입·production build, 병합 D1 19건, 집중 단위24건/D1 19건, compiled desktop/mobile28건, 범위 밖 metadata2건이 통과했다. [통합 증거](../evidence/cst-ui-admin-integrated-20261118.json)는 정확한 code SHA와 각 실행 범위를 기록한다.

9개 migration은 복사한 합성 DB에만 적용했다. 원격 DB·새 Worker·실제 사용자 작업·메일/유료 호출은0이다. 필수 CI 결제 차단을 로컬 통과로 대체하지 않으며, main 병합·운영 검증은 여전히 별도다.

## 9. 목록·그룹 의미와 남은 실제 누락 — 2026-11-18

`8248172`에서 목록 이름/listitem, 카테고리 그룹·선택/열림 상태를 연결하고768px 헤더/지도 제어의44px을 보완했다. article에 허용되지 않는 listitem 역할은 div 분기로 바꾸고 전역 버튼 규칙은 범위를 좁혀 기존 코스 버튼의50/54px을 보존했다. compiled 브라우저 최초11 PASS/1 FAIL은1440px 코스의 기존50px에 잘못54px을 기대한 시험 오류였다. 기존 CSS에 맞춰 기대값만 고치고 해당1건을 재실행해 PASS했다. 타입·build·production audit와 독립 코드 리뷰를 확인했다.

남은 구현은 정정 대상의1,000건 제한이며 별도 담당이 검색/페이지를 보완한다. 그 다음은 U08 제공/미제공·시간/거리 조합과 실제 LEARNING 화면의 필수 증거다. 현재 항상LEARNING을 반환하는 Flavor 경로에 가짜VISIBLE 값을 넣어 완료로 세지 않는다. 필수 CI·병합·운영·실제 정책은 별도 미완료다.

## 10. 정정 대상 검색 통합 — 2026-11-18

`24ef03e`를 `d4b7b17`로 합류하고 타입·production build·집중 단위18건/D1 14건·compiled desktop/mobile6건을 통과했다. 최종 독립 리뷰에서 새 차단 문제는 없었다. 검색 조건과 커서는 서버에서 검증하고, 선택된 대상은 현재 페이지와 독립적으로 공개 적격성을 재확인한다. 검색·실패 복구는 초안을 보존하고 회수된 대상은 메일/제한 횟수 처리 전에 거절한다. 직접 GET404와 작성 후 POST404의 복구를 구분한다.

이전 cold Vite 실패, 선택 동기화·합성 IME·stale POST의 원래 실패와 시험 선택자 교정은 [증거](../evidence/correction-search-20261118/summary.json)에 남겼다. OS IME 실측이나 메일 확인→관리자 처리 전체를 이6건으로 주장하지 않는다. 학습 화면3폭과 U08 통합8/단위7/추가13건도 각각 지정 범위 증거이며, 남은 U/D/S 조합·CI·운영·실제 정책은 그대로 유지한다.

## 11. 실패 복구·S07·U08 통합 — 2026-11-18

`df80fed`까지 다섯 단위를 합쳐 production build·typecheck·배포 dry-run을 통과했고 의존성 감사 취약점은 0건이다. 컴파일된 Worker의 데스크톱·모바일 브라우저 검증 24건도 통과했다. 테스트용 빌드는 기존 모의 메일 진입점과 로컬 `COURSE_CONTEXT_V2` flag를 사용했고 운영 설정은 변경하지 않았다. [통합 증거](../evidence/recovery-integrated-20261118/summary.json)에 원본 단위별 SHA와 통합 실행의 범위를 구분한다.

Golden 오류의 원래 EMPTY/허위fallback, 같은 mode 재선택으로 마지막 성공을 덮는 문제, guest의 즉시재전송, 탈퇴의 중복/결과불명, 확인전 정정 우회/동시처리·감사 누락, 코스 오류 시 조건유실을 보완했다. 전체시험이 의도치 않게 시작되며 관측된 onboarding-events 실패는 사용하지 않는 rating mock이 원인이었다. 현재 상세 읽기에 실패를 주입하도록 `9782138`에서 시험만 수정하고 원래 이벤트미기록 불변식을 단일 RED→GREEN으로 확인했다.

전체 U/D/S/T 수용·실제 외부 제공자·운영 복구와 미정 정책은 아직 미완료다. 이 결과를 CI 성공이나 배포·실증 완료로 세지 않는다.

## 12. 기능 누락과 수용 경계 — 2026-11-18

제품 코드 `3d31a98`와 수용 시험 `f7d2732`의 app tree는 동일하다. [최종 통합 증거](../evidence/cst-acceptance-integrated-20261118/summary.json)에 필요한 단위 14건·D1 67건, compiled 데스크톱/모바일 18건과 홈 2건을 연결했다. 타입·production build·배포 dry-run·production 의존성 감사도 통과했다. 앞선 7~11절은 당시의 확인·미완료 이력이며, 현재 기능 상태는 위 요구별 표와 이 절을 따른다.

- 일반 장소의 확인일/영업시간·미확인 표시 누락과 모바일 일괄 검수 완료 표시는 수정했다. 기존 관리자 확인 기록만 사용하며 확인자 ID와 현재 영업 여부는 공개 사실로 만들지 않는다.
- 반복 평가의 불필요한 변경 이력과 이유 변경의 무결성 오탐을 보완했다. 같은 값은 평가 포인터·집계를 보존하며, 결과 불명/경합 뒤에는 현재 상태를 확인할 때까지 추가 쓰기를 잠근다.
- 비회원 저장+취향 승계, 공개/반려/회수 권한, 서로 다른 수집 run의 재반입, 중복 판정·이전 처리는 부족했던 수용 사례를 추가했다. 이 범위에서는 추가 제품 결함이 재현되지 않아 테스트만 보완했다.
- 홈의 공개 후보와 카드, 전체 지도의 실제 음식 분류·빈 결과를 연결했다. 분류 선택은 큐레이션 화면에 새로 만들지 않고 기존 전체 지도에서 확인했다.
- D05 산식·신뢰/감쇠·동일 입력 재계산·외부 별점 배제는 기존 고정 기대값을 재확인했다. [집중 데이터 검증](../evidence/cst-focused-data-checks-20261118/summary.json)은 57개 단위·26개 D1 실행이며 전체 T 수용으로 합산하지 않는다.

필수 CI·main 병합·새 운영 배포는 아직 미완료다. 전체 T01~T08의 운영/실제 인증·복구·실증 수용과 운영자·문의처·보관 정책도 별도이며, 원래 NOT_RUN 행을 그대로 보존한다. #397 HOLD와 실제 정책 확인 필요는 변경하지 않는다.

## 13. 운영 선행 준비의 보완 — 2026-11-18

UI 감사에서 추가 구현 결함을 확인하지 못한 뒤, B17 준비표의 전체 원장 보존 누락과 SQL 한도 계산 오류를 보완했다. 기존82표/853열·rowid·자료형의 실제 로컬 D1 비교와9개 migration 적용, 누락/잘림/크기 초과 거절을 확인했다. [준비 증거](../evidence/b17-preparation-20261118/summary.json)는 제품 화면 시험과 별도 범위다. 앱 코드가 바뀌지 않아 앞선 화면 검증을 반복하거나 새 운영 증거로 재분류하지 않았다.

새 실행 도구는 로컬 준비와 향후 읽기 전용 사전 점검까지만 지원한다. 실제 종료 관측과 후속 전환 경로가 없으므로 서비스 중단·원격 migration·배포는 실행하지 않는다. 합성 순서/예산/finally 시험은 실제 원격 작업의 성공이 아니다. 필수 CI·병합·운영·전체 T 수용·실제 정책은 계속 미완료이며 목표100%로 올리지 않는다.

## 14. 공개 목록과 지도 왕복

2026-11-22 · U02/U03/U04·S02의 공개 목록과 탐색 지도가 같은 검색, 공간 범위, 공개 범위와 페이지를 사용한다. bbox만 지정한 목록도 탐색 지도로 열리며 검색어·카테고리·취향 태그·선택 장소를 보존해 돌아갈 수 있다. TEMP는 기존에 공개된 TEMP 집합을 사용하며 지도 범위로 거르지 않는다는 점을 화면에 반영했다.

합성 장소 125곳 중 2페이지 25곳의 결과 집합과 선택을 데스크톱·모바일에서 대조했다. 0건 왕복과 명시적 초기화, 뒤로 가기·다시 열기, 읽기 실패와 마지막 성공 결과의 복구, 카테고리 검색과 지역 그룹을 확인했다. 모바일 목록의 검색을 사용할 때 빠른 정보는 닫히고 장소 선택은 유지된다. 지도 오류 문구와 광주 미니맵을 각각 읽을 수 있다. 일반 공개 장소와 TEMP의 상태를 구분하고 광주 미니맵에는 표현 범위 안 위치만 표시한다.

로컬 컴파일 Worker의 브라우저 55개 통과와 화면별 제외 5개, 위 범위의 단위 36개·통합 5개를 기록했다. 실제 NAVER SDK의 방향키 이동, 운영 배포와 전체 T01·T07 수용은 별도 확인이 필요하다. [실행 요약](../evidence/cst-browse-state-20261122/summary.json) · [데스크톱 탐색](../evidence/cst-browse-state-20261122/desktop-map.png) · [모바일 탐색](../evidence/cst-browse-state-20261122/mobile-map.png) · [모바일 TEMP](../evidence/cst-browse-state-20261122/mobile-temp.png)

## 15. 모바일 전체 상세와 지도 빠른 정보

홈 지도·분류 지도·공개 목록의 모바일 상세는 공통 모달로 열린다. 배경 접근성 트리와 키보드 초점을 격리하고, 닫기·Escape·배경 누르기·뒤로가기에서 기존 열기 지점과 검색 조건을 확인했다. 분류 지도 조회가 실패해도 상세를 닫을 수 있다. SDK가 핀을 다시 만들면 같은 장소의 핀으로 초점을 복원한다. 빠른 정보가 열려 있는 동안 헤더와 지도를 함께 조작할 수 있다.

로컬 컴파일 Worker에서 초점 보완 전 통합 회귀 66건과 최종 초점·지도 실패 회귀 9건을 통과했다. 데스크톱 정식 상세 이동과 기존 추천 출처는 검증 범위에 포함된다. 실제 NAVER SDK, 모바일 평가 입력·공개 콘텐츠와 전체 T07 수용은 별도다. [실행 요약](../evidence/cst-detail-modal-20261122/summary.json) · [데스크톱 빠른 정보](../evidence/cst-detail-modal-20261122/desktop-map-quick-info.png) · [모바일 전체 상세](../evidence/cst-detail-modal-20261122/mobile-place-detail.png)
