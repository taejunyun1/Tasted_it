# Repository workflow

Apply this workflow to every development change in this repository.

1. Never develop or push commits directly on `main`.
2. Start each unit of work from the latest `origin/main` on a dedicated feature branch.
3. Keep another contributor's branch and uncommitted work isolated; do not reuse or rewrite it.
4. Verify the changed scope, commit it, and push the feature branch to `origin`.
5. Open a GitHub pull request into `main` for every completed change.
6. Wait for required checks and review the PR diff before merging.
7. Merge the PR only when checks pass. Prefer squash merge unless the task requires preserved commits.
8. Delete the remote feature branch after a successful merge when it is no longer needed.
9. After a PR is merged into `main` (or when leftover local work is confirmed squash-merged into `main`), rename the local feature branch to `Archive/<original-branch-name>` rather than deleting it. Remove leftover worktrees so the primary checkout stays on `main`. Do not use `Archive/*` branches as the base for new work; new branches always start from the latest `origin/main`. Remote: delete. Local: preserve under `Archive/`.
10. Deploy production from the merged `main`. Preview deployments may run from feature branches before merge.
11. After merging, update the local `main` from `origin/main` before starting the next branch.

PR이 `main`에 병합된 뒤(또는 로컬에 남은 작업이 `main`에 squash-merge된 것이 확인되면) 원격 feature 브랜치는 삭제하고, 로컬 브랜치는 삭제하지 않고 `Archive/<원래-브랜치명>`으로 이름 변경한다. 남은 worktree는 제거하여 기본 checkout이 `main`에 머물게 한다. `Archive/*` 브랜치는 신규 작업의 기준으로 쓰지 않으며, 모든 신규 브랜치는 최신 `origin/main`에서 시작한다. 원격: 삭제. 로컬: `Archive/` 아래에 보존.

The repository owner follows the same feature-branch and pull-request workflow. A direct push to `origin/main` is reserved for an explicitly approved emergency hotfix.


## Mandatory collaboration protocol

Before making any development change, read `COWORK.md` in full and follow it.

- `COWORK.md` is mandatory for contributors and coding agents.
- If `AGENTS.md` and `COWORK.md` conflict, `AGENTS.md` takes precedence.
- Do not begin implementation until the task scope and ownership are established.
- If `COWORK.md` is missing or cannot be read, stop and report the problem.

모든 개발 변경 전에 `COWORK.md` 전체를 읽고 따라야 한다.

- `COWORK.md`는 사람 기여자와 코딩 에이전트 모두에게 필수다.
- 두 문서가 충돌하면 `AGENTS.md`를 우선한다.
- 작업 범위와 담당자가 확정되기 전에는 구현을 시작하지 않는다.
- `COWORK.md`를 읽을 수 없으면 작업을 중단하고 문제를 보고한다.


## Tech stack governance

Before changing dependencies, runtimes, databases, authentication providers, external services, Cloudflare bindings, scheduled jobs, CSS frameworks, or test frameworks, read and follow `docs/decisions/2026-08-10-tech-stack-governance.md`.

- Existing code or an installed package does not automatically authorize further expansion.
- Record every exception and its owner, evidence, cost/security/privacy impact, rollback, and removal condition in the Issue or Pull Request.
- A `PROPOSED` or `HOLD` plan is not implementation approval.

의존성, 런타임, 데이터베이스, 인증 공급자, 외부 서비스, Cloudflare binding, 예약 작업, CSS 프레임워크 또는 테스트 프레임워크를 변경하기 전에 `docs/decisions/2026-08-10-tech-stack-governance.md`를 읽고 따른다.

- 코드나 설치 패키지가 이미 존재한다는 사실만으로 추가 확장을 승인하지 않는다.
- 모든 예외는 담당자, 근거, 비용·보안·개인정보 영향, rollback과 제거 조건을 Issue 또는 Pull Request에 기록한다.
- `PROPOSED` 또는 `HOLD` 상태의 plan은 구현 승인이 아니다.
