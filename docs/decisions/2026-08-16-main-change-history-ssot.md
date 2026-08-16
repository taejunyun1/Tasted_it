# main 변경 이력 인덱스 SSOT 지정

- **상태:** ACCEPTED — 이 문서를 포함한 Pull Request 병합 시 적용
- **작성일:** 2026-08-16
- **추적:** [GitHub Issue #156](https://github.com/taejunyun1/Tasted_it/issues/156) · [Pull Request #157](https://github.com/taejunyun1/Tasted_it/pull/157)
- **결정 범위:** `main`에 반영된 변경의 발견·요약·추적 기준

## 배경

Re:Taste의 `main`은 짧은 기간에 제품 코드, D1 migration, 외부 연동, 운영 UI, 설계 문서가 함께 갱신된다. Git 커밋과 병합 Pull Request는 정확한 원본 근거지만, 여러 변경을 날짜·영역·운영 영향별로 한눈에 파악하기 어렵다. 로컬 `worklog/`는 특정 워크스페이스에만 존재하고 Git에서 무시되므로 저장소 전체의 공식 변경 이력으로 사용할 수 없다.

변경 이력을 별도 문서로 정리할 때는 원본과 요약 문서의 권한이 충돌하지 않아야 한다. 특히 병합 Pull Request가 가진 승인 범위와 운영 계획을 요약 문서가 재해석하거나 확대해서는 안 된다.

## 결정

[`docs/main-change-history.md`](../main-change-history.md)를 **`main` 변경 이력 인덱스의 단일 기준 원본(SSOT)** 으로 지정한다.

이 SSOT의 책임은 다음과 같다.

1. 마지막으로 확인한 `origin/main` 커밋과 확인 시각을 명시한다.
2. `main`에 반영된 각 Pull Request를 날짜, 영역, 변경 내용, 데이터·운영 영향, 원본 근거로 연결한다.
3. migration, 환경 변수, 외부 공급자, 기능 플래그처럼 누락 시 운영 사고로 이어질 수 있는 변동을 별도 인벤토리로 모은다.
4. 문서가 실제 `origin/main`보다 뒤처졌을 때 `STALE`로 판단하는 규칙과 갱신 절차를 정의한다.

## 권한 경계

서로 다른 사실 영역은 다음 원본을 따른다.

1. **현재 코드·파일 상태:** 원격 저장소의 `origin/main` 커밋 그래프
2. **변경 승인·운영 승인 범위:** 권한 있는 담당자가 병합한 Pull Request와 [`2026-08-12-pr-merge-approval-ssot.md`](./2026-08-12-pr-merge-approval-ssot.md)
3. **변경 이력의 탐색·요약·영향 인덱스:** `docs/main-change-history.md`
4. **개인 로컬 작업 기록:** `worklog/` — 참고 자료이며 저장소 SSOT가 아님

요약 문서와 원본 근거가 충돌하면 Git 커밋과 병합 Pull Request를 우선한다. 변경 이력 문서는 배포, migration 적용, 운영 데이터 변경 또는 외부 API 호출이 실제 완료됐음을 단독으로 증명하지 않는다.

## 갱신 계약

- 지속되는 코드·데이터·설정·운영·제품 문서 변경을 만드는 Pull Request는 Draft 상태에서 자신의 PR 번호를 확보한 뒤 `docs/main-change-history.md`에 항목을 추가한다.
- 항목에는 최소한 변경 이유, 사용자/운영 영향, migration·환경 변수·외부 연동 여부, 검증, rollback, PR 링크를 적는다.
- 오탈자처럼 독립 이력 가치가 없는 변경은 PR 본문에서 미기록 사유를 명시할 수 있다.
- 기준 커밋은 누락된 병합 PR이 없는지 `origin/main`과 대조한 뒤에만 전진시킨다.
- 기준 커밋이 실제 `origin/main`과 다르면 문서는 자동으로 최신이라고 간주하지 않는다. 차이를 먼저 조사하고 누락 항목을 보완한다.
- 과거 기록은 삭제하지 않는다. 설명을 바로잡을 때는 원본 PR을 유지하고 정정 이유를 남긴다.

## 검토한 대안

### Git 로그만 사용

정확하고 자동 생성할 수 있지만 변경 이유, 운영 영향, rollout 조건을 빠르게 파악하기 어렵다. 원본 증거로는 유지하되 탐색 인덱스를 보완한다.

### GitHub Releases 또는 태그만 사용

정식 릴리스 단위에는 적합하지만 현재 저장소의 잦은 `main` 병합을 모두 다루지 못한다. 릴리스 노트가 생겨도 이력 인덱스의 상위 요약으로 연결한다.

### 로컬 `worklog/`를 공식 원장으로 사용

Git에서 무시되고 특정 경로·사용자 상태를 포함하므로 협업 SSOT가 될 수 없다. 로컬 실행 증거 보존 용도로만 유지한다.

### 각 PR 본문만 사용

가장 상세한 승인 원본이지만 여러 PR 사이의 순서, 중복, 최종 설정값과 migration 누적 상태를 한 화면에서 비교하기 어렵다. PR은 승인 SSOT로 유지하고 별도의 색인을 둔다.

## 결과

- 새 기여자는 README에서 한 번에 현재 기준 커밋과 최근 변동을 찾을 수 있다.
- 운영자는 migration·환경 변수·외부 연동 변경을 별도 표에서 빠르게 확인할 수 있다.
- 문서가 뒤처진 경우 이를 최신으로 오인하지 않고 `origin/main` 차이를 조사하게 된다.
- 모든 변경 PR에 이력 작성 부담이 추가된다. 대신 PR 템플릿에서 필요한 필드를 표준화한다.
- 이 결정은 자동 배포, 원격 D1 적용, 외부 API 활성화 권한을 새로 부여하지 않는다.

---

# Designation of the main Change-History Index as SSOT

- **Status:** ACCEPTED — effective when the Pull Request containing this decision is merged
- **Date:** 2026-08-16
- **Tracking:** [GitHub Issue #156](https://github.com/taejunyun1/Tasted_it/issues/156) · [Pull Request #157](https://github.com/taejunyun1/Tasted_it/pull/157)
- **Decision scope:** discovery, summarization, and traceability of changes merged into `main`

## Context

Re:Taste updates product code, D1 migrations, external integrations, operational UI, and design documents on `main` at high frequency. Git commits and merged Pull Requests are the exact source evidence, but they do not provide a quick cross-change view by date, area, and operational impact. The local `worklog/` directory exists only in a specific workspace and is ignored by Git, so it cannot serve as the repository-wide official history.

Any curated history must avoid conflicting with its source evidence. In particular, a summary must not reinterpret or expand the approval and operational scope recorded in a merged Pull Request.

## Decision

Designate [`docs/main-change-history.md`](../main-change-history.md) as the **single source of truth for the `main` change-history index**.

The SSOT is responsible for:

1. Recording the last verified `origin/main` commit and verification time.
2. Linking each merged Pull Request by date, area, change, data/operational impact, and source evidence.
3. Maintaining a separate inventory of migrations, environment variables, external providers, and feature flags whose omission could cause operational errors.
4. Defining when the document is `STALE` and how it must be reconciled.

## Authority Boundary

Use the following authority for each fact domain:

1. **Current code and file state:** the `origin/main` commit graph
2. **Change approval and operational approval scope:** the Pull Request merged by an authorized maintainer and [`2026-08-12-pr-merge-approval-ssot.md`](./2026-08-12-pr-merge-approval-ssot.md)
3. **Discovery, summary, and impact index:** `docs/main-change-history.md`
4. **Personal local execution record:** `worklog/`, which is reference material rather than repository SSOT

If a summary conflicts with source evidence, the Git commit and merged Pull Request prevail. The history document alone does not prove that a deployment, migration, production-data change, or external API call was executed.

## Update Contract

- A Pull Request that creates a durable code, data, configuration, operations, or product-documentation change must open as a Draft, obtain its PR number, and add its entry to `docs/main-change-history.md`.
- Each entry must include the reason, user/operational impact, migrations, environment variables, external integrations, verification, rollback, and PR link.
- A change with no independent historical value, such as a typo, may omit an entry only when the PR explains why.
- Advance the verified commit only after reconciling `origin/main` and confirming that no merged PR is missing.
- A mismatch between the recorded commit and `origin/main` means the document is not assumed current; investigate and document the gap first.
- Do not delete historical entries. Corrections retain the source PR and record why the description changed.

## Alternatives Considered

### Git log only

Git is precise and automatable, but it does not make rationale, operational impact, or rollout conditions easy to discover. Keep it as source evidence and add a curated index.

### GitHub Releases or tags only

Releases are useful for formal delivery units but do not cover every frequent merge to `main`. Future release notes should link to this index as a higher-level summary.

### Local `worklog/` as the official ledger

It is ignored by Git and contains path- and user-specific state, so it cannot be a collaboration SSOT. Keep it only for local execution evidence.

### Pull Request bodies only

They are the most detailed approval source, but comparing order, overlap, final configuration, and cumulative migrations across many PRs is difficult. Keep PRs as the approval SSOT and add an index.

## Consequences

- Contributors can find the current baseline commit and recent changes from README.
- Operators can quickly inspect migrations, environment variables, and external integration changes.
- A stale document is not mistaken for current state; differences from `origin/main` must be investigated.
- Every durable PR gains a documentation obligation, standardized through the PR template.
- This decision grants no new authority to deploy, apply remote D1 migrations, or enable external APIs.
