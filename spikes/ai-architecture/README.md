# AI architecture spike (mw-e11.1, ADR-0005)

Throwaway prototypes behind [ADR-0005](../../docs/adr/0005-ai-architecture.md). **This is not game code.**
The production runtime is `mw-e11.2` in `src/sim/ai/`, which starts fresh from the ADR. Do not import from
here.

The same scenario, **patrol → hear a noise → investigate → return to the route**, is built three ways.
Everything except the decision layer is shared, so the prototypes differ only in how they decide:

| Path | What |
|---|---|
| `shared/world.ts` | Scenario world: agents on square patrol loops, a noise schedule (scripted or seeded random), hearing → awareness (a stand-in for e11.5/e11.6 using the `humanoid` sense profile: 30 dB threshold, 25 m range), the action primitives (`follow-route`, `move-to`, `look-toward`, `look-around`, `rest`, `wait`, `clear-stimulus`, `set-alert`), think scheduling (10 Hz staggered by id, act every tick), save/load and state hashing |
| `shared/inputs.ts` | Named numeric inputs (`awareness`, `trait.*`, `need.sleep`, `timeInState`, `offRoute`, `hasStimulus`) resolved once at load |
| `bt/` | **Candidate A, behaviour tree**: `runtime.ts` (reactive selector, sequence with optional memory, condition, action) and `fixture-guard.bt.json` |
| `hybrid/` | **Candidate B, HFSM + utility**: `runtime.ts` (alert-state machine with data transitions and timeouts, utility scoring of each state's activities, activities as step lists) and `fixture-guard.json` |
| `hybrid/flat-utility.json` | **Candidate C, flat utility**: the same runtime with a single state, so all activities compete at once and set the alert label themselves |
| `candidates.ts` | Builds the three brains from their JSON |
| `scenario.test.ts` | The scenario, personality/needs, AC-3 determinism, save/restore, introspection and validation tests |
| `tick-cost.bench-run.ts` | AC-2 benchmark; writes `results/tick-cost.json` |

## Running it

From the repository root, with the root dependencies installed (`pnpm install`):

```bash
pnpm exec vitest run --config spikes/ai-architecture/vitest.config.ts                     # tests
AI_SPIKE_BENCH=1 pnpm exec vitest run --config spikes/ai-architecture/vitest.config.ts   # benchmark
pnpm exec tsc -p spikes/ai-architecture                                                  # typecheck
```

## How it stays out of the game's gates

It uses the root toolchain (Vitest, TypeScript, the `@sim/*` aliases) so it can reuse the real sim
`Rng`, deterministic `math` and canonical state hashing. It still stays out of every root gate, for the
same reasons as the engine spike next to it:

- **Lint and format:** `eslint.config.js` and `.prettierignore` ignore `spikes/`.
- **Typecheck:** the root `tsconfig.json` only includes `src`, `tests`, `e2e` and `scripts`. This spike has
  its own `tsconfig.json`, which extends the root one and so gets the same strict flags. Run it by hand
  with the command above.
- **Tests and coverage:** the root Vitest config only includes `src/`, `tests/` and `scripts/`, and coverage
  only measures `src/` and `scripts/`. Spike code therefore never counts against the 100 % sim gate or the
  ratchet, and `coverage-exclusions.md` does not need an entry. The spike's own tests run only through
  its own config.
- **Build:** nothing in `src/` imports it.

Why it is excluded: prototypes are written to answer a question within a time box. Holding them to 100 %
coverage and lint would cost more than the spike, and they are deleted once `mw-e11.2` lands
(see ADR-0005, Consequences).
