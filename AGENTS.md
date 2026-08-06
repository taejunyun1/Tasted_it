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
9. Deploy production from the merged `main`. Preview deployments may run from feature branches before merge.
10. After merging, update the local `main` from `origin/main` before starting the next branch.

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
