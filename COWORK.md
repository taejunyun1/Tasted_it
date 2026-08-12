# 공동작업 규칙

이 문서는 모든 기여자와 코딩 에이전트가 따라야 하는 필수 공동작업 규칙을 정의한다.

## 1. 작업 소유권

- 작업을 시작하기 전에 담당자, 작업 범위, 소유 파일을 Issue 또는 Pull Request에 기록한다.
- 다른 작업자와 파일 범위가 겹치면 수정하기 전에 조율한다.

## 2. 브랜치와 작업공간 격리

- 각 작업자는 독립된 브랜치와 worktree를 사용한다.
- 브랜치와 worktree 이름에는 `jay_<작업명>`, `tj_<작업명>`과 같이 작업자별 접두사를 사용한다.
- 다른 작업자의 브랜치를 재사용하거나 강제 Push하지 않는다.
- 모든 신규 브랜치는 최신 `origin/main`에서 생성한다.

## 3. 동기화와 충돌

- Pull Request를 생성하기 전에 최신 `origin/main`을 반영한다.
- 공유된 브랜치를 명시적인 조율 없이 rebase하거나 force-push하지 않는다.
- 충돌을 해결하는 과정에서 다른 작업자의 변경을 삭제하지 않는다.

## 4. Pull Request와 리뷰

- 모든 Pull Request에는 변경 범위, 검증 결과, 운영 영향, 남은 위험을 기록한다.
- UI 변경에는 데스크톱과 모바일 화면 증거를 첨부한다.
- 저장소 변경과 그에 수반되는 운영 계획의 승인 단일 기준 원본(SSOT)은 병합된 Pull Request다.
- 저장소 소유자 또는 권한 있는 유지보수 담당자가 Pull Request를 병합하면, Pull Request 본문에 명시된 코드·migration·외부 연동·rollout·배포·원격 작업 계획은 승인 완료로 간주한다. 병합 후 동일 범위에 대한 별도 채팅 승인을 다시 받지 않는다.
- 승인 범위를 확인할 수 있도록 Pull Request 본문에 대상 환경, 실행 명령 또는 작업, 비용·개인정보 영향, 검증, rollback을 구체적으로 기록한다.
- Pull Request에 명시되지 않은 운영 데이터 변경, 범위가 정해지지 않은 파괴 작업, 비밀값 열람·공유는 병합으로 승인되지 않는다.
- `PROPOSED` 또는 `HOLD` 문서는 해당 Pull Request가 상태를 `ACCEPTED` 또는 `GO`로 명시적으로 변경할 때만 구현 승인으로 본다.
- 자동 에이전트 리뷰와 테스트는 병합 판단의 증거이며, 그 자체만으로 승인되지 않는다. 최종 승인 기록은 권한 있는 담당자의 Pull Request 병합이다.

## 5. 데이터베이스와 설정

- 이미 병합되거나 운영 환경에 적용된 migration은 수정하지 않는다.
- 모든 스키마 변경은 새로운 순번의 migration으로 추가한다.
- 의존성 변경이 없으면 lockfile을 불필요하게 변경하지 않는다.
- 저장소에서 지정한 `pnpm` 패키지 관리자만 사용한다.

## 6. 비밀값, 유료 서비스와 운영 환경

- 비밀값, 개인정보, 실제 운영 데이터를 소스 코드, 문서, 로그 또는 Pull Request에 커밋하거나 노출하지 않는다.
- 원격 D1 migration, Workers AI 호출, 이메일 발송, 유료 API 호출은 대상과 한도, 검증, rollback을 Pull Request에 명시한다. 해당 Pull Request가 병합되면 명시된 범위의 사전 승인을 충족한다.
- `pnpm run deploy` 실행과 운영 데이터 변경은 병합된 Pull Request의 범위 안에서 지정된 배포 담당자만 수행한다. 병합은 실행 권한을 부여하지만 실제 실행 완료를 의미하지 않는다.
- 테스트는 기본적으로 로컬 데이터베이스와 mock 외부 서비스를 사용한다.

## 7. 인수인계

