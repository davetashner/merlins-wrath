# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Source of truth

- `CONSTITUTION.md` — product vision and design pillars. Everything is subordinate to it.
- `docs/backlog-contract.md` — how beads are written, coverage policy, DoD, asset workflow, hardware baseline.
- `docs/narrative/story-bible.md` — story canon (names, places, plot). `docs/art/style-bible.md` and `docs/audio/audio-bible.md` — asset consistency; every asset prompt starts from their preambles.
- Backlog: `bd` (prefix `mw-`), published at https://thevesperbell.com/backlog.html on every merge to main (S3 + CloudFront in AWS account 205074708100, defined in `infra/site.yml`).

## Workflow

1. Pick work from `bd ready`; claim it (`bd update <id> --claim`).
2. Create a worktree from latest main: `git fetch origin main && git worktree add .claude/worktrees/<branch> -b <branch> origin/main`.
3. Implement with tests that name the ACs (`it('AC-2: ...')`). Coverage rules in the contract §3 are enforced by CI; never lower coverage.
4. Commit with sign-off (`git commit -s`), reference the bead ID in the message.
5. Open a PR to `main` with one `Closes mw-…` line per completed bead. Squash merge only.
6. After merge: `bd close <id> --reason "Completed in PR #N"`, export (`bd export -o .beads/issues.jsonl`) in the next PR, remove the worktree.

## Build & Test

Node 24 (`.node-version`, engine-strict) and pnpm via corepack. See README Quickstart.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # quality gates
pnpm test:coverage                        # coverage/ (json-summary + lcov)
pnpm e2e                                  # Playwright smoke vs production build
pnpm build                                # dist/
```

## Architecture Overview

Deterministic, engine-agnostic game rules in `src/sim` (100% coverage, no DOM/renderer/wall clock/Math.random); data-driven content in `src/content`; renderer/audio/UI glue in `src/game`, `src/render`, `src/audio`, `src/ui`. World interactions are property-based (flammable, wet, conductive…) via a single stimulus API — never pairwise scripted. See contract §2.

## Assets

Images: Claude generates via Codex CLI. 3D: Claude generates via Meshy/Tripo API from owner-approved flat images. SFX: ElevenLabs API. Music: owner pastes Claude's prompt into Suno. The owner approves every asset (flat image, 3D turntable, music take, SFX batch); approvals are recorded and enforced in CI. API keys only via environment variables — never commit or log them.
