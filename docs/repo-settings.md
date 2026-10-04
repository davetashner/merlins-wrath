# Repository settings

GitHub settings for `davetashner/thevesperbell`, kept as code (mw-e00.10). The source of truth is
`scripts/repo-settings.env`. `scripts/configure-repo.sh` applies it and is idempotent;
`scripts/verify-repo-settings.sh` diffs the live settings against it and exits non-zero on drift. Both
need a `gh` login with admin rights.

## Merging

| Setting | Value | Why |
|---|---|---|
| Squash merge | on (only method) | One commit per PR on main; the PR title and body become the commit (contract §1). |
| Merge commits, rebase merge | off | Keeps history linear and one-PR-one-commit. |
| Delete head branch on merge | on | No stale branches (the branch-hygiene rule in CLAUDE.md). |
| Auto-merge | off | Merges happen after a human or agent has seen CI green. |

## Protection on `main`

| Setting | Value | Why |
|---|---|---|
| Require a pull request | via required checks | Checks only run on PRs, so a direct push can never satisfy them. |
| Required status checks | see below | CI must be green to merge. |
| Branches must be up to date | on | A PR is tested against the main it will land on (the coverage ratchet depends on it). |
| Include administrators | on | The owner and agents follow the same rules; a direct push to main is rejected. |
| Linear history | on | Matches squash-only. |
| Force pushes, deletion | blocked | main's history is permanent. |
| Required approving reviews | none | Solo-maintainer project: a required review would block the only maintainer. Revisit when contributors join. |

### Required checks

`lint`, `typecheck`, `unit`, `coverage-gate`, `coverage-ratchet`, `e2e-smoke`, `build`, `beads-validate`
(ci.yml), `secrets`, `audit`, `dependency-review` (security.yml), and `pr-lint` and `changelog` (pr-lint.yml).

`unit` runs the sim benchmarks and `coverage-gate` is the one job that runs the unit and integration tests
(mw-e41.2); `e2e-smoke` aggregates the chromium shards, the Firefox/WebKit audio job and the playthrough.

Only jobs that run on **every** pull request may be required. A path-filtered job, such as plan-check's
`validate`, would never report on unrelated PRs and would block them forever, so it runs but is not
required. When a new check bead adds an every-PR job, add its name to `REQUIRED_CHECKS` in
`scripts/repo-settings.env` and run `scripts/configure-repo.sh`.

## Security settings (set once, not scripted)

Secret scanning, push protection, Dependabot alerts and Dependabot security updates are enabled
(mw-e00.5, mw-e00.6).