- 인수인계 시 브랜치, Pull Request, 변경 파일, 테스트 결과, migration과 환경 변수 변경 사항을 전달한다.
- 미완료 항목과 확인하지 못한 위험을 명확히 기록한다.
- 병합 후 원격 feature 브랜치를 삭제하고 로컬 `main`을 `origin/main` 기준으로 최신화한다.

## 8. 문서 언어

- 플랜, 스펙, 운영 문서와 설명이 필요한 문서는 한국어로 작성한다.
- 기술 용어는 필요한 경우 `한국어(English)` 형식으로 작성한다.
- 한·영 병기가 필요한 문서는 한글 문서 전체를 먼저 작성하고, 하단에 영문 문서 전체를 붙인다.
- 이 문서 자체를 한·영 병기 문서 형식의 표준 예시로 사용한다.

---

# Collaboration Workflow

This document defines the mandatory collaboration rules for all contributors and coding agents.

## 1. Task Ownership

- Before starting work, record the assignee, task scope, and owned files in an Issue or Pull Request.
- If file ownership overlaps with another contributor, coordinate before making changes.

## 2. Branch and Worktree Isolation

- Each contributor must use an independent branch and worktree.
- Use a contributor-specific prefix for branch and worktree names, such as `jay_<scope>` or `tj_<scope>`.
- Do not reuse another contributor’s branch or force-push to it.
- Create every new branch from the latest `origin/main`.

## 3. Synchronization and Conflicts

- Incorporate the latest `origin/main` before opening a Pull Request.
- Do not rebase or force-push a shared branch without explicit coordination.
- Do not discard another contributor’s changes while resolving conflicts.

## 4. Pull Request and Review

- Every Pull Request must document the changed scope, verification results, operational impact, and remaining risks.
- UI changes must include desktop and mobile visual evidence.
- The single source of truth (SSOT) for approval of repository changes and their associated operational plan is the merged Pull Request.
- When the repository owner or an authorized maintainer merges a Pull Request, the code, migrations, external integrations, rollout, deployment, and remote-operation plan explicitly listed in that Pull Request are considered approved. Do not request separate chat approval again for the same scope after merge.
- The Pull Request body must identify the target environment, commands or operations, cost and privacy impact, verification evidence, and rollback so that the approved scope is unambiguous.
- Merge does not approve production-data changes, unbounded destructive operations, or secret access and disclosure that were not explicitly listed in the Pull Request.
- A `PROPOSED` or `HOLD` document authorizes implementation only when the Pull Request explicitly changes its status to `ACCEPTED` or `GO`.
- Automated agent reviews and tests are evidence used for the merge decision, not approval by themselves. The final approval record is the merge performed by an authorized maintainer.

## 5. Database and Configuration

- Do not modify migrations that have already been merged or applied to production.
- Add every schema change as a new sequential migration.
- Do not modify the lockfile unless dependencies have intentionally changed.
- Use only the repository-designated `pnpm` package manager.

## 6. Secrets, Paid Services, and Production

- Do not commit or expose secrets, personal information, or production data in source code, documents, logs, or Pull Requests.
- List the target, limit, verification, and rollback for remote D1 migrations, Workers AI calls, email delivery, and paid API calls in the Pull Request. Merging that Pull Request satisfies prior approval for the explicitly listed scope.
- Only the designated deployment operator may run `pnpm run deploy` or modify production data within the scope of a merged Pull Request. Merge grants authorization; it does not prove that execution completed.
- Tests must use a local database and mocked external services by default.

## 7. Handoff

- At handoff, provide the branch, Pull Request, changed files, test results, migrations, and environment-variable changes.
- Clearly document incomplete work and risks that have not been verified.
- After merging, delete the remote feature branch and update the local `main` from `origin/main`.

## 8. Documentation Language

- Plans, specifications, operational documents, and documents requiring explanation must be written in Korean.
- When necessary, write technical terminology in the `Korean (English)` format.
- When both Korean and English are required, write the complete Korean document first and append the complete English document below it.
- This document itself serves as the standard example of the required Korean-English bilingual document format.
