# Coverage exclusions

The **only** place a file may be excluded from unit coverage (backlog contract §3). `vite.config.ts` reads
the Exclusions table below, and `pnpm coverage:exclusions` (run by CI in the `coverage-gate` job) fails
when:

- Vitest excludes anything that isn't listed here;
- a row lacks a reason, a `mw-` bead id or an alternative verification;
- a row touches a 100% layer (`src/sim`, `src/content`, `src/game/save`, `scripts`);
- a glue-layer file (`src/game`, `src/ui`, `src/audio`, `src/tools`) is below 100% lines or branches
  without a row in Glue-layer gaps;
- a `v8`, `istanbul` or `c8` ignore comment appears in a file that isn't excluded here.

**To request an exclusion:** add a row in the same PR as the code, name the bead that justifies it, and
say how the code is verified instead (Playwright smoke, perf budget, manual test plan). The reviewer
approves the row, not just the code.

## Exclusions

| Path glob | Reason | Bead | Alternative verification |
|---|---|---|---|
| `src/main.ts` | Browser bootstrap: wires the layers into the page; no logic of its own. | mw-e00.1 | Playwright smoke `e2e/smoke.spec.ts` (page loads, zero console errors). |
| `src/render/**` | Renderer-specific code (scene graph, materials, shaders, VFX) needs a GPU context. | mw-e00.19 | Playwright boot smoke and perf budgets (`mw-e32.1`). |

## Glue-layer gaps

Files in the ≥ 90% layers that are below 100% lines or branches, with the reason the gap is acceptable.

| File | Reason | Bead |
|---|---|---|
