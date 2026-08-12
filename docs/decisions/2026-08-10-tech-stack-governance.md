# Re:Taste Tech Stack 가이드라인 및 변경 거버넌스

- **상태:** PROPOSED — 사람 승인과 PR 병합 시 ACCEPTED
- **작성일:** 2026-08-10
- **기준선:** `origin/main@9c5a3d5`
- **추적:** [GitHub Issue #74](https://github.com/taejunyun1/Tasted_it/issues/74)
- **적용 범위:** 현재 웹 베타, Product-ready Stage 1(100–300 CCU), 그 이후의 기술 스택 변경 제안

## 1. 결정 요약

Re:Taste는 현재 기반 스택을 유지하고 전면 재작성하지 않는다. 다만 설치되어 있거나 이미 구현됐다는 이유만으로 그 기술의 추가 확장을 자동 승인하지 않는다.

1. 신규 기능은 먼저 현재 스택으로 해결한다. 새 프레임워크·저장소·외부 공급자·인증 방식은 기본값이 `HOLD`다.
2. 하나의 문제에는 하나의 기본 기술만 둔다. 같은 역할의 ORM, 검증기, 라우터, 테스트 러너, CSS 체계, 상태 관리 도구를 병행하지 않는다.
3. 외부 서비스와 영속 데이터 구조는 라이브러리보다 높은 승인 게이트를 적용한다. 비용, 개인정보, 장애, 데이터 보존, 종료 가능성까지 함께 검토한다.
4. 성능 확장은 추측이 아니라 측정된 병목으로 시작한다. 300 CCU 기준선 전에는 두 번째 데이터베이스, 캐시, Queue, Durable Object 또는 검색 엔진을 선제 도입하지 않는다.
5. 이 문서는 기존 제품 목표를 폐기하거나 Product-ready 계획의 `HOLD` 항목을 구현 승인으로 바꾸지 않는다.

## 2. 문서 권위와 관계

충돌 시 다음 순서로 판단한다.

1. `AGENTS.md`, `COWORK.md`, 명시적인 사람 결정
2. 승인된 제품 원칙과 ADR
3. 이 문서의 기술 선택·변경 규칙
4. 최신 코드와 불변 migration이 보여 주는 현재 구현 사실
5. 개별 spec·plan·audit의 아직 승인되지 않은 권고

승인 방식과 승인 기록의 단일 기준 원본은 [`2026-08-12-pr-merge-approval-ssot.md`](./2026-08-12-pr-merge-approval-ssot.md)를 따른다. 이 문서에서 요구하는 Product, Tech, Data, Security, Privacy, Operations 승인은 해당 역할 또는 위임 권한을 가진 담당자가 필수 증거와 실행 범위를 포함한 Pull Request를 병합하는 것으로 충족한다. 병합 후 같은 범위의 별도 채팅 승인을 다시 요청하지 않는다.

`docs/superpowers/specs/2026-08-05-retaste-master-design.md`의 제품 목표와 비협상 원칙은 유지한다. 그 문서에 나온 Better Auth, R2, Cloudflare Images, Queue 등 목표 기술은 실제 도입 PR과 ADR 없이 현재 스택으로 간주하지 않는다.

`docs/superpowers/plans/2026-08-07-product-ready-stage-1-100-300-ccu.md`는 `PROPOSED / HOLD` 상태다. 이 가이드는 해당 계획의 안전·운영 게이트를 재사용하지만, 계획 자체를 승인하거나 2,000 CCU 구현을 시작하지 않는다.

## 3. 현재 기준선

아래 수치는 `origin/main@9c5a3d5`의 복잡도 스냅샷이다. 품질 목표나 강제 상한이 아니며, 기술 변경 전후의 증가 폭을 설명하기 위한 기준이다.

| 항목 | 현재 값 |
|---|---:|
| 직접 런타임 의존성 | 9개 |
| 직접 개발 의존성 | 14개 |
| 앱 라우트 | 36개 |
| SQLite/D1 테이블 | 49개 |
| SQL migration | 24개 |
| `app/features` 파일 | 107개 |
| `tests` 디렉터리 파일 | 137개 |

직접 패키지 수 자체는 과도하지 않다. 현재 위험은 기능 도메인, 외부 공급자, 인증 경로, 배치 작업과 영속 테이블의 증가 속도가 테스트 격리·CI·정책·관측·롤백 기반보다 빠르다는 데 있다.

## 4. 기술 선택 원칙

### 4.1 제품 문제 우선

- 기술 이름이 아니라 사용자 문제, 운영 문제 또는 검증된 성능 병목부터 기록한다.
- 현재 제품 단계의 수용 기준에 직접 연결되지 않는 플랫폼 선행 구축은 하지 않는다.
- 실험 기능은 영속 스키마와 외부 공급자를 추가하기 전에 로컬 fixture, 기존 테이블 또는 비영속 프로토타입으로 검증한다.

### 4.2 기본값은 재사용

- 기존 라이브러리와 플랫폼 기능으로 해결할 수 있으면 새 의존성을 추가하지 않는다.
- 작은 유틸리티는 직접 구현 비용, 보안 위험, 유지 비용을 비교한다. 단순히 코드 줄 수가 적다는 이유만으로 직접 구현하거나 패키지를 추가하지 않는다.
- 같은 역할의 두 번째 도구를 도입하려면 기존 도구의 제거 또는 명확한 공존 종료 시점을 제시한다.

### 4.3 Cloudflare Workers 호환성

- 서버 코드는 Workers 런타임과 ES2022 대상에서 동작해야 한다.
- Node 전용 API, native addon, 장시간 프로세스, 로컬 파일시스템 의존성은 기본적으로 허용하지 않는다.
- `nodejs_compat`에 기대는 패키지는 사용 API, 번들 영향, 실제 Workers 테스트 증거를 PR에 남긴다.

### 4.4 데이터 최소화와 단일 기준 원본

- D1을 현재 서비스 데이터의 단일 기준 원본으로 유지한다.
- 새 테이블에는 제품 요구, 소유자, 보존 기간, 삭제·익명화 방식, 인덱스, migration과 롤백 방법이 필요하다.
- 캐시, 파생 스냅샷, 검색 인덱스는 재생성 가능해야 하며 원본과 혼동하지 않는다.
- 이미 병합되거나 운영에 적용된 migration은 수정하지 않는다.

### 4.5 외부 공급자는 실패·비용 경계

- 외부 API는 route나 React component에서 직접 호출하지 않고 서버 adapter/service 경계로 감싼다.
- timeout, 제한된 재시도, quota, kill switch, degraded UX, mock 또는 fake가 없는 공급자는 확장하지 않는다.
- 공급자 추가와 함께 개인정보 인벤토리, 위탁·국외 이전, 비밀값, 로그 redaction, 비용 한도, 장애 절차를 갱신한다.
- 원격 D1, Workers AI, 이메일, 유료 API 호출은 대상·한도·검증·rollback을 Pull Request에 명시하고, `COWORK.md`의 병합 승인 SSOT에 따라 승인받는다.

### 4.6 가역성과 제거 가능성

- 신규 기술 제안에는 도입 방법뿐 아니라 비활성화, 데이터 이동, 공급자 장애 시 대체, 제거 조건을 포함한다.
- 핵심 사용자 경로는 AI, 이메일 또는 공공데이터의 실시간 성공을 필수 조건으로 만들지 않는다.
- 실험은 feature flag 또는 명시적 운영 kill switch 뒤에 둔다.

## 5. 기술 상태 분류

### 5.1 기본 허용(ACCEPTED BASELINE)

새 기능은 아래 조합을 우선 사용한다. 동일 역할의 대체 기술은 별도 ADR 없이는 추가하지 않는다.

| 계층 | 기본 기술 | 적용 규칙 |
|---|---|---|
| 패키지 관리자 | `pnpm` + `pnpm-lock.yaml` | 다른 패키지 관리자와 lockfile을 추가하지 않는다. Node와 pnpm 버전 고정은 별도 기반 PR로 완료한다. |
| 언어 | TypeScript 7, `strict`, ES2022 | 새 JavaScript 서버 모듈보다 TypeScript를 사용한다. major 변경은 별도 PR로 검증한다. |
| 웹 UI·서버 | React 19 + React Router 8 full-stack | 다른 웹 프레임워크, 별도 API 프레임워크 또는 중복 라우터를 추가하지 않는다. |
| 빌드 | Vite 8 + React Router dev tooling | 별도 bundler를 병행하지 않는다. |
| 실행·배포 | Cloudflare Workers + Static Assets | 현재 웹 배포의 단일 런타임이다. 새 런타임은 대체 ADR이 필요하다. |
| 데이터베이스 | Cloudflare D1 | 측정된 한계와 이전 계획 없이 두 번째 운영 DB를 추가하지 않는다. |
| 데이터 접근 | Drizzle ORM + 순차 SQL migration | raw SQL은 성능·기능상 이유와 테스트가 있을 때 경계 내부에서 사용한다. 두 번째 ORM을 추가하지 않는다. |
| 경계 검증 | Zod | 요청, 환경 변수, 외부 응답을 신뢰 경계에서 검증한다. 두 번째 범용 schema validator를 추가하지 않는다. |
| 지도·좌표 | NAVER Maps Dynamic Map + WGS84 + `proj4` | 확정된 D-07을 따른다. D1 좌표가 내부 원본이며 공급자 ID를 원본으로 바꾸지 않는다. |
| 테스트 | Vitest + Cloudflare Workers pool + Playwright | unit/integration/browser 역할을 유지한다. 다른 범용 테스트 러너를 추가하지 않는다. |
| 디자인 토큰 | `app/styles/design-system.css` | 색상·간격·반경의 기준 원본이다. 새 UI kit은 도입하지 않는다. |
| 관측 | Workers Observability + 구조화 애플리케이션 로그 | production sampling, 보존, PII redaction과 비용은 운영 승인이 필요하다. |

### 5.2 조건부 유지(CONDITIONAL / MAINTENANCE ALLOWED)

아래 기술과 기능은 현재 코드에 있으므로 보안 수정, 장애 복구, 테스트 보강과 제거 준비는 허용한다. 새로운 공급자·모델·도메인으로 확장하려면 §6 게이트를 다시 통과한다.

| 영역 | 현재 사용 | 확장 조건 |
|---|---|---|
| 인증 | 자체 D1 session/token, 이메일 계정, Google OAuth, NAVER OIDC, `jose` | 주 인증 경로와 계정 연결·탈퇴 정책의 사람 결정 전에는 네 번째 인증 방식 또는 새 auth 프레임워크를 추가하지 않는다. |
| 이메일 | Resend | 개인정보·위탁, rate/quota, 실패 상태, local fake와 운영 승인 필요 |
| 공공데이터 | data.go.kr 음식점·주차·EV API | 출처·라이선스·정정 책임, fixture, quota, 수동 fallback과 kill switch 필요 |
| AI | Workers AI 후보 분류 | 핵심 경로 사용 금지. 모델·프롬프트 변경은 고정 회귀 표본, 비용 한도와 수동 검수를 PR에 기록하고 병합 승인 필요 |
| 예약 작업 | Workers cron 1개에서 여러 maintenance 작업 실행 | 기존 결합 실패를 먼저 분리·관측하기 전에는 같은 `Promise.all`에 새 작업을 추가하지 않는다. |
| CSV | `csv-parse` 관리자 import | 관리자 전용, 크기 제한, schema 검증과 원자적 처리 유지 |
| 스타일링 | Tailwind 4 + 전역 CSS + 디자인 토큰 | 기존 화면 유지에는 사용 가능하다. 새 utility 체계·plugin·component kit 추가는 금지하고, 토큰 SSOT와의 통합 방향을 별도 결정한다. |
| 고급 평가·개인화 | reviewer reliability, similarity, badge, taste graph | 현재 불변식·설명 가능성·운영 지표가 검증되기 전에는 새 알고리즘 계층이나 영속 테이블을 추가하지 않는다. |
| 코스·주차 기능 | course recommendation, parking/EV sync | Lean Beta 핵심 게이트가 끝나기 전에는 새 공급자와 자동화 범위를 늘리지 않는다. |

조건부 상태는 결함 판정이나 즉시 삭제 명령이 아니다. 기존 데이터를 보존하고 별도 migration·rollback 계획 없이 제거하지 않는다.

### 5.3 기본 HOLD

다음 항목은 현재 단계에서 필요성이 입증되기 전까지 도입하지 않는다.

- 두 번째 프론트엔드 프레임워크, API 프레임워크, ORM, 데이터베이스, 범용 validator 또는 테스트 러너
- Redux 계열 등 전역 상태 관리 라이브러리. 먼저 URL, React state, route loader/action과 서버 상태를 사용한다.
- 새 CSS 프레임워크, UI component kit 또는 디자인 토큰 체계
- 새 인증 공급자, 결제 공급자, 분석·광고·세션 재생·크래시 수집 공급자
- KV, R2, Cloudflare Images, Queues, Durable Objects, 별도 검색 엔진 또는 벡터 데이터베이스
- 네이티브 앱 프레임워크와 앱 전용 backend/data model
- 사용자 요청의 성공을 외부 AI 추론에 의존시키는 구조

장기 제품 문서에 포함된 기술도 현재 단계의 도입 승인을 뜻하지 않는다. 실제 요구, 데이터, 비용과 운영 책임이 생긴 시점에 별도 ADR로 전환한다.

### 5.4 금지(PROHIBITED)

- 비밀값, OAuth token, 개인정보 또는 운영 데이터를 코드·문서·로그·클라이언트 bundle에 포함
- 로컬·CI 테스트가 운영 D1, 실제 이메일, Workers AI 또는 유료 API를 기본 호출
- 적용된 migration 수정, 운영 데이터 수동 덮어쓰기, 검증 없는 destructive migration
- 인증·인가·입력 검증 없이 상태를 변경하거나 비용을 발생시키는 endpoint
- component에서 DB 또는 비밀값 사용, route에서 공급자별 규칙을 중복 구현
- 동적 `eval`, shell command 문자열 조합 또는 검증되지 않은 URL fetch를 핵심 경로에 사용
- `main` 직접 개발·push, hook 우회, 승인 없는 운영 배포

## 6. 변경 유형별 승인 게이트

| 변경 유형 | 필수 증거 | 승인 수준 |
|---|---|---|
| 기존 패키지 patch/minor 갱신 | release note, lockfile diff, test/typecheck/build | 일반 feature PR + 사람 리뷰 |
| major 갱신 또는 runtime 패키지 추가 | 현재 도구로 불가능한 이유, 대안, 직접·전이 의존성 변화, Workers 호환성, 보안·라이선스, 성능·bundle 영향, rollback | Tech owner 승인 + ADR 또는 결정 문서 |
| browser runtime 패키지 추가 | 실제 사용자 가치, JS/CSS 전송량 전후, 접근성·모바일 검증, lazy loading 가능성 | Product + Tech 승인 |
| 외부 API·SaaS 추가 | provider register, 개인정보·계약, quota·비용 ceiling, timeout/retry, kill switch, fake/contract test, 장애 UX | Product + Tech + Privacy/Operations 승인 |
| 인증·결제·권한 기술 변경 | threat model, 세션·탈퇴·복구·웹훅 계약, abuse 방어, migration과 rollback | 별도 ADR + Security/Privacy + 사람 승인 |
| 새 D1 테이블·인덱스 | 승인된 제품 요구, 데이터 lifecycle, query plan, migration, rollback/forward-fix, fixture와 invariant test | Data/Tech 사람 리뷰 |
| cron·Queue·background job 추가 | idempotency, 중복 실행, timeout, retry, concurrency, 수동 재실행, alert, 비용, kill switch | Operations + Tech 승인 |
| 새 Cloudflare binding·저장소 | local/staging/production 격리, 권한, 한도, 비용, 백업·복구, mock | ADR + Operations 승인 |
| 프레임워크·DB·호스팅 교체 | 측정된 한계, 대안 비교, 단계적 이행, dual-run 종료, 데이터 이전, 전체 rollback | 별도 RFC/ADR + Product/Tech 사람 승인 |

자동 테스트 통과만으로 인증, 개인정보, 계약, 비용 또는 운영 승인을 대신할 수 없다. 필수 증거와 실행 범위가 적힌 Pull Request를 권한 있는 담당자가 병합한 기록이 최종 승인이다.

## 7. 기술 변경 PR 필수 내용

기술 스택을 바꾸는 Issue와 PR은 다음 질문에 답해야 한다.

1. 어떤 사용자·운영 문제를 해결하는가?
2. 현재 스택으로 해결할 수 없는 구체적인 이유와 재현 증거는 무엇인가?
3. 아무것도 추가하지 않는 선택을 포함해 어떤 대안을 검토했는가?
4. 새 직접·전이 의존성, browser bundle, Worker CPU·메모리 영향은 무엇인가?
5. 라이선스, 유지보수 주체, 릴리스 주기와 알려진 보안 위험은 무엇인가?
6. 수집·전송·저장되는 데이터와 개인정보·계약 영향은 무엇인가?
7. 무료·유료 quota, 월 비용 ceiling, 알림과 hard stop은 무엇인가?
8. local fake, unit/integration/E2E, staging contract 검증은 어떻게 분리하는가?
9. 장애 시 사용자 경험, 관측 신호, 운영자 절차는 무엇인가?
10. migration, rollout, rollback, 공급자 전환과 최종 제거 조건은 무엇인가?
11. 소유자는 누구이며 언제 다시 검토하는가?

검토 결과는 `GO`, `CONDITIONAL GO`, `HOLD`, `NO-GO` 중 하나로 기록한다. `HOLD`와 `NO-GO`를 구현 완료나 승인으로 표현하지 않는다.

## 8. Lean Beta 적용 경계

현재 단계에서는 다음 기반의 안정화가 새 기술 도입보다 우선한다.

- 지도·장소 목록·상세·검색과 검수된 장소 데이터
- 저장과 설명 가능한 단순 추천·비추천
- 계정·권한·관리자 검수의 안전한 핵심 경로
- CI, 테스트 격리, fixture/seed 재현성
- 개인정보·탈퇴·보존, rate limit, 비용 경로 보호
- 관측, 장애 통지, rollback과 D1 복구 절차
- 접근성, 모바일, 오류·빈·offline 상태

Workers AI, 코스, 주차/EV, 고급 평가 그래프와 추가 인증 공급자는 유지보수 범위로 둔다. 이들 기능의 새 기술 표면은 위 핵심 게이트와 명시적인 제품 승인을 통과한 뒤 확장한다.

## 9. 버전과 의존성 운영

- `pnpm-lock.yaml`을 재현 가능한 설치 기준으로 사용하고 의도하지 않은 lockfile churn을 금지한다.
- Node와 pnpm 버전이 현재 저장소에 고정되어 있지 않은 것은 재현성 공백이다. Product-ready Stage 1 전에 별도 작은 PR로 고정한다.
- major 버전 갱신은 기능 변경과 분리한다. 호환성 수정이 필요하면 동일 PR에서 영향 범위를 명시한다.
- production critical path에 prerelease, 유지 중단, native addon 의존성을 넣지 않는다. 불가피하면 별도 ADR과 제거 기한이 필요하다.
- 보안 패치는 긴급할 수 있지만 feature branch, 검증, PR과 사람 리뷰 원칙은 유지한다. 실제 긴급 hotfix 예외는 `AGENTS.md`의 명시적 승인 규칙을 따른다.

## 10. 아키텍처 경계

기본 호출 방향은 다음을 유지한다.

```text
React component
  → React Router loader/action/resource route
    → app/features의 domain service
      → D1 repository 또는 외부 provider adapter
```

- React component는 비밀값, DB binding, 공급자 token과 서버 권한 판정을 소유하지 않는다.
- route는 HTTP 변환, 인증·인가, 입력 검증과 응답 조합을 담당하고 핵심 도메인 규칙을 중복 구현하지 않는다.
- domain service는 공급자 SDK나 응답 형식이 아니라 Re:Taste 용어와 타입을 노출한다.
- provider adapter는 mock 가능해야 하며 외부 오류를 내부의 제한된 오류 코드로 변환한다.
- 데이터 파생값과 알고리즘 버전은 재계산 가능해야 하며 원시 이벤트를 파괴하지 않는다.

## 11. 예외와 폐기 절차

예외는 Issue 또는 ADR에 다음을 기록한 경우에만 허용한다.

- 적용 범위와 소유자
- 허용 이유와 기각한 대안
- 시작일, 재검토 조건 또는 종료일
- 위험 완화, 관측, 비용 한도와 rollback
- 기존 표준과의 공존 종료 방법

기술을 교체할 때 기존 ADR과 결정 문서를 삭제하지 않는다. 새 문서에서 `SUPERSEDED` 또는 `DEPRECATED` 관계를 기록하고, 데이터·코드·secret·dashboard·runbook 제거를 별도 PR로 검증한다.

## 12. 승인 전에 필요한 사람 결정

이 문서를 `ACCEPTED`로 바꾸기 전에 다음을 확인한다.

1. 현재 기본 허용 스택과 “기본적으로 새 기술을 추가하지 않는다”는 원칙을 승인하는가?
2. 이메일 계정, Google OAuth, NAVER OIDC 중 공개 베타의 주 인증 경로는 무엇인가?
3. Tailwind를 디자인 토큰의 제한된 utility 계층으로 유지할지, semantic CSS로 수렴할지 결정할 책임자와 시점은 무엇인가?
4. Workers AI, 코스, 주차/EV와 고급 평가 기능을 Lean Beta 핵심 게이트 전까지 확장 동결하는가?
5. 신규 외부 공급자·Cloudflare binding·영속 저장소에 Product/Tech/Privacy/Operations 승인 게이트를 적용하는가?

## 13. 후속 기반 PR 후보

아래는 이 문서가 식별한 후속 작업이며 이 PR의 구현 범위가 아니다.

| 우선순위 | 후보 | 완료 증거 |
|---|---|---|
| P0 | Node·pnpm 버전 고정 | fresh install과 CI가 같은 버전 사용 |
| P0 | CI 및 local/staging/production test binding 격리 | 운영 ID·실제 공급자 없이 반복 실행 통과 |
| P0 | 인증 주 경로·탈퇴·복구 ADR | Product/Security/Privacy 사람 결정 |
| P0 | 외부 공급자 register와 비용·kill switch 표 | NAVER, Resend, data.go.kr, Workers AI 실제 상태 매핑 |
| P1 | CSS/Tailwind 소유권과 수렴 결정 | 토큰 SSOT, 신규 코드 규칙, 제거 또는 제한 계획 |
| P1 | cron 작업 실패 격리·관측 설계 | 작업별 결과, timeout, 재실행, alert와 비용 증거 |
| P1 | browser/server dependency·bundle 기준선 | 재현 가능한 측정 명령과 회귀 보고 형식 |
