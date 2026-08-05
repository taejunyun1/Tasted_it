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
