# Tasted_it Product-ready Stage 1 (100–300 CCU) 상위 실행 계획

> 상태: **PROPOSED / 구현 시작 HOLD**
> 작성 기준일: 2026-08-07 (KST)
> 코드 기준선: `main@8e8503b34d755cd963068bf19d780fd74a5ee79c`
> 감사 입력: [PR #42](https://github.com/taejunyun1/Tasted_it/pull/42) 및 `docs/audits/2026-08-07-full-product-design-technical-audit.md`
> 실제 1차 달성 범위: **100–300 CCU**
> 후속 확장 상한: **2,000 CCU, 총 4단계**

## 0. 결론

현재 판정은 **HOLD**다. 이번 문서는 PR #42의 감사 보고서를 승인하거나 기존 제품 계획을 대체하는 문서가 아니다. 현재 `main`과 실행 증거를 기준으로 PR #42의 확인된 결함을 다시 분류하고, 기존 제품 목표를 그대로 유지한 채 **100–300 CCU에서 공개 가능한 Product-ready 기준선을 추가하는 상위 실행 계획**이다.

Stage 1 완료는 다음을 동시에 뜻한다.

1. 기존 마스터 설계의 비협상 원칙과 완료 조건을 훼손하지 않는다.
2. PR #42의 55개 finding을 누락 없이 추적하되, 재현되지 않은 항목은 먼저 검증한다.
3. 계약·정책·개인정보·탈퇴·보존 정책과 실제 코드·데이터 흐름이 일치한다.
4. 인증·인가·보안·비용 유발 경로가 fail-closed로 보호된다.
5. 테스트가 워크트리·포트·DB·fixture를 격리하고 최신 커밋에서 CI로 재현된다.
6. 장애 탐지·통지·롤백·데이터 복구·운영자 절차가 증거와 함께 작동한다.
7. 375/768/1440px 수동 검수와 자동 접근성·오류/빈/오프라인 상태 검증을 통과한다.
8. 300 CCU 상한의 대표 부하를 3회 연속 통과하고 별도 soak test를 통과한다.
9. 광주 공개 베타의 기존 콘텐츠 목표인 **검수 완료 Place 300곳**을 유지한다. 부하 fixture의 300곳과 실제 공개 Place 300곳은 서로 다른 데이터 집합이다.

Stage 1이 끝나도 B2B, 결제, 전남 확장, 앱, 전국 확장은 완료된 것이 아니다. 그것들은 기존 계획의 후속 목표로 보존하며, 이 문서의 Stage 2–4 CCU 확장과 별도 제품 phase를 모두 통과해야 한다.

---

## 1. 문서 권위와 사용 규칙

### 1.1 증거 우선순위

충돌 시 다음 순서로 판단한다.

1. 최신 `main`의 실행 코드·불변 마이그레이션·재현 가능한 테스트 결과
2. `AGENTS.md`, `COWORK.md`, 확정된 사람 결정과 ADR
3. 승인된 제품 목표와 비협상 원칙
4. 최신 제품 방향 문서
5. 개별 구현 plan의 아직 유효한 완료 조건
6. PR #42 감사 보고서와 conversation의 권고

PR #42는 독립 검수에서 HOLD였고 내부 모순이 남아 있으므로 SSOT가 아니다. 이 문서도 사람 승인 전에는 구현 명령이 아니다.

### 1.2 사실·권고·가설 표기

- **확인된 사실**: 현재 `main` 파일 또는 재현 가능한 로컬 실행으로 확인했다.
- **권고**: 공식 문서와 위험 분석을 근거로 제안한 목표값·구조다. 아직 제품 계약이 아니다.
- **가설**: 코드 정황은 있으나 실행 재현이나 외부 계정 증거가 없다. 수정 전에 검증 PR/테스트가 필요하다.
- **외부 증거 필요**: Cloudflare/NAVER/Resend 설정, 법률 의견, 실제 DNS·알림·청구 상태처럼 저장소만으로 확인할 수 없다.

### 1.3 이번 문서의 비범위

- 제품 코드 구현, 마이그레이션 실행, PR #42 병합/재병합
- 운영 D1·Workers·NAVER Maps·Resend·Workers AI 호출
- 배포, DNS 변경, 결제/유료 플랜 변경, 실제 고객 데이터 처리
- 법률 자문을 대신하는 규제 적용 결론
- 301–2,000 CCU의 실제 구현 완료

---

## 2. PR #42 재검토 결과

### 2.1 최신 `main`에서 확인된 핵심 사실

| 영역 | 최신 기준 확인 사실 | 계획 반영 |
|---|---|---|
| 남용 방어 | 인증·메일 경로에 애플리케이션 rate limit과 `Retry-After`가 없다. 로그인은 계정이 존재할 때 PBKDF2 99,999회를 수행한다. | S1-PR04, S1-PR05 |
| 인증 토큰 | 재설정·인증·정정 토큰이 URL 쿼리로 이동하며 이메일 인증·정정은 GET loader에서 상태를 변경한다. 토큰 소비가 원자적 성공 행 수를 확인하지 않는다. | S1-PR05 |
| 세션 | 비밀번호 재설정 후 기존 세션이 유지된다. 로그인 오류 문구·KDF 경로로 계정 존재 여부가 구분될 수 있다. | S1-PR05 |
| 개인정보 | 위치 bbox가 URL을 통해 서버로 전달되며 observability가 전 요청 샘플링으로 설정돼 있다. 현재 인벤토리·고지는 실제 흐름과 불일치한다. | S1-PR01, S1-PR09 |
| 탈퇴·보존 | 회원 탈퇴 라우트와 서버 함수가 없다. FK `restrict`는 하드 삭제를 막지만 익명화 가능 여부와 법적 보존 정책은 별도 결정이다. | S1-PR00, S1-PR06 |
| 테스트 | Playwright seed가 `webServer` 명령에 결합돼 있고 `reuseExistingServer: true`다. 통합 테스트는 운영 binding이 든 `wrangler.jsonc`를 재사용한다. | S1-PR02 |
| CI | `.github/workflows`와 required check를 구성할 워크플로가 없다. coverage 임계값과 `packageManager` 고정도 없다. | S1-PR03 |
| 데이터 정합성 | 공개 목록/지도 점수와 상세 점수의 데이터 소스가 다르다. primary 카테고리, 스냅샷 재사용, 병합, 동일값 재투표 경로에 불변식 공백이 있다. | S1-PR07, S1-PR08 |
| D1 용량 | 공개 목록이 raw vote 집계를 수행하고 일부 화면은 같은 목록 쿼리를 중복 호출한다. `vote_events.created_at` 인덱스가 없다. | S1-PR10 |
| 관측·운영 | cron 작업이 한 `Promise.all`에 묶이고 외부 통지 채널이 없다. 현재 로그는 민감 쿼리 redaction 계약이 없다. | S1-PR09 |
| UI 상태 | 라우트별 error boundary가 없고 pending/empty/403/offline 상태가 불완전하다. 확인 가능한 대비 실패는 2개다. | S1-PR13, S1-PR14 |
| 외부 의존성 | NAVER SDK 재시도, Resend rate/quota, Workers AI·공공데이터 kill switch와 공급자별 예산 증거가 완결되지 않았다. | S1-PR12, S1-PR17 |

PR #41이 해결한 범위인 타 지역 위치 폴백과 카테고리 선택 후 지도 줌 동작은 최신 `main`에 반영돼 있다. 이 완료 사실은 위치 데이터 처리 고지(SEC-04)나 `/maps/:slug`의 별도 dead CTA(UX-07)를 해소한 것으로 확대 해석하지 않는다.

### 2.2 PR #42에서 바로잡아야 하는 내용

| PR #42 내용 | 재검토 판정 | 이 계획의 처리 |
|---|---|---|
| `.audit-source.cxo3js`를 감사 코드 SSOT로 선언 | 저장소에 파일이 없어 출처 재현 불가 | 감사 출처로 사용하지 않는다. S1-PR00에서 provenance를 정정한다. |
| `specs/...`, `plans/...` 링크 | 실제 경로는 `docs/superpowers/specs/...`, `docs/superpowers/plans/...` | 이 문서는 실제 경로만 사용한다. |
| SEC-05 “회원 탈퇴 구현 불가” | 부정확하다. **미구현**이며 하드 삭제와 익명화는 다른 정책·기술 선택이다. | S1-PR00에서 사람 결정, S1-PR06에서 선택한 정책 구현·검증 |
| SEC-03 “어떤 요청 URL에도 bearer가 없어야 함” | 일반 이메일 링크 방식에서는 최초 HTTPS URL 토큰 또는 사용자가 입력하는 PIN 중 하나가 필요하다. 감사의 선택지 A/B도 사실상 같은 교환 구조다. | 단일 사용·짧은 TTL URL 토큰 허용, no-referrer, rate limit, invocation URL 비기록/경로만 기록, 즉시 HttpOnly 세션 교환 후 clean redirect. URL을 전혀 쓰지 않으려면 별도 PIN 결정을 요구한다. |
| production 범위와 PR 수, “55건 1:1” | 설명과 표의 번호·합계가 모순되고 복합 PR 배치가 있어 1:1 표현은 성립하지 않는다. | 이 문서는 **55개 고유 ID coverage matrix**를 사용한다. 각 ID에 primary owner 하나를 두고 secondary 영향은 별도 표기한다. |
| 접근성 대비 실패 3건 | selector/DOM 증거가 있는 것은 `#777/#e8e8e3`, `#8290a0/#fff` 2건이다. `#777/#e8ebe4`는 실제 텍스트 selector 증거가 없다. | 확인 2건만 결함으로 처리하고 제3 조합은 전수 자동검사에서 다시 찾는다. |
| 375/768/1440 독립 검증 완료로 읽힐 수 있는 서술 | 독립 검수 round 2가 live 3폭 검증 미완료를 명시했다. | S1-PR18 종료 게이트에 실제 3폭 사람 검수를 넣는다. |
| ARC-02 모바일 저장 crash | 정적 코드 추론이며 최신 기준 독립 재현이 없다. | S1-PR14에서 먼저 재현 테스트. 재현되면 분리 fetcher로 수정, 재현되지 않으면 증거와 함께 finding을 닫는다. |
| 인증 E2E 실패 | PR #41 서버와 감사 워크트리 fixture 불일치가 직접 원인이다. | 제품 인증 결함으로 오인하지 않는다. 테스트 격리·프로비저닝 결함(QLT-01)의 재현 증거로만 사용한다. |

### 2.3 아직 확인되지 않은 항목

다음은 구현 착수 전에 외부 또는 사람 증거가 필요하다.

1. Cloudflare 계정의 WAF/Bot/Rate Limiting/알림/청구/권한 구성과 실제 로그 필드
2. NAVER Maps 대표 계정, 허용 도메인, 일·월 한도, 임계 알림, 실제 과금 계약
3. Resend 도메인의 SPF/DKIM/DMARC, 팀 rate limit·quota·overage, 데이터 처리 계약
4. Workers AI 실제 모델·quota·비용 설정과 운영에서의 호출 허용 범위
5. 개인정보처리자·서비스 운영 주체, 국외 이전/위탁 구조, 위치정보법 적용 여부에 대한 법률 검토
6. 14세 미만 이용 정책, 탈퇴 시 익명화/삭제·보존 기간, 재가입 정책
7. 실제 100–300 CCU 트래픽 분포와 현재 p95/p99·오류율·비용 baseline
8. 실제 모바일 375px에서 ARC-02 재현 여부와 375/768/1440 전체 화면 검수

---

## 3. 기존 계획과 신규 계획의 관계

### 3.1 원칙

이 계획은 기능 로드맵의 위에 놓이는 **출시 성숙도 축**이다. 기존 계획의 기능 목표는 삭제하지 않고 다음 셋 중 하나로 표시한다.

- **보존**: 기존 순서와 완료 조건을 그대로 유지한다.
- **선행 게이트 추가**: 기능 목표는 유지하고 공개/확장 전에 안전·운영 조건을 추가한다.
- **근거 기반 조기 보강**: 기존 후속 단계의 일부를 300 CCU 안전성에 필요한 범위만 앞당긴다. 나머지 목표는 원래 단계에 남긴다.

### 3.2 관계 매핑

| 기존 문서·목표 | 기존 완료 조건/의도 | 현재 누락·중복·충돌 | 신규 계획 관계 | 폐기 금지 목표 |
|---|---|---|---|---|
| `2026-08-05-retaste-master-design.md` §3 비협상 원칙 | 유료/평가 분리, 원시 이벤트 보존, 정확한 위치 비저장, 소유주 자체 평가 금지 | 위치 고지와 URL/로그 흐름 불일치 | **보존 + S1-PR01/09 선행 게이트** | 비협상 원칙 전부 |
| 마스터 1주차 실데이터 베타 | 실데이터, 지역 탐색, 투표/저장, 개인정보·배포 게이트 | Week 1 Task 8 증거 미완; 20행 CSV와 목표 규모 불일치 | **보존 + S1-PR01~06/16~18** | 실데이터 검수·정책·배포 증거 |
| 마스터 2주차 CMS·리뷰어 | 운영 CMS, reviewer 권한/워크플로 | 기능 코드는 있으나 감사 로그 조회·오류 상태·운영 증거 부족 | **보존 + S1-PR08/09/14** | reviewer 독립성·관리자 추적성 |
| 마스터 3주차 평가 신뢰도·이미지 | rating v2, 무효화, 이미지 권리 | rating v2는 부분 완료하나 공개 표면 소스 불일치. 이미지 권리는 미결정 | **평가 정합성만 S1-PR07/08로 조기 보강**, 이미지 목표는 보존 | 원시 투표·재현성·이미지 권리 |
| 마스터 4주차 개인화·출시 안정화 | 개인화, 성능, 접근성, 출시 안정화 | 개인화보다 남용 방어·CI·운영 공백이 선행 | **안정화 조건을 S1 전반으로 확장**, 개인화는 기존 후속 순서 보존 | 개인화·재방문 목표 |
| 마스터 Phase 2 운영 안정화 | 알림, 운영 절차, 품질 개선 | 실제 운영 통지·복구·롤백 부족 | **300 CCU에 필요한 최소분을 S1-PR09/16으로 조기 보강** | 장기 운영 자동화 |
| 마스터 Phase 3 B2B 결제 | 소유주 상품과 평가 독립 | 계약·결제·광고 정책 미확정 | **Stage 1 밖에 보존**. Product-ready Stage 1 통과 전 착수 금지 | 결제와 평가 영향 분리 |
| 마스터 Phase 4 앱 | 앱·스토어·동기화 | 웹 기준선 미달 | **Stage 1 밖에 보존** | 앱 E2E·스토어 완료 조건 |
| v2 단계 1 운영 기반 안정화 | Resend, 원격 D1, 공공데이터 QA, 감사 로그 | 완료 표기와 외부 증거 불일치 | **S1-PR02/09/12/16/17로 증거화** | 운영 기반 4개 목표 |
| v2 단계 2 광주 공개 베타 | 검수된 Place 300곳 | 현재 seed/CSV와 실데이터 provenance 부족 | **S1 종료의 콘텐츠 게이트로 보존** | 검수 완료 300곳 |
| v2 단계 3 리뷰어 시스템 | 신청·평가·프로필·활동 | 기능 존재, 데이터/상태/접근성 검증 부족 | **기존 단계 보존 + S1 회귀 게이트** | reviewer 신뢰도 모델 |
| v2 단계 4 평가 고도화 | rating v2·배지·무결성 | “완료” 표기와 공개 소스/merge/integrity 결함 충돌 | **S1-PR07/08로 완료 조건 재검증** | rating 수학과 불변식 |
| v2 단계 5–6 이미지·개인화 | 미디어, 컬렉션, 팔로우, 알림 | Product-ready 기반 전에 확장 위험 | **Stage 1 후 보존** | 이미지 출처·개인화 목표 |
| v2 단계 7–9 B2B·전남·앱 | 수익화, 지역 확장, 앱 | 300 CCU 기준선과 법무 계약 미달 | **후속 제품 phase + CCU Stage 2–4와 교차 게이트** | 전체 목표 전부 |
| 22개 기능 plan | 지도·분류·AI·평가·운영 세부 구현 | 체크박스가 코드 상태와 불일치 | **파일 존재가 아니라 해당 plan의 테스트·수용 증거로 재판정** | 각 plan의 사용자 가치와 회귀 테스트 |
| `docs/decisions/*` D-01~D-12 | 공개 범위, 인증, 연령, 좌표, 데이터·이미지·법무 | D-07 외 대부분 미승인인데 코드가 선행 | **S1-PR00 사람 결정 게이트** | 미결정 항목을 임의 확정하지 않는 규칙 |

### 3.3 충돌 해소 규칙

1. Better Auth, 매직링크, 현재 비밀번호 인증의 3중 충돌은 S1-PR00의 인증 ADR로 해결한다. 기존 문서를 조용히 덮어쓰지 않는다.
2. `Re:Taste`와 `Tasted : IT` 충돌은 운영자가 서비스명·법적 표시명을 결정한 뒤 S1-PR15에서 정합화한다.
3. NAVER Maps 확정(D-07)은 유지한다. MapLibre 등 과거 대안은 역사 기록으로 남기고 현재 구현 지시로 사용하지 않는다.
4. 기존 체크박스는 완료 증거가 아니다. 현재 파일, 최신 커밋의 자동 검사, 사람 검수, 외부 계정 증거를 함께 요구한다.
5. 기존 마이그레이션은 수정하지 않는다. 모든 스키마 변경은 새 순번으로 추가한다.

---

## 4. Product-ready Stage 1 계약

### 4.1 사람·정책 계약

Stage 1 구현 전 다음 결정의 승인자·승인일·근거 링크가 있어야 한다.

| 결정 ID | 사람 결정 | 최소 산출물 | 미결정 시 |
|---|---|---|---|
| PRD-D01 | 운영 주체·법적 사업자명·서비스명·문의/침해 대응 연락처 | ADR + 약관/방침 표기 | 공개 HOLD |
| PRD-D02 | 공개 범위(초대/공개), 최소 연령, 14세 미만 처리 | ADR + 가입 정책 | 가입 공개 HOLD |
| PRD-D03 | 인증 방식 유지/전환, 비밀번호 정책, 계정 복구 방식(URL token 또는 PIN) | 인증 ADR | S1-PR05 HOLD |
| PRD-D04 | 탈퇴의 하드 삭제/익명화, 항목별 보존 기간, 법정 보존 근거, 재가입 | 데이터 lifecycle ADR | S1-PR06 HOLD |
| PRD-D05 | 위치 bbox 정밀도·URL/로그 보존·동의 방식과 위치정보법 적용 검토 | 위치 처리 ADR + 법률 검토 메모 | 위치 기능 공개 HOLD |
| PRD-D06 | Resend/NAVER/Cloudflare/Workers AI의 위탁·국외 이전·DPA/약관 수용 | 공급자 register | 해당 binding 운영 HOLD |
| PRD-D07 | Stage 1 SLO, 월/회차 비용 한도, on-call/incident commander, RTO/RPO | 운영 승인 기록 | S1-PR17/18 HOLD |
| PRD-D08 | 공개 Place 300곳의 출처·라이선스·검수 책임자 | 데이터 provenance manifest | 광주 베타 HOLD |

법적 기준은 최소한 개인정보 보호법의 파기·처리방침·처리정지, 14세 미만, 국외 이전 규정을 검토한다. 위치정보법 적용 여부는 저장소만으로 확정하지 않고 법률 담당자의 명시적 판단을 받는다. 2026년 개인정보 처리방침 작성지침 개정안은 확정 규정이 아니라 참고 초안으로만 취급한다.

### 4.2 보안·개인정보 계약

- 상태 변경 경로는 인증, 객체 소유권/역할, 스키마 검증, CSRF/Origin 방어 순서를 명시한다.
- 인증·메일·AI·공공데이터·관리자 작업은 사용자/행위별 rate limit, quota, idempotency, kill switch를 갖는다.
- 인증 실패는 계정 존재 여부를 문구·실용적 타이밍으로 노출하지 않는다.
- 재설정/인증 토큰은 단일 사용, 짧은 TTL, 원자적 소비, no-referrer, clean redirect를 갖는다. 비밀번호 재설정 후 모든 기존 세션을 폐기한다.
- 로그에는 token, password, cookie, authorization, 이메일 원문, 정확한 bbox/좌표, 원문 provider payload를 남기지 않는다.
- 탈퇴·보존·파기 작업은 항목별 정책, 감사 이벤트, 실패 복구, 재가입 테스트를 갖는다.
- 비밀은 `.dev.vars`/배포 secret에만 두고 로그·fixture·client bundle·Git에 포함하지 않는다.

### 4.3 품질·운영 계약

- unit/integration/E2E/performance fixture는 운영 binding·운영 DB·실제 외부 공급자와 분리한다.
- CI는 최신 commit SHA에서 install, typecheck, lint/format(도입 후), unit, integration, build, E2E smoke, dependency audit를 실행한다.
- 배포는 build 성공이 아니라 immutable version, required checks, migration 검토, 승인, smoke, 관측, rollback 증거를 요구한다.
- 장애는 detect → triage → contain → rollback/forward-fix → recover → postmortem 순서로 운영한다.
- Worker rollback과 D1 복구를 분리한다. D1 Time Travel은 파괴적 복원임을 전제로 incident commander와 bookmark 증거 없이는 실행하지 않는다.
- 클라이언트 상태는 loading, empty, error, 401/403/404/429/5xx, offline, retry, stale를 구분한다.
- 접근성 목표는 WCAG 2.2 AA, Core Web Vitals는 실제 사용자 p75에서 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1이다.

---

## 5. 4단계 상용 스테이징 용량 계획

### 5.1 CCU 정의와 계산 모델

이 문서에서 CCU는 같은 관측 창 안에서 사용자 시나리오를 수행 중인 동시 가상 사용자(VU)다. 열린 브라우저 탭 수, WebSocket 수, Cloudflare의 공급자 한도, RPS와 동일하지 않다.

Stage 1의 300 CCU 대표 workload 권고는 다음과 같다.

| 사용자군 | 비중 | 행동 cadence | 300 CCU 환산 |
|---|---:|---:|---:|
| 목록/지도 읽기 | 60% | 8초마다 동적 요청 1회 | 22.50 RPS |
| 지도 pan/search/filter | 25% | 4초마다 동적 요청 1회 | 18.75 RPS |
| 장소 상세 읽기 | 10% | 10초마다 동적 요청 1회 | 3.00 RPS |
| 인증 mutation(투표/저장 등) | 5% | 20초마다 요청 1회 | 0.75 RPS |
| **합계** | **100%** | — | **약 45 RPS** |

45 RPS는 아직 실측 baseline이 아닌 **초기 모델**이다. S1-PR11에서 think time, 캐시, 세션, 데이터 분포를 코드로 고정하고 실제 베타 telemetry로 보정한다. 정적 자산과 브라우저가 NAVER에 직접 보내는 지도 요청은 앱 동적 RPS에서 분리한다.

외부 공급자를 소유하지 않거나 명시적 부하 허가가 없으면 부하 테스트에서 호출하지 않는다. NAVER Maps, Resend, Workers AI, 공공데이터는 deterministic stub/fake로 대체하고, 승인된 별도 contract test만 공급자 quota 아래에서 수행한다.

### 5.2 단계 구간 근거

- Stage 1 `100–300`: 최초 공개 베타 기준선. 현재 제품/운영 미성숙도를 감안한 실제 달성 범위다.
- Stage 2 `301–700`: Stage 1 상한의 약 2.3배. 단일 D1의 직렬 실행과 쿼리 효율이 처음으로 구조적 병목인지 판단하는 구간이다.
- Stage 3 `701–1,200`: 약 1.7배 확장. 캐시, 읽기 분리/복제, 작업 큐 또는 데이터 분할이 필요한지 실제 증거로 결정하는 구간이다.
- Stage 4 `1,201–2,000`: 약 1.67배 확장. 최종 상용 상한이며 24시간 soak와 운영 교대·복구 훈련까지 포함한다.

경계는 사용자 성장 단계를 분리하기 위한 제안값이다. CCU를 올리기 위해 SLO나 안전 기준을 낮추지 않는다.

### 5.3 단계별 성능·운영 계약

아래 수치는 현재 달성 사실이 아니라 **승인 대상 권고 계약**이다. `unexpected error`는 5xx, Worker platform error, timeout, 연결 중단, 데이터 불변식 실패를 포함하며 의도된 4xx와 abuse test의 429는 별도 계측한다.

| 항목 | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
|---|---|---|---|---|
| CCU | 100–300 | 301–700 | 701–1,200 | 1,201–2,000 |
| 진입 조건 | S1-PR00~17 완료, 격리 staging, 정책 승인, 300곳 실제 데이터 gate | Stage 1 종료 후 실제 운영 14일, Sev1/2 미해결 0, workload 재보정 | Stage 2 종료 후 30일, D1 구조 검토 승인, 용량 여유 ≥2배 | Stage 3 종료 후 30일, DR/on-call 교대 훈련, 공급자 계약/한도 승인 |
| 공개 read p95/p99 | ≤500/1,200ms | ≤500/1,100ms | ≤450/1,000ms | ≤450/900ms |
| 인증 mutation p95/p99 | ≤800/1,800ms | ≤800/1,700ms | ≤750/1,600ms | ≤750/1,500ms |
| unexpected error율 | ≤0.50% | ≤0.30% | ≤0.20% | ≤0.10% |
| 가용성 SLO | 99.5%/월 | 99.7%/월 | 99.8%/월 | 99.9%/월 |
| 부하 실행 | 90분 ramp/hold, 3회 연속 | 120분 ramp/hold, 3회 연속 | 150분 ramp/hold, 3회 연속 | 180분 ramp/hold, 3회 연속 |
| soak | 150 CCU × 2시간 | 500 CCU × 4시간 | 900 CCU × 8시간 | 1,500 CCU × 24시간 |
| synthetic 데이터 | 300 places, 3k users, 100k vote events, 20k current votes, 10k saves | 1k places, 10k users, 500k vote events, 100k current votes, 50k saves | 3k places, 30k users, 2m vote events, 400k current votes, 250k saves | 5k places, 50k users, 5m vote events, 1m current votes, 500k saves |
| 단계별 관측 중점 | route/query baseline, auth·rate limit, D1 rows/query, PII canary | cache hit/miss, D1 queue/overload, provider quota와 실제 traffic mix | replication/partition/queue lag, consistency, background job 격리 | 장애 도메인별 saturation, on-call 교대, 24h 비용·누수·복구 |
| 월 변동비 ceiling* | USD 25 | USD 75 | USD 150 | USD 300 |
| 1회 인증 run ceiling* | USD 10 | USD 25 | USD 50 | USD 100 |
| 즉시 중단·롤백 | error >1% 5분, p99 >2×계약 10분, 불변식/PII 1건, 비용 80% | error >0.8% 5분, p99 >2×계약 10분, queue/불변식/PII 1건, 비용 80% | error >0.5% 5분, consistency/replication 오류 1건, p99 >2×계약, 비용 80% | error >0.3% 5분, 장애 도메인 saturation/데이터 오류 1건, p99 >2×계약, 비용 80% |
| 종료 조건 | §8의 Stage 1 Definition of Done 전부 | 목표 700 CCU 3회 + soak + 실제 운영 30일 | 목표 1,200 CCU 3회 + soak + 복구 훈련 | 목표 2,000 CCU 3회 + 24h soak + 상용 운영 승인 |

\* 비용 ceiling은 세금·환율·기존 고정 계약을 포함할지 PRD-D07에서 확정해야 하는 임시 상한이다. Cloudflare budget alert는 통지일 뿐 사용을 중단하지 않고 일 단위 지연이 있으므로, 애플리케이션 quota/kill switch와 NAVER 일·월 hard limit, Resend overage 비활성화를 함께 사용한다.

### 5.4 전 단계 공통 관측 항목

1. **Worker**: route/status별 요청, 429, 5xx, invocation status, wall/CPU time p50/p95/p99, memory, subrequest 수
2. **D1**: read/write QPS, query latency, rows read/written, query efficiency, DB size, queue/overload, 상위 slow query와 `EXPLAIN QUERY PLAN`
3. **도메인**: 투표 이벤트/현재 투표 불변식, rating stale queue age, merge/recompute 실패, 중복 primary category, seed checksum
4. **인증/보안**: 로그인·reset·메일 rate limit, 토큰 재사용 거부, session revoke, 권한 거부, CSRF/Origin 실패
5. **외부 의존성**: NAVER SDK/API availability, Resend 429/quota/bounce, Workers AI neuron/quota, 공공데이터 sync 지연 — 실제 호출과 stub을 태그로 분리
6. **클라이언트**: JS 오류, route error, offline/retry, 375/768/1440 화면, 실제 사용자 p75 LCP/INP/CLS
7. **운영**: cron 성공/실패/지연, alert 전달, 배포 version, rollback 시간, migration/restore drill
8. **비용**: Workers requests/CPU, D1 rows read/written/storage, Logs ingestion, AI neurons, email count, Maps usage와 각 비용 추정

### 5.5 Stage 1 부하 실행 상세

단일 인증 run은 90분이다.

1. 0→100 CCU 10분 ramp, 100 CCU 15분 hold
2. 100→200 CCU 10분 ramp, 200 CCU 15분 hold
3. 200→300 CCU 10분 ramp, 300 CCU 30분 hold

최종 release candidate에서 3회 연속 통과하고, 별도로 150 CCU 2시간 soak를 1회 통과한다. 각 run은 동일한 immutable Worker version, 동일 fixture manifest, 동일 load script SHA를 기록한다. 프로토콜 부하가 대부분의 트래픽을 만들고 소수 browser scenario가 Core Web Vitals와 렌더 오류를 검증한다.

Stage 1 즉시 중단/롤백 조건은 다음과 같다.

- unexpected error >1%가 5분 지속
- route p99가 계약의 2배를 10분 지속
- D1 overload/queue error가 0.1%를 5분 지속하거나 query가 30초 제한에 접근
- 데이터 불변식 1건, PII/token/정확 좌표 로그 1건, 인증 우회 1건
- 비용 추정이 회차 ceiling의 80%에 도달하거나 공급자 quota 80% 도달
- 외부 의존성 실패가 fail-closed가 아니거나 실제 사용자/운영 데이터를 오염

중단 순서는 load generator 정지 → mutation/outbound kill switch → 영향 확인 → Worker version rollback 또는 forward-fix → D1 일관성 검사다. D1 Time Travel은 별도 승인과 복원 bookmark가 있을 때만 사용한다.

---

## 6. Stage 1 작업 순서와 의존 관계

`S1-PRxx`는 실제 GitHub PR 번호가 아니라 작은 구현 단위 식별자다.

```text
S1-PR00 결정·감사 정합
 ├─ S1-PR01 계약·개인정보
 ├─ S1-PR04 남용·비용 방어 ─ S1-PR05 인증·토큰
 ├─ S1-PR06 탈퇴·보존
 ├─ S1-PR12 외부 의존성
 ├─ S1-PR15 브랜드·공유
 └─ S1-PR17 staging·예산

S1-PR02 테스트 격리 ─ S1-PR03 CI 게이트 ─┬─ S1-PR07 평가 소스
                                          ├─ S1-PR08 데이터 불변식
                                          ├─ S1-PR09 관측·통지
                                          ├─ S1-PR13 접근성 기반
                                          └─ S1-PR14 상태·모바일

S1-PR07 + S1-PR08 + S1-PR09 ─ S1-PR10 D1 용량
S1-PR02 + S1-PR10 ─ S1-PR11 부하 harness
S1-PR01~15 ─ S1-PR16 런북·복구
S1-PR03 + S1-PR16 ─ S1-PR17 격리 staging
S1-PR04~17 ─ S1-PR18 100/200/300 CCU 인증
```

병렬 PR은 파일 소유권을 PR conversation에 먼저 기록한다. `app/db/schema.ts`, `wrangler.jsonc`, `workers/app.ts`, `app/root.tsx`, `app/app.css`, `package.json`은 충돌 hotspot이므로 동시 소유하지 않는다.

---

## 7. Stage 1 작은 PR 실행 명세

### S1-PR00 — 사람 결정과 감사 provenance 정합

- **의존/담당**: 없음 / Product owner + Legal/Privacy + Tech lead
- **예상 파일**: `docs/decisions/2026-08-05-next-product-decisions.md`, 신규 `docs/decisions/*-product-ready-decisions.md`, PR #42 감사 문서의 정정 PR 또는 errata
- **범위**: PRD-D01~D08 승인 상태, 인증/연령/탈퇴/위치/브랜드/SLO/예산 결정을 ADR로 고정한다. PR #42의 누락 파일, dead link, SEC-03/05, finding 합계, 대비 수, 미완료 viewport 검증을 errata로 남긴다.
- **수용 기준**: 공개 차단 결정에 `TBD`가 없고 각 결정에 승인자·일시·근거·재검토 조건이 있다. 감사 보고서는 SSOT가 아니라 advisory임을 명시한다.
- **자동 검증**: Markdown link/path 검사, 55개 고유 audit ID 집합 검사, ADR 번호 중복 검사
- **수동 검증**: Product/Legal/Privacy/Tech 네 역할의 승인 또는 명시적 HOLD
- **보안·개인정보·운영 영향**: 이후 PR의 경계 계약이다. 잘못된 결정은 코드 수정으로 상쇄할 수 없다.
- **migration/rollback**: DB 없음. 결정 변경은 기존 ADR 삭제가 아니라 새 superseding ADR로 되돌린다.
- **사람/외부 게이트**: 법률 검토와 운영자 서명 없이는 S1-PR01/05/06/17 착수 금지

### S1-PR01 — 계약·약관·개인정보·데이터 lifecycle 계약

- **의존/담당**: S1-PR00 / Legal/Privacy owner + Backend owner
- **예상 파일**: `docs/legal/privacy-data-inventory.md`, `docs/legal/privacy-policy-guide.md`, 신규 `docs/legal/retention-and-withdrawal-policy.md`, 신규 `docs/legal/third-party-processors.md`, `app/routes/privacy.tsx`, `app/routes/terms.tsx`
- **범위**: 필드별 수집 목적·법적 근거·저장 위치·처리자·국가·보존/파기·탈퇴 효과를 기록한다. 정확 bbox, 비회원 이메일, password hash/salt, reviewer 직업/진술, provider payload, audit/log 데이터를 포함한다. 약관에는 계정, 콘텐츠/이미지 권리, 금지행위, 평가 독립성, 서비스 중단, 책임·문의 절차를 포함한다.
- **수용 기준**: 문서와 실제 데이터 흐름의 불일치 0건, 수집 필드 100% 인벤토리화, 정책 버전·시행일·이전 버전 링크, 보존 만료 테스트 시나리오가 있다.
- **자동 검증**: schema/env/log field inventory snapshot과 문서 항목 diff, 정책 route 렌더/링크 테스트
- **수동 검증**: 법률 담당자의 개인정보·위치·국외 이전·미성년자 검토, 375px 정책 화면 가독성
- **보안·개인정보·운영 영향**: 데이터 최소화와 파기 책임을 코드보다 먼저 고정한다.
- **migration/rollback**: 없음. 정책 시행일 전에는 기존 문구를 보존하고 새 버전을 준비 상태로 둔다.
- **사람/외부 게이트**: 운영 주체, 위탁사/DPA, 위치정보법 적용 의견이 없으면 공개 HOLD

### S1-PR02 — 테스트 격리·fixture·seed 재현성

- **의존/담당**: 없음 / QA/Developer Experience
- **예상 파일**: `playwright.config.ts`, `vitest.workers.config.ts`, 신규 `wrangler.test.jsonc`, 신규 `tests/e2e/global-setup.ts`, `scripts/seed-*.sql`, 신규 fixture manifest, `package.json`
- **범위**: E2E마다 독립 포트·로컬 D1·고유 session fixture를 만들고 서버 재사용과 무관하게 migrate/seed한다. 통합 테스트에서 운영 D1 ID와 AI binding을 제거한다. seed는 고정 입력·checksum·cleanup/idempotency 계약을 갖는다.
- **수용 기준**: 다른 dev 서버가 5173에서 떠 있어도 자기 서버/DB만 사용한다. E2E를 연속 2회 실행해 결과와 seed checksum이 같다. 테스트에서 외부 네트워크/운영 binding 호출은 0건이다.
- **자동 검증**: unit/integration/E2E 2회 연속, 의도적 기존 서버 fixture 불일치 회귀 테스트, 네트워크 deny test
- **수동 검증**: 두 worktree에서 동시에 실행해 포트·DB·세션 충돌이 없는지 확인
- **보안·개인정보·운영 영향**: 고정 admin session의 범위를 test env로 제한하고 fixture에 실 이메일/비밀을 금지한다.
- **migration/rollback**: 로컬 ephemeral DB에만 migration. 운영 DB 변경 없음. 실패 시 기존 로컬 실행 명령으로 되돌리되 CI 진입은 금지한다.
- **사람/외부 게이트**: 없음. 유료/remote lane 호출은 금지

### S1-PR03 — CI·required checks·coverage·공급망 게이트

- **의존/담당**: S1-PR02 / Platform + QA
- **예상 파일**: 신규 `.github/workflows/ci.yml`, `package.json`, `pnpm-lock.yaml`, `vitest*.config.ts`, 신규 formatter/lint config, `docs/operations/cloudflare-deploy.md`
- **범위**: `pnpm`/Node 버전을 고정하고 install/typecheck/format-or-lint/unit/integration/build/E2E smoke/dependency audit/coverage를 최신 SHA에서 실행한다. runtime과 dev-only advisory를 구분한다. artifact와 실패 trace를 보존한다.
- **수용 기준**: 같은 SHA 재실행 결과가 재현되고 required check가 하나라도 실패하면 merge 불가다. coverage baseline을 먼저 기록하고 핵심 auth/rating/data invariant 모듈에 line/branch 임계값을 둔다. `undici` advisory는 도달성 근거와 업데이트 결과를 기록한다.
- **자동 검증**: CI 자체 전 job, lockfile frozen install, branch protection check 이름 contract test
- **수동 검증**: 의도적 실패 PR로 merge 차단 확인, maintainer 우회 권한 검토
- **보안·개인정보·운영 영향**: 최소 `contents: read`, fork secret 미노출, third-party Action SHA pinning
- **migration/rollback**: 없음. 실패한 dependency update는 새 revert PR로 되돌리고 임계값은 통과시키기 위해 낮추지 않는다.
- **사람/외부 게이트**: GitHub 관리자 required checks/branch protection 설정 증거 필요

### S1-PR04 — 남용 방어·비용 유발 경로·보안 헤더

- **의존/담당**: S1-PR00, S1-PR03 / Security + Backend
- **예상 파일**: `wrangler.jsonc`, `app/cloudflare-env.d.ts`, 신규 `app/features/security/rate-limit.server.ts`, `workers/app.ts`, 인증·메일·관리자 action routes, 관련 unit/integration tests
- **범위**: 로그인/가입/reset/정정/AI/공공데이터/admin mutation에 actor+route 기반 rate limit, quota, idempotency, `429 Retry-After`, kill switch를 둔다. Cloudflare rate limiter는 위치별 eventually-consistent 방어이므로 이메일·AI의 정확한 회계는 별도 durable/D1/provider quota로 닫는다. CSP, HSTS, Referrer-Policy, X-Content-Type-Options, frame 정책을 NAVER Maps 허용목록과 함께 적용한다.
- **수용 기준**: 정상 오류 3회는 복구 가능하고 계약 초과 요청은 429다. IP만을 유일 key로 사용하지 않는다. 비용 경로는 quota 초과 시 외부 호출 전에 차단된다. 보안 헤더가 전 route에 있고 token route는 `no-referrer`다.
- **자동 검증**: boundary/race/TTL tests, 429 header tests, security header/CSP tests, provider fake의 호출 횟수 assertion
- **수동 검증**: 모바일 공유 IP/프록시 정상 사용자 시나리오, CSP에서 지도·폰트 로드 확인
- **보안·개인정보·운영 영향**: key에는 원 이메일/IP를 로그로 남기지 않고 keyed hash/사용자 ID를 쓴다. rate-limit deny 이벤트를 redacted metric으로 남긴다.
- **migration/rollback**: 정확 quota 테이블이 필요하면 새 migration. config flag로 route별 enforce/observe 전환하되 공개 환경의 전체 bypass는 금지한다.
- **사람/외부 게이트**: Cloudflare account 설정·WAF 증거는 보조층이며 코드 계약을 대체하지 않는다.

### S1-PR05 — 인증·토큰·메일·세션 hardening

- **의존/담당**: S1-PR00, S1-PR04 / Auth/Security owner
- **예상 파일**: `app/features/auth/account.server.ts`, `email.server.ts`, `login.server.ts`, `password.server.ts`, `session.server.ts`, `app/routes/login.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `verify-email.tsx`, `verify-correction.tsx`, auth tests
- **범위**: generic 인증 실패와 dummy KDF, 원자적 token consume, GET 무부작용, reset/exchange용 15분 단일 사용 token, 즉시 HttpOnly/SameSite 제한 세션 교환·clean redirect, password reset 전체 session revoke, 안전한 `returnTo`, 미사용 admin 우회 코드 제거를 구현한다. 이메일 인증·정정 token TTL은 사용 목적과 위험을 분리해 PRD-D03에서 정한다. PIN 방식은 PRD-D03이 선택한 경우에만 대체한다.
- **수용 기준**: 존재/미존재/미인증 계정 문구가 같고 실용적 timing 차이가 검출되지 않는다. 동시 token 요청 중 1개만 성공한다. prefetch GET은 상태를 바꾸지 않는다. reset 뒤 이전 session은 모두 401/redirect다. 외부 redirect는 거부한다.
- **자동 검증**: concurrency tests, fake clock expiry, session revocation, returnTo allowlist, GET side-effect regression, email snapshot/idempotency
- **수동 검증**: 승인된 test inbox에서 단일 저속 왕복 1회, browser history/referrer/clean URL 확인
- **보안·개인정보·운영 영향**: token·cookie·이메일 원문은 로그 금지. 메일 발송 실패는 사용자 열거 없이 재시도 가능해야 한다.
- **migration/rollback**: token 교환 세션/attempt 상태가 필요하면 새 migration. 배포 전 old/new token 호환 창을 정의하고 TTL 종료 후 구 경로를 제거한다. rollback 시 이미 발급된 token의 안전성을 유지한다.
- **사람/외부 게이트**: 인증 방식 ADR, 실제 이메일 1회 실행 승인, Resend 도메인 증거 필요

### S1-PR06 — 회원 탈퇴·보존·파기 실행

- **의존/담당**: S1-PR00, S1-PR01, S1-PR03 / Privacy Backend + Data
- **예상 파일**: `app/db/schema.ts`, 신규 `drizzle/0009_*`, 신규 account lifecycle service, `app/routes/me.tsx` 또는 신규 탈퇴 route, scheduled cleanup, privacy/account tests
- **범위**: PRD-D04에 따라 하드 삭제 또는 익명화를 구현한다. 세션·token 폐기, reviewer 상태, vote/suggestion/audit 행, 재가입, backup/log 만료를 항목별로 처리하고 failure/resume idempotency를 둔다.
- **수용 기준**: 투표 이력이 있는 계정도 정책대로 탈퇴된다. 탈퇴 즉시 세션이 무효화되고 식별 가능 필드는 정책대로 삭제/가명화된다. rating 불변식과 재가입 정책이 테스트된다. 만료 데이터 cleanup이 dry-run과 실행 결과 수를 남긴다.
- **자동 검증**: migration from current snapshot, FK matrix, lifecycle integration, idempotent retry, retention fake-clock tests, no-PII query snapshot
- **수동 검증**: 사용자 확인/취소/완료 UX, 관리자 감사 기록, 정책 문구와 실제 결과 대조
- **보안·개인정보·운영 영향**: 고위험·비가역 경로다. 재인증, CSRF/Origin, cooldown, 감사 이벤트, 최소 권한을 요구한다.
- **migration/rollback**: 기존 migration 수정 금지. additive 상태 필드/보존 작업을 먼저 배포하고 code enable은 이후다. 익명화/삭제된 원문은 rollback으로 복구하지 않는다. 기능 flag 중단과 forward-fix만 허용한다.
- **사람/외부 게이트**: 법률 승인·백업 보존 계약·복구 불가 고지 승인 없이는 실행 금지

### S1-PR07 — 공개 평가 소스 단일화

- **의존/담당**: S1-PR03 / Rating/Data owner
- **예상 파일**: `app/features/places/place.server.ts`, `app/features/ratings/recompute.server.ts`, `rating-badges.server.ts`, `app/features/maps/place-marker-policy.ts`, 공개 list/detail components, rating tests
- **범위**: 목록·지도·상세·discovery가 같은 유효 rating snapshot과 algorithm version을 사용하게 한다. 무효 vote 제외, snapshot 없는 장소 fallback 표시, A→B→A 재계산 최신성, stale 표시를 정합화한다.
- **수용 기준**: 같은 fixture에서 모든 화면 score/sample count/version이 동일하다. 무효화 후 공개 표면 전부 갱신된다. snapshot 없음과 stale 상태는 점수를 확정값처럼 표시하지 않는다.
- **자동 검증**: golden fixture cross-surface contract, invalidation, rollback vote, snapshot race/integrity tests
- **수동 검증**: 목록→지도→상세 왕복에서 같은 점수·표본·stale 문구 확인
- **보안·개인정보·운영 영향**: 평가 독립성과 조작 대응 신뢰의 핵심. 관리자도 계산값을 직접 수정하지 않는다.
- **migration/rollback**: 기본은 code/query 변경. backfill이 필요하면 별도 idempotent job과 snapshot version을 사용한다. 구 algorithm을 즉시 삭제하지 않고 비교/rollback 창을 둔다.
- **사람/외부 게이트**: rating algorithm owner가 fallback/stale copy를 승인

### S1-PR08 — 데이터 불변식·운영 mutation 정합성

- **의존/담당**: S1-PR03, S1-PR07 / Data + Domain Backend
- **예상 파일**: `app/db/schema.ts`, 신규 `drizzle/0010_*`, `place.server.ts`, `place-merge.server.ts`, `vote.server.ts`, `integrity.server.ts`, `bulk-review.server.ts`, `flavor-print.server.ts`, `place-detail.tsx`, tests
- **범위**: 장소당 primary category 1개, filtered bulk ID direct lookup, merge 시 모든 파생 데이터 이관·rating 재계산, 동일값 재투표 no-op, GET detail metric 무부작용, Flavor/category FK 검증, schema/migration drift를 닫는다.
- **수용 기준**: DB와 service 양쪽에서 primary 중복이 거부된다. merge 후 source/target 데이터 합계와 최신 rating이 맞다. 동일값 click은 event를 만들지 않는다. GET은 DB를 쓰지 않는다. integrity scan은 결정적 순서를 갖는다.
- **자동 검증**: migration/current production-shaped snapshot, property/invariant tests, concurrent import/merge/vote tests, GET no-write assertion
- **수동 검증**: admin filter/bulk/merge 실패·재시도 UX와 audit log 확인
- **보안·개인정보·운영 영향**: 관리자 mutation은 authz, idempotency, before/after audit를 요구한다.
- **migration/rollback**: 새 partial unique index 전 duplicate dry-run·repair report를 만든다. destructive repair는 사람 승인 후 별도 작업. rollback은 index 제거보다 code forward-fix를 우선한다.
- **사람/외부 게이트**: duplicate repair 대상 목록과 merge 책임자의 승인 필요

### S1-PR09 — 민감 로그 redaction·관측·알림·감사 조회

- **의존/담당**: S1-PR01, S1-PR03 / SRE/Platform + Privacy
- **예상 파일**: `workers/app.ts`, `wrangler.jsonc`, 신규 observability/redaction module, `app/features/operations/alerts.server.ts`, `dashboard.server.ts`, `app/routes/admin-operations.tsx`, 신규 admin audit route, tests/runbook
- **범위**: query/body/header allowlist 기반 structured log, token/email/bbox/좌표 redaction, route template만 기록, correlation/deployment ID를 도입한다. scheduled job을 개별 격리하고 내부 alert + 승인된 외부 통지 adapter를 둔다. 관리자 감사 로그 조회/필터/보존을 구현한다.
- **수용 기준**: synthetic canary secret/좌표가 어떤 log에도 나오지 않는다. 한 cron 실패가 다른 작업을 막지 않고 5분 안에 alert를 만든다. alert 전달 실패도 별도 기록된다. 감사 조회는 admin만 접근하고 pagination이 있다.
- **자동 검증**: redaction property tests, scheduled partial-failure, alert adapter fake, audit authz/pagination tests
- **수동 검증**: staging log sample·alert 수신·acknowledge·escalation drill, access review
- **보안·개인정보·운영 영향**: 관측성이 새로운 개인정보 저장소가 되지 않게 retention/access를 인벤토리에 포함한다.
- **migration/rollback**: alert/audit 상태가 필요하면 새 migration. 외부 통지 adapter는 disable 가능하되 내부 기록은 항상 유지한다.
- **사람/외부 게이트**: 알림 수신자/on-call, 로그 보존 기간, Cloudflare 실제 필드 확인 필요

### S1-PR10 — D1 query·index·핫패스 용량

- **의존/담당**: S1-PR07, S1-PR08, S1-PR09 / Performance + Data
- **예상 파일**: `app/features/places/place.server.ts`, `place-discovery.server.ts`, rating/integrity queries, route `shouldRevalidate`, 신규 `drizzle/0011_*`, query benchmark tests
- **범위**: 공개 list에서 raw vote aggregation 제거, 중복 `listPlaces` 호출 제거, bbox/category query 정합화, `vote_events(created_at, ...)` 등 실측 기반 index, 결정적 scan/order, 불필요 재검증 제거를 수행한다. 캐시/복제는 먼저 측정한 뒤 필요할 때만 도입한다.
- **수용 기준**: 100k vote fixture에서 공개 list가 raw event 전량을 스캔하지 않는다. 상위 query가 의도한 index를 사용한다. 각 route의 D1 query 수·rows read budget을 snapshot으로 고정하고 10% 초과 회귀를 실패시킨다.
- **자동 검증**: `EXPLAIN QUERY PLAN`, fixture benchmark, query-count/rows-read contract, correctness parity tests
- **수동 검증**: 100/200/300 synthetic smoke에서 D1 dashboard/metrics 대조
- **보안·개인정보·운영 영향**: 사용자별 캐시 혼합 금지, cache key에 권한/locale/query를 포함하고 민감 응답은 공유 cache 금지
- **migration/rollback**: index는 새 migration과 `PRAGMA optimize` 계획을 포함한다. 쓰기 비용/지연 악화 시 새 forward migration으로 제거하며 기존 migration은 수정하지 않는다.
- **사람/외부 게이트**: staging D1 metric 접근 권한 필요; 원격 실행은 S1-PR17 이후

### S1-PR11 — deterministic 부하 fixture·k6 OSS harness

- **의존/담당**: S1-PR02, S1-PR10 / Performance QA
- **예상 파일**: 신규 `tests/performance/scenarios/*.js`, `tests/performance/workloads/*.json`, `scripts/seed-stage1-capacity.*`, fixture manifest/checksum, `package.json`, 성능 README
- **범위**: §5.1 사용자 mix, 100/200/300 ramp, 150 CCU soak, route별 threshold, auth pool, think time, unique data, abort 조건을 tests-as-code로 만든다. protocol 부하와 소수 browser journey를 분리한다.
- **수용 기준**: 최대 VU가 300을 넘지 않고 외부 host allowlist가 앱 staging 외 모든 호출을 차단한다. seed checksum과 script SHA가 report에 기록된다. threshold 실패 시 non-zero exit다.
- **자동 검증**: 1 VU smoke, fake server threshold failure, host deny, seed idempotency/checksum, metrics schema test
- **수동 검증**: load generator 자체 CPU/네트워크 여유 확인, 대표 journey와 실제 화면 행동 대조
- **보안·개인정보·운영 영향**: synthetic 계정만 사용하고 secret은 CI/staging secret으로 주입한다. 실제 이메일·AI·Maps 호출은 fake다.
- **migration/rollback**: isolated staging DB seed/cleanup만 수행. fixture 삭제는 명시된 prefix/manifest 대상으로 제한한다.
- **사람/외부 게이트**: k6 OSS 로컬/자체 runner만 사용. paid cloud load lane은 별도 승인 없이는 금지

### S1-PR12 — 외부 서비스 격리·재시도·kill switch

- **의존/담당**: S1-PR00, S1-PR03, S1-PR04 / Integrations owner
- **예상 파일**: `app/features/auth/email.server.ts`, `naver-map-sdk.ts`, AI/sync scheduled modules, 신규 provider adapter/config, routes의 degraded state, tests
- **범위**: NAVER/Resend/Workers AI/공공데이터를 adapter 경계로 감싸 timeout, bounded retry+jitter, idempotency, circuit/kill switch, quota 상태, degraded UX를 통일한다. 이메일 DB insert와 발송 실패가 고아 상태를 만들지 않게 outbox/상태 전이를 설계한다.
- **수용 기준**: provider timeout/429/5xx에서 무한 재시도·중복 메일·중복 mutation이 없다. NAVER SDK는 세션 내 retry 가능하다. AI/데이터 sync가 꺼져도 public read는 유지된다. 메일 미설정 시 내부 error code와 고아 행이 없다.
- **자동 검증**: fake provider timeout/429/duplicate/idempotency, circuit transition, SDK retry, no-network integration tests
- **수동 검증**: 각 provider off/slow/quota-exceeded 화면과 운영 alert 확인
- **보안·개인정보·운영 영향**: provider payload 최소화·redaction, API key 서버 경계, fail-closed 관리자/비용 작업
- **migration/rollback**: outbox/state table이면 새 migration. adapter는 provider별 kill switch로 rollback하고 pending 작업 replay 절차를 둔다.
- **사람/외부 게이트**: 실제 provider contract test, quota/요금 변경, 메일 발송은 별도 승인

### S1-PR13 — 공통 접근성·디자인 토큰 기반

- **의존/담당**: S1-PR03 / Frontend Design System + Accessibility reviewer
- **예상 파일**: 신규 공통 `Sheet`, `FormField`, `StatusPanel`, `Button/Link` components, `app/root.tsx`, `app/app.css`, 관련 routes/components, E2E a11y tests
- **범위**: focus trap/복원/inert/Escape, error ARIA wiring, skip-link 대상, touch target, 확인된 대비 2건, semantic color/spacing/type token, reduced-motion, 9–11px text, dead CSS를 작게 분리해 정리한다.
- **수용 기준**: WCAG 2.2 AA 자동 규칙 위반 0건(known exception은 owner/date 포함), keyboard-only 핵심 journey 완료, 주 navigation·control 24×24px 이상, 두 확인 대비 ≥4.5:1, motion off에서 비필수 animation 0건이다.
- **자동 검증**: axe/Playwright, focus order/trap, contrast/token lint, reduced-motion, visual regression
- **수동 검증**: keyboard, VoiceOver, 200% zoom/reflow, 375/768/1440 사람 검수
- **보안·개인정보·운영 영향**: 없음에 가깝지만 오류 panel에 내부 error/PII를 노출하지 않는다.
- **migration/rollback**: 없음. 공통 primitive 전환은 route 단위로 하고 회귀 시 해당 route만 revert한다.
- **사람/외부 게이트**: 독립 accessibility/design reviewer 승인 필요

### S1-PR14 — 오류·빈·권한·오프라인·모바일 상태

- **의존/담당**: S1-PR03, S1-PR13 / Product Frontend + QA
- **예상 파일**: `app/root.tsx`, route별 ErrorBoundary/pending UI, `signup.tsx`, `login.tsx`, `map-category.tsx`, `PlaceDetailSheet.tsx`, `app.css`, E2E specs
- **범위**: 29개 route state inventory를 계약 테스트로 만들고 loading/empty/401/403/404/429/5xx/offline/retry/stale를 구분한다. 로그인 context, signup form 보존, dead “내 주변”, URL state 보존, 모바일 sheet를 수정한다. ARC-02는 먼저 재현한다.
- **수용 기준**: 사용자 action 실패가 전역 generic 500으로 떨어지지 않는다. 폼 값·focus·context가 보존된다. offline에서 읽기 캐시를 거짓 최신값으로 표시하지 않고 mutation은 명시적으로 실패/재시도한다. 375px에서 가려진 focus target과 viewport overflow가 없다.
- **자동 검증**: route-state matrix E2E, network offline/timeout, auth redirect, URL state, ARC-02 reproduce-first regression
- **수동 검증**: 375/768/1440 주요 journey, 저속 3G, rotate/zoom, Android/iOS 실제 또는 동등 브라우저 확인
- **보안·개인정보·운영 영향**: error copy는 내부 코드/stack/path를 숨기고 429는 대기 시간을 안내한다.
- **migration/rollback**: 없음. ARC-02가 재현되지 않으면 추측 수정 없이 증거로 닫는다.
- **사람/외부 게이트**: Product owner가 상태 copy와 offline 범위를 승인

### S1-PR15 — 브랜드·공유·최소 탐색성

- **의존/담당**: S1-PR00, S1-PR13 / Product/Content + Frontend
- **예상 파일**: `README.md`, `app/root.tsx`, 공개 route meta, 신규 `public/robots.txt`, sitemap route/file, JSON-LD helpers, specs/legal docs
- **범위**: 확정 서비스명·법적 표기명을 코드/문서에서 일치시키고, route별 unique title/description/canonical/OG, 장소 JSON-LD, sitemap/robots, 정확히 한 H1을 제공한다. 공개되지 않은/admin/auth 페이지는 index 정책을 분리한다.
- **수용 기준**: 서비스명 충돌 0건, 공개 URL마다 canonical·고유 title, 장소 공유 preview에 상호/지역/이미지 fallback이 있다. sitemap에는 200·canonical·indexable URL만 있다.
- **자동 검증**: metadata snapshot, sitemap/robots/link status, structured data schema, duplicate title test
- **수동 검증**: 승인된 preview 도구 또는 로컬 HTML 검사, 카카오톡 등 실제 외부 공유 검증은 별도 승인
- **보안·개인정보·운영 영향**: 미공개/admin/user URL과 정확 위치·개인정보를 sitemap/metadata에 넣지 않는다.
- **migration/rollback**: 없음. brand 변경은 superseding ADR과 전수 search evidence를 요구한다.
- **사람/외부 게이트**: 서비스명/도메인/공개 index 범위 승인 필요

### S1-PR16 — 배포·migration·rollback·incident 런북

- **의존/담당**: S1-PR01~15 / SRE + Release manager
- **예상 파일**: `docs/operations/cloudflare-deploy.md`, `week1-data-runbook.md`, `ai-operations-runbook.md`, 신규 `incident-response.md`, `rollback-and-d1-recovery.md`, release checklist/scripts
- **범위**: 운영 QA seed 지시 제거, 실제 env/secret 목록 동기화, `pnpm run deploy` 표기, immutable version·approval·smoke·rollback, migration expand/contract, D1 Time Travel, incident severity/연락/사후 분석을 문서화한다.
- **수용 기준**: 신규 운영자가 문서만으로 dry-run을 수행하고 위험 명령 전에 대상 account/env/DB를 확인한다. Worker rollback과 D1 restore가 분리돼 있고 RTO/RPO 측정 절차가 있다. runbook과 코드 상수 drift test가 있다.
- **자동 검증**: command/path/env linter, remote/QA seed 금지 검사, dry-run script, runbook link test
- **수동 검증**: tabletop incident, Worker rollback rehearsal, D1 backup/bookmark/restore rehearsal(격리 DB)
- **보안·개인정보·운영 영향**: secret 값은 문서/출력에 쓰지 않고 이름과 회전 절차만 기록한다. 파괴적 명령은 정확 대상과 사람 승인 필요.
- **migration/rollback**: 모든 미래 migration에 precheck, backup/bookmark, forward-fix, compatibility window를 의무화한다.
- **사람/외부 게이트**: incident commander, on-call, Cloudflare 계정 권한자 승인

### S1-PR17 — 격리 commercial staging·비용 상한

- **의존/담당**: S1-PR00, S1-PR03, S1-PR16 / Platform + Finance/Owner
- **예상 파일**: `wrangler.jsonc`의 명시적 staging env 또는 신규 staging config, staging deploy workflow, env inventory, cost dashboard/runbook; 비밀값은 저장소 밖
- **범위**: production과 다른 Worker/D1/domain/secret/alert를 가진 staging을 정의한다. preview는 production traffic을 받지 않고 migration/seed가 staging DB만 대상으로 한다. §5 비용 ceiling, CPU limit, NAVER 일·월 hard limit/알림, Resend overage, AI quota/kill switch를 설정한다.
- **수용 기준**: config diff가 production resource ID를 참조하지 않는다. 비용 50/80/100% 경보와 80% 자동/수동 중단 절차가 있다. 외부 호출은 기본 off이며 contract-test window에서만 켠다.
- **자동 검증**: env/resource ID isolation, no-prod-domain, secret-name completeness, deployment dry-run, budget policy contract
- **수동 검증**: Cloudflare/NAVER/Resend dashboard screenshot 또는 export, alert recipient test, least-privilege access review
- **보안·개인정보·운영 영향**: synthetic data only, Access/IP 제한, production secret/PII 복제 금지
- **migration/rollback**: staging migration을 fresh와 current snapshot 양쪽에서 rehearsing. 실패 시 staging Worker rollback 후 DB forward-fix/격리 restore.
- **사람/외부 게이트**: 실제 리소스 생성·유료 플랜·배포·알림 테스트는 명시적 승인과 비용 owner 필요

### S1-PR18 — 100/200/300 CCU 인증과 출시 판정

- **의존/담당**: S1-PR04~17 전부 / Independent QA + SRE + Product approver
- **예상 파일**: 신규 `docs/evidence/product-ready-stage1/<date>/`의 manifest, test summaries, redacted dashboard evidence, release decision; 제품 코드는 원칙적으로 변경하지 않음
- **범위**: 1 VU smoke → 90분 인증 3회 연속 → 150 CCU 2h soak → 375/768/1440 사람 검수 → alert/rollback/restore drill → 법무·운영 외부 증거를 모은다.
- **수용 기준**: §5 SLO/비용/중단 기준과 §8 Definition of Done을 모두 통과한다. 실패 결과를 삭제하거나 threshold를 낮추지 않는다. 실패 원인은 별도 작은 수정 PR 후 처음부터 연속 통과 수를 다시 센다.
- **자동 검증**: k6 threshold, data invariant post-check, CI latest SHA, artifact checksum, evidence manifest completeness
- **수동 검증**: 독립 reviewer가 실제 화면·log·dashboard·runbook drill을 확인하고 Product/Legal/SRE가 각자 승인
- **보안·개인정보·운영 영향**: synthetic staging만 사용, 외부 provider 부하는 금지, 증거 redaction 필수
- **migration/rollback**: 인증 중 migration 금지. 중단 기준 발생 시 §5.5 절차를 실행하고 결과를 보존한다.
- **사람/외부 게이트**: 최종 판정은 `GO / CONDITIONAL GO / HOLD / NO-GO` 중 하나로 명시. 자동 PASS만으로 GO 금지

---

## 8. Stage 1 완료 정의와 승인 게이트

### 8.1 기술 완료

- [ ] S1-PR00~18이 모두 최신 `main` 기준으로 완료됐고 required checks가 최신 SHA에서 통과했다.
- [ ] PR #42의 55개 고유 finding이 §9에서 하나의 primary PR과 검증 증거를 갖는다.
- [ ] 확인된 High/Medium 보안·개인정보·데이터 정합성 결함이 0건이다.
- [ ] Low/가설 항목은 `검증 후 비결함`, `수정 완료`, `사람이 승인한 잔여 위험(owner/date/expiry 포함)` 중 하나다.
- [ ] unit/integration/E2E가 격리 환경에서 연속 2회 재현되고 외부/운영 binding 호출이 0건이다.
- [ ] 실제 공개 데이터 300곳의 provenance·검수 상태와 synthetic capacity fixture가 분리돼 있다.

### 8.2 보안·정책 완료

- [ ] 약관·개인정보처리방침·위탁/국외 이전·위치·탈퇴·보존 정책이 실제 구현과 일치한다.
- [ ] 인증/인가/rate limit/token/session/CSRF/Origin/보안 헤더/secret rotation 검증이 통과한다.
- [ ] token, cookie, password, 이메일 원문, 정확 bbox/좌표가 log와 evidence artifact에 0건이다.
- [ ] 탈퇴·파기와 재가입을 synthetic 계정으로 end-to-end 검증했다.
- [ ] Legal/Privacy가 저장소 근거와 외부 계약 근거를 각각 승인했다.

### 8.3 접근성·제품 완료

- [ ] 375/768/1440px에서 핵심 Guest/User/Reviewer/Admin journey를 사람이 검수했다.
- [ ] keyboard-only와 VoiceOver 핵심 journey를 완료하고 WCAG 2.2 AA 자동 위반이 없다.
- [ ] loading/empty/error/401/403/404/429/5xx/offline/stale 상태가 route-state matrix와 일치한다.
- [ ] 승인된 browser staging lab 검사가 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1이고, 접근 통제된 실사용 pilot의 합의된 최소 표본에서 p75도 같은 기준을 충족한다. 실사용 표본이 부족하면 synthetic 결과만으로 최종 GO를 선언하지 않고 `외부 증거 대기`로 표시한다.
- [ ] 서비스명, 공개 metadata, 정책 표기, 문의 채널이 일치한다.

### 8.4 운영·용량 완료

- [ ] 90분 100→200→300 CCU run 3회 연속과 150 CCU 2시간 soak가 모두 §5 계약을 통과했다.
- [ ] Stage 1 정상 workload에서 load-induced 429가 0건이고 abuse test 429는 계약대로 발생한다.
- [ ] alert detect ≤5분, 사람 acknowledge ≤15분, Worker rollback ≤15분을 drill로 입증한다.
- [ ] Stage 1 서비스 RTO 권고 ≤60분, D1 RPO 권고 ≤15분을 격리 복구 훈련으로 입증하거나 더 보수적인 승인값으로 수정한다.
- [ ] 월/회차 비용 ceiling, 50/80/100% 알림, 80% 중단 절차가 owner와 함께 확인됐다.
- [ ] Sev1/Sev2 미해결 0건, 데이터 불변식 실패 0건, rollback/restore 미검증 0건이다.

### 8.5 사람 승인 매트릭스

| 승인자 | 반드시 보는 증거 | 거부 시 상태 |
|---|---|---|
| Product owner | 기존 목표 매핑, 300곳 데이터, UX state, 서비스명 | HOLD |
| Legal/Privacy | 약관·방침·위치·미성년자·위탁·탈퇴/보존 | NO-GO 또는 HOLD |
| Security reviewer | auth/rate limit/token/log/secret/dependency evidence | NO-GO |
| Data/Rating owner | rating source, invariants, migration/rollback | HOLD |
| Accessibility/Design reviewer | 3폭, keyboard/VoiceOver, AA, mobile states | HOLD |
| SRE/Platform | SLO, alert, runbook, cost, rollback/restore, 300 CCU | NO-GO 또는 HOLD |
| Final release owner | 위 승인과 잔여 위험 register | 최종 GO 권한 |

---

## 9. PR #42 55개 finding coverage matrix

각 ID는 primary 처리 하나만 가진다. 다른 PR의 연관 작업은 중복 집계하지 않는다. `가설`은 재현 전 코드 수정 금지다.

### 9.1 Security 15건

| ID | 최신 기준 분류 | Primary | 종료 증거 |
|---|---|---|---|
| SEC-01 | 확인(방어 부재), 피해 규모 추론 | S1-PR04 | route별 429/Retry-After·quota·CPU/cost metric |
| SEC-02 | 확인(임의 메일 경로), 피해 규모 추론 | S1-PR04 | actor/email quota·중복 억제·provider fake call count |
| SEC-03 | 확인 + 감사 처방 모순 정정 | S1-PR05 | 원자적 token·no-referrer·clean redirect·URL/log 검사 |
| SEC-04 | 데이터 흐름 확인, 규제 적용 외부 판단 | S1-PR09 | bbox/token log 0건 + S1-PR01 고지 일치 |
| SEC-05 | 탈퇴 미구현 확인, “구현 불가” 정정 | S1-PR06 | 정책별 탈퇴/세션폐기/재가입 E2E |
| SEC-06 | 인벤토리 누락 확인 | S1-PR01 | schema/provider/log field 100% inventory |
| SEC-07 | reset 후 세션 유지 확인 | S1-PR05 | 이전 session 전량 무효화 test |
| SEC-08 | token consume 비원자성 확인 | S1-PR05 | 동시 요청 1건만 성공 |
| SEC-09 | 보안 헤더 부재 확인 | S1-PR04 | CSP/HSTS/referrer/frame/header contract |
| SEC-10 | 계정 열거 문구·경로 확인 | S1-PR05 | generic response + dummy KDF timing test |
| SEC-11 | GET detail metric write 확인 | S1-PR08 | GET no-write assertion |
| SEC-12 | dev-only advisory 확인 | S1-PR03 | 도달성 기록 + audit/update 결과 |
| SEC-13 | 미사용 admin 우회 코드 확인 | S1-PR05 | dead privileged path 제거 + reference test |
| SEC-14 | test 고정 admin session 확인 | S1-PR02 | 격리 env/unique session fixture |
| SEC-15 | Flavor/category 검증 공백 확인 | S1-PR08 | FK/domain invariant test |

### 9.2 Architecture/Data 12건

| ID | 최신 기준 분류 | Primary | 종료 증거 |
|---|---|---|---|
| ARC-01 | 확인 | S1-PR07 | 모든 공개 surface 동일 snapshot contract |
| ARC-02 | **가설·미재현** | S1-PR14 | reproduce-first E2E 후 fix 또는 비결함 증거 |
| ARC-03 | 확인 | S1-PR08 | primary unique constraint + re-import test |
| ARC-04 | 확인 | S1-PR07 | A→B→A 최신 snapshot test |
| ARC-05 | 확인 | S1-PR08 | selected ID direct lookup + >300 count test |
| ARC-06 | 확인 | S1-PR08 | merge 보존 합계 + recompute test |
| ARC-07 | 확인 | S1-PR14 | domain error inline/route boundary test |
| ARC-08 | 확인 | S1-PR08 | same-value vote no-op test |
| ARC-09 | 확인 | S1-PR10 | bbox count/result parity + query budget |
| ARC-10 | 확인 | S1-PR12 | NAVER SDK retry/recovery test |
| ARC-11 | 확인 | S1-PR05 | GET side-effect 0 + POST/exchange test |
| ARC-12 | 확인 | S1-PR08 | schema/migration contract parity |

### 9.3 Quality 10건

| ID | 최신 기준 분류 | Primary | 종료 증거 |
|---|---|---|---|
| QLT-01 | 환경/fixture 불일치로 확인 | S1-PR02 | 병렬 worktree + 연속 2회 E2E |
| QLT-02 | CI 부재 확인 | S1-PR03 | required workflow/check 최신 SHA 통과 |
| QLT-03 | insert-before-email-check 확인 | S1-PR12 | provider 실패 시 고아 행/내부 코드 0 |
| QLT-04 | 외부 통지 부재 확인 | S1-PR09 | cron partial failure·5분 내 alert drill |
| QLT-05 | production wrangler 재사용 확인 | S1-PR02 | test config에 prod ID/AI binding 0 |
| QLT-06 | remote QA seed 런북 지시 확인 | S1-PR16 | remote seed 금지 lint + 정정 runbook |
| QLT-07 | AI/runbook 수치 drift 확인 | S1-PR16 | 코드 상수/runbook contract test |
| QLT-08 | secret 목록 drift 확인 | S1-PR16 | env inventory와 runbook 일치 |
| QLT-09 | coverage 부재 확인 | S1-PR03 | baseline·핵심 모듈 branch threshold |
| QLT-10 | deploy 명령/packageManager 공백 확인 | S1-PR03 | 고정 pnpm/Node + 검증된 명령 |

### 9.4 UX 15건

| ID | 최신 기준 분류 | Primary | 종료 증거 |
|---|---|---|---|
| UX-01 | 확인 | S1-PR14 | safe returnTo와 action context E2E |
| UX-02 | 확인 | S1-PR14 | signup 오류 후 form/value/focus 보존 |
| UX-03 | 확인 | S1-PR15 | canonical/OG/sitemap/JSON-LD/share 검사 |
| UX-04 | 확인 | S1-PR13 | focus trap/Escape/restore/inert E2E |
| UX-05 | 확인 | S1-PR13 | aria-invalid/describedby/alert test |
| UX-06 | 확인 | S1-PR14 | 403 전용 state E2E |
| UX-07 | 확인 | S1-PR14 | 내 주변 동작 + URL state 보존 |
| UX-08 | **selector 증거 2건 확인** | S1-PR13 | 두 조합 AA + 전수 contrast scan |
| UX-09 | 확인 | S1-PR15 | route당 H1 정확히 1개 |
| UX-10 | 확인 | S1-PR13 | 모든 main skip target contract |
| UX-11 | 확인 | S1-PR13 | semantic token 사용·새 raw value lint |
| UX-12 | 확인 | S1-PR13 | 공통 status primitive 단일화 |
| UX-13 | 확인 | S1-PR13 | 최소 type/touch 기준 visual test |
| UX-14 | 확인 | S1-PR13 | reduced-motion 전수 test |
| UX-15 | 확인 | S1-PR13 | dead code/CSS 제거 + reference/build test |

### 9.5 Documentation 3건

| ID | 최신 기준 분류 | Primary | 종료 증거 |
|---|---|---|---|
| DOC-01 | 서비스명 충돌 확인 | S1-PR15 | 승인 ADR + 코드/법무/문서 전수 일치 |
| DOC-02 | 감사 로그 조회 부재 확인 | S1-PR09 | admin-only pagination/filter/audit test |
| DOC-03 | 인증 방식 3중 충돌 확인 | S1-PR00 | superseding 인증 ADR + 후속 문서 링크 |

집계: SEC 15 + ARC 12 + QLT 10 + UX 15 + DOC 3 = **55개 고유 ID**.

---

## 10. Stage 2–4 후속 확장 로드맵

### Stage 2 — 301–700 CCU

- Stage 1 실제 운영 14일의 route mix, cache hit, D1 rows read, provider usage로 workload를 다시 계산한다.
- 700 CCU를 위해 먼저 query 수와 직렬 D1 점유 시간을 줄인다. read replication, 캐시, Queue/Durable Object, DB 분리는 측정된 병목이 있을 때 ADR로 선택한다.
- 120분 load 3회와 500 CCU 4시간 soak를 통과하고, 실제 운영 30일 동안 Sev1/2와 SLO breach가 없어야 종료한다.
- 기존 제품 계획에서는 reviewer 활성화·광주 데이터 신뢰·초기 개인화의 완료 조건을 함께 추적하되 CCU 통과로 기능 완료를 대신하지 않는다.

### Stage 3 — 701–1,200 CCU

- Stage 2 종료 후 단일 D1의 평균/최악 query service time과 queue/overload 증거를 architecture review에 제출한다.
- region/cache consistency, background recompute/sync 격리, provider circuit, alert noise, on-call 교대를 보강한다.
- 150분 load 3회, 900 CCU 8시간 soak, 장애 중 degraded read와 데이터 복구 drill을 통과한다.
- 기존 제품 계획의 이미지·개인화·B2B 준비가 이 단계에 들어올 수 있으나 계약·평가 독립성·이미지 권리 gate를 별도로 통과해야 한다.

### Stage 4 — 1,201–2,000 CCU

- 2,000 CCU가 단일 장애 도메인에 집중되지 않도록 Worker/D1/provider별 blast radius와 공급자 계약 상한을 최종 검토한다.
- 180분 load 3회, 1,500 CCU 24시간 soak, on-call 교대, budget/alert/rollback/restore 전 과정을 실행한다.
- 2,000 CCU에서 SLO·비용·데이터 불변식을 동시에 만족해야 하며, 목표 달성을 위해 보안·개인정보·평가 독립성 기준을 낮출 수 없다.
- B2B·전남·앱·전국 확장은 기존 제품 phase의 사람 승인과 별도 release gate가 필요하다. Stage 4 통과만으로 그 기능들을 출시 승인하지 않는다.

---

## 11. 검증·보고 형식

각 S1 PR은 본문에 다음 표를 남긴다.

| 필드 | 필수 내용 |
|---|---|
| 기준선 | base/head SHA, env, fixture manifest, 관련 ADR |
| 변경 | 변경 파일·migration·config·외부 설정 |
| 자동 증거 | 명령, 결과, artifact/checksum, 실패/skip 수 |
| 수동 증거 | viewport/device, 역할, 관찰 결과, reviewer |
| 보안/개인정보 | trust boundary, log/redaction, retention, secret 영향 |
| 운영/비용 | metric, alert, quota, 예상/실제 비용 |
| migration/rollback | precheck, compatibility, rollback/forward-fix, drill |
| 잔여 위험 | owner, due date, release blocking 여부 |
| 판정 | GO / CONDITIONAL GO / HOLD / NO-GO |

자동 테스트 PASS, HTTP 200, process 존재, dashboard 한 장, 오래된 감사 보고서만으로 GO를 선언하지 않는다. 외부 증거가 없으면 `미확인`으로 남기고 HOLD를 유지한다.

---

## 12. 공식 근거

### 법·정책

- [개인정보 보호법 제21조 — 개인정보의 파기](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?ancYnChk=&chrClsCd=010202&lsJoLnkSeq=1020398651)
- [개인정보 보호법 제30조 — 개인정보 처리방침의 수립 및 공개](https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1020398435)
- [개인정보 보호법 제37조 — 처리정지 등](https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900079171)
- [개인정보 보호법 제22조의2 — 14세 미만 아동](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?ancYnChk=&chrClsCd=010202&lsJoLnkSeq=1029334873)
- [개인정보 보호법 제28조의8 — 개인정보의 국외 이전](https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334953)
- [위치정보법상 위치정보 정의](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?ancYnChk=&chrClsCd=010202&lsJoLnkSeq=1019949935)
- [개인정보보호위원회 2026 개인정보 처리방침 작성지침 개정안 행정예고](https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS061&mCode=C010010000&nttId=11977) — 확정본이 아닌 참고 초안

### 보안·플랫폼·용량

- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare D1 metrics and analytics](https://developers.cloudflare.com/d1/observability/metrics-analytics/)
- [Cloudflare D1 index best practices](https://developers.cloudflare.com/d1/best-practices/use-indexes/)
- [Cloudflare Workers logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Cloudflare Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
- [Grafana k6 website load testing guide](https://grafana.com/docs/k6/latest/testing-guides/load-testing-websites/)
- [Grafana k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
- [GitHub required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)

### 접근성·외부 공급자

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- [NAVER Cloud Maps usage limits and notifications](https://guide.ncloud-docs.com/docs/en/application-maps-app-vpc/)
- [NAVER Maps API status codes](https://api.ncloud-docs.com/docs/en/ainaverapi-maps-overview)
- [Resend usage limits](https://resend.com/docs/api-reference/rate-limit)
- [Resend account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

---

## 13. 이 계획 문서 자체의 완료 조건

- [x] `AGENTS.md`, `COWORK.md`, 기존 specs/plans/decisions를 먼저 검토했다.
- [x] PR #42 감사 문서와 public conversation, 독립 검수의 미해결 모순을 반영했다.
- [x] 최신 `main@8e8503b`에서 핵심 사실을 재검증했다.
- [x] 기존 목표를 삭제하지 않고 누락·중복·충돌·보존 관계를 매핑했다.
- [x] 4단계 CCU 구간, 각 단계 진입/종료/SLO/p95/p99/오류율/시간/데이터/관측/비용/롤백을 제시했다.
- [x] 실제 1차 범위를 100–300 CCU로 제한하고 301–2,000 CCU를 후속 로드맵으로 분리했다.
- [x] Stage 1을 작은 PR 단위와 의존 관계·파일·수용·검증·영향·migration/rollback·사람 gate로 분해했다.
- [x] PR #42의 55개 고유 finding을 누락 없이 coverage matrix에 매핑했다.

이 체크는 **계획 문서 작성 완료**만 뜻한다. 어떤 제품 구현, 외부 계정 설정, 유료 실행, 배포, 300 CCU 달성도 뜻하지 않는다.
