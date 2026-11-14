# B08 reviewer validation — 2026-11-14

Local synthetic fixtures only. No production reviewer role/status changes or live mutation checks were performed. Operational execution follows [the shared B08 rollout](../../operations/2026-11-14-admin-b08-rollout.md).

## Verified scope

- Maximum 25 selected targets; fixed preview outcomes and evidence counts; one atomic operation and central receipt.
- Same-timestamp profile version changes and changed current application evidence prevent every intended write.
- Normal approval retains the stored submission-time ten-suggestion rule; current count is shown separately.
- Recent administrator authentication, actor/session ownership, protected admin accounts, old direct intents, body bounds and POST-only contract.
- Existing withdrawn review/photo moderation states remain unchanged on reactivation.
- Receipt items use internal target IDs to resolve current admin-visible labels; names, email, freeform reason and application statement are excluded from stored result.

## Checks

- `pnpm run typecheck` — passed.
- Reviewer D1 8/8, route boundary 3/3, and existing reviewer helper 3/3 — 14 focused tests passed. The reviewer suite also verifies deterministic duplicate-applicant skipping and admin-only current-name resolution for stored target identifiers.
- `pnpm exec playwright test tests/e2e/admin-reviewer-operations.spec.ts --config .superpowers/b08-playwright.config.ts --project=chromium --project=mobile-chromium` — 2 passed. The ignored local config uses an isolated 5174 server with the repository timeouts/retries unchanged.
- Visual inspection: [desktop](chromium.png), [mobile](mobile-chromium.png). Preview counts, public eligibility warning, and reauthentication transition are visible; no horizontal overflow.
- `pnpm audit --prod` — 0 vulnerabilities. Full audit retains 46 existing development dependency advisories (4 low, 26 moderate, 15 high, 1 critical); dependency and lockfiles are unchanged.
- Diff whitespace and scoped credential-pattern scan — passed.

Shared migration/receipt/B06 tests belong to the included common people-operation commit, independently verified by the integrating owner. Required CI and live deployment validation are separate completion gates.

## 최초 CI 실패와 수정

첫 head `6bbd6f1`의 CI run `43561942058`에서 unit 2건이 실패했다(통과 1,674건, 건너뜀 53건). 기존 `admin-page` 디자인 프레임과 H1 `25.2px / md 33.6px` 계약을 새 화면이 유지하지 않은 것이 원인이었다. 테스트는 그대로 두고 실제 main/H1 클래스와 리뷰어 전용 CSS를 복원했다. 수정 후 해당 디자인 계약 파일 2개의 테스트 7/7이 통과했다. 기존 desktop/mobile E2E 2/2도 통과했고 computed style로 각각 33.6px/25.2px를 확인했다. 변경된 화면 증거를 교체하고 잘림·겹침이 없음을 확인했다.
