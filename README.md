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

Tests sit next to the code as `*.test.ts`. Toolchain tests live in `tests/`, Playwright specs in `e2e/`.
`site/` is the separate static landing site; it is not part of the Vite app.
