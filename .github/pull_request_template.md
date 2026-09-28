## Summary

<!-- What changed and why, for someone who has not read the bead. Call out any deviation from the bead text. -->

## Acceptance criteria

<!-- One row per AC in the bead. Tests name the AC: it('AC-2: ...'). -->

| AC   | Test / evidence |
| ---- | --------------- |
| AC-1 |                 |

## Validation

<!-- Commands run and results, e.g. pnpm lint, pnpm typecheck, pnpm test:coverage (N tests, 100%), pnpm e2e, actionlint. -->

## Definition of Done (backlog contract §3)

- [ ] Every automatable AC is covered by a test that names it
- [ ] Coverage thresholds met, ratchet not decreased
- [ ] Coverage exclusions touched: none <!-- or list the coverage-exclusions.md entries added or changed, with the reason -->
- [ ] Lint, typecheck, unit and e2e smoke green in CI
- [ ] Content/data schema validation green
- [ ] CHANGELOG.md: n/a <!-- or the one-line note for user-facing changes -->
- [ ] Opened from a worktree branch; will be squash-merged and the beads closed with --reason "Completed in PR #N"

<!--
Closes lines: one per completed bead, full id, nothing else on the line, e.g.

  Closes mw-e00.8

CI (pr-lint) fails without one. Trivial chores with no bead need the "no-bead" label from a maintainer.
Ids must exist in .beads/issues.jsonl; for a bead created since the last export, add a fresh
`bd export -o .beads/issues.jsonl` to the PR.
-->
