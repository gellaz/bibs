---
allowed-tools: Bash(git checkout:*), Bash(git switch:*), Bash(git add:*), Bash(git status:*), Bash(git push:*), Bash(git commit:*), Bash(gh pr create:*), Bash(gh pr merge:*)
description: Commit, push, open a PR, and enable auto-merge (squash) so it lands when CI is green
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`

## Your task

Based on the above changes:

1. If on `main`, create a new feature branch first. Use a generic name (no scope baked in) — renaming a branch with an open PR via the GitHub API closes it.
2. Create a single commit with a Conventional Commits message. Respect the repo's scope whitelist (Lefthook validates `commit-msg`).
3. Push the branch to origin with `-u`.
4. Open the PR with `gh pr create` (HEREDOC for body, title under 70 chars).
5. Enable auto-merge: `gh pr merge --auto --squash`. The repo has `allow_auto_merge: true`, `squash_merge_commit_title: COMMIT_OR_PR_TITLE`, and `delete_branch_on_merge: true`, so GitHub appends `(#NN)` and deletes the branch when CI (Lint / Typecheck / API tests) goes green.

Constraints:
- Do **not** pass `--subject` to `gh pr merge` — it strips the `(#NN)` suffix.
- Do **not** pass `--no-verify`, `--admin`, or any branch-protection bypass.
- Do everything above in a single message via parallel tool calls where independent. Do not run any other tools and do not send any other text besides these tool calls.
