# The Vesper Bell

A desktop-first, browser-based fantasy action RPG. Start with [`CONSTITUTION.md`](CONSTITUTION.md)
for the vision and [`docs/backlog-contract.md`](docs/backlog-contract.md) for how work is planned and tested.
The backlog is published at https://thevesperbell.com/backlog.html.

## Quickstart

You need Node 24 LTS, the version pinned in `.node-version`. `engine-strict` makes `pnpm install` fail
on any other major. pnpm comes through corepack, pinned by `packageManager` in `package.json`.

```bash
# Node 24: any manager that reads .node-version works (fnm, mise, nodenv…), or with Homebrew:
brew install node@24 && export PATH="$(brew --prefix node@24)/bin:$PATH"
corepack enable          # Node 25+ no longer bundles corepack: npm i -g corepack first

pnpm install
pnpm dev                 # Vite dev server
```

| Script               | What it does                                                     |
| -------------------- | ---------------------------------------------------------------- |
| `pnpm dev`           | Vite dev server with HMR                                         |
| `pnpm build`         | Production build into `dist/`                                    |
| `pnpm preview`       | Serve `dist/` locally                                            |
| `pnpm lint`          | ESLint (typed `typescript-eslint` strict rules + Prettier compat) |
| `pnpm format`        | Prettier write (`format:check` to verify only)                   |
| `pnpm typecheck`     | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| `pnpm test`          | Vitest unit + integration tests                                  |
| `pnpm test:coverage` | Vitest with v8 coverage into `coverage/` (text, json-summary, lcov) |
| `pnpm e2e`           | Playwright smoke tests against the production build              |
| `pnpm bench`         | Vitest benchmarks (`*.bench.ts`) that assert sim perf budgets    |
| `pnpm content:coverage` | After `pnpm test`: fails listing content entries no passing test exercised |
| `pnpm content:schemas`  | Regenerates `src/content/data/<type>.schema.json` for editor autocompletion |
| `pnpm content:docs`     | Regenerates the field reference `docs/content/<type>-schema.md` for each content type |
| `pnpm replay:record`    | Records a registered sim scenario into a golden replay in `tests/replays/` |
| `pnpm replay:rebless`   | Re-records golden replays after an intended sim/content change (review the diff) |

First e2e run: `pnpm exec playwright install chromium`.

## Layout

Code lives in `src/`, split into layers (contract §2), each importable through an alias (`@sim/*`,
`@content/*`, …) defined once in `tsconfig.json` `paths`:

| Layer          | Holds                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| `src/sim`      | Pure, deterministic game rules: no DOM, no renderer, no wall clock or `Math.random` |
| `src/content`  | Schemas and data files                                                 |
| `src/game`     | Glue that binds sim, renderer, input, audio and UI                     |
| `src/render`   | Renderer-specific code                                                 |
| `src/audio`    | Web Audio playback and mixing                                          |
| `src/ui`       | HUD, menus and dialogue UI                                             |
| `src/tools`    | Dev and content tools                                                  |

**Layer rules are enforced by ESLint** (`eslint/layers.js`; each rule is proven by a fixture in
`tests/lint-fixtures/`):

- `src/sim` must stay deterministic: no `Math.random`, `Date`, `performance`, `crypto`, timers, DOM or
  browser globals. Use the seeded RNG and injected clock instead. `eslint-disable` comments for these rules
  are themselves errors. Iterate arrays and `Map`s (insertion-ordered); avoid `for…in`, even where the
  spec fixes the order.
- Imports: `sim` and `content` may import each other only as types. `render`, `audio` and `ui` may import
  `sim` and `content`. `game` may import every runtime layer, but not `tools`. `tools` may import anything.
  The bootstrap (`src/main.ts`) is unrestricted.

**Coverage** (contract §3) is enforced in CI from one file, `coverage-layers.json`. `src/sim`,
`src/content`, `src/game/save` and `scripts/*.ts` need 100% on every file. `src/game`, `src/ui`, `src/audio`
and `src/tools` need ≥ 90% lines and branches. A **ratchet** (`pnpm coverage:ratchet`) fails a PR if any
metric falls versus main, globally or per layer. When main's CI artifact is unavailable it falls back to the
committed `coverage-baseline.json`; refresh that with `pnpm test:coverage && pnpm coverage:baseline`.
Exclusions and glue-layer gaps live only in `coverage-exclusions.md` (`pnpm coverage:exclusions` checks
them); see that file for how to request one.

**Content** (mw-e00.18) is data, not code. Each content type is a zod schema registered in
`src/content/registry.ts`; each entry is one JSON file at `src/content/data/<type>/<name>.json` (optionally
starting with `"$schema": "../<type>.schema.json"` for editor autocompletion). `loadGameContent()` validates
every file, rejects duplicate ids and references (`ref('creature')`) to missing entries, reporting every
problem with file and JSON pointer, and returns a deeply frozen catalogue with a content hash. Every entry
needs a passing test: `describeContent(type, 'AC-n: …', (entry) => …)` from `src/content/testing.ts`
generates one per entry (or credit a hand-written test with `markExercised`); CI's `pnpm content:coverage`
fails otherwise.

**Replays** (mw-e00.17) are the determinism net (contract §3). A replay (`src/sim/replay/format.ts`) is a
versioned JSON file: the scenario, seed and tick rate, the run-length encoded sim commands fed to
`World.step` on each tick, and a state hash (plus snapshot) every 60 ticks. Every `tests/replays/*.json`
runs in CI (`expectReplay` from `src/tools/replay/expect-replay.ts`); a failure names the first diverging
checkpoint and the entity/component/field that differs, and says when the content hash changed instead.
Scenarios (the code that builds the world a replay drives) register in `src/sim/replay/scenarios/`.

**Secrets** never go in the repo. The `secrets` CI job (`.github/workflows/security.yml`) runs gitleaks over
every PR's commits and the full history on main, and GitHub push protection is on. Locally,
`pnpm hooks:install` (or `bd hooks install`) points git at `.beads/hooks`, whose pre-commit also scans staged
changes when gitleaks is installed (`brew install gitleaks`). A false positive gets an allowlist entry in
`.gitleaks.toml` with a comment explaining it (`pnpm secrets:lint` enforces that).

**Dependencies:** the `audit` CI job (also nightly) fails on any CRITICAL advisory, whether in a runtime
or a dev dependency, and warns on HIGH; `pnpm deps:audit` runs the same check locally. A temporary waiver
goes in `audit-waivers.json` with the GHSA id, a reason, a bead and an expiry date. PRs also run GitHub
dependency review (critical advisories, GPL/AGPL licences). Dependabot opens grouped weekly updates.

Tests sit next to the code as `*.test.ts`. Toolchain tests live in `tests/`, Playwright specs in `e2e/`.
`site/` is the separate static landing site; it is not part of the Vite app.
