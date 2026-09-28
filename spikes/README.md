# Engine and physics spike (mw-e00.13, ADR-0001)

Throwaway prototypes and a benchmark harness for choosing the renderer and physics engine. **This is not
game code.** It lives outside `src/`, has its own pnpm workspace and lockfile (`spikes/pnpm-workspace.yaml`),
and the root lint, format, typecheck, tests, coverage, build and audit all skip it. Delete or archive it
once ADR-0001 is accepted.

| Path | What |
|---|---|
| `shared/scene-config.ts` | The benchmark scene as plain data + pure functions of the frame number, so every prototype builds exactly the same thing |
| `shared/bench-hook.ts` | In-page instrumentation read by the harness (`window.__bench`) |
| `engine-three/` | Three.js r186 + Rapier 0.21 (`@dimforge/rapier3d-compat`) |
| `engine-babylon/` | Babylon.js 9.28 + Havok 1.3.14 (`index.html`, built to `dist-havok/`) and Babylon.js + Rapier (`rapier.html`, `dist-rapier/`) |
| `determinism/` | AC-2: committed 600-step physics input script (`input-script.json`), runners for Rapier deterministic, Rapier standard and Havok |
| `bench/run.ts` | Frame benchmark harness (Playwright, headed Chrome/Brave) |
| `bench/determinism.ts` | Cross-browser state-hash harness |

## The scene (identical in every prototype)

Greybox room 40×40 m with walls and six pillars; one skinned glTF player blending Idle/Walking/Running by
weight while jogging a figure-eight; 30 skinned NPC clones each playing a clip; 200 dynamic rigid bodies
(100 boxes, 100 cylinders "barrels", mass 1) with 20 of them kicked every 90 frames so the pile never
sleeps; 8 moving point lights (no shadows) + 1 directional light with a 2048² PCF shadow map and a fixed
shadow frustum; one 2000-particle additive emitter above an emissive brazier; HDR bloom and ACES tone mapping.

- The drawing buffer is fixed at **2560×1440** whatever the window or `devicePixelRatio` (contract §1 High,
  1440p-equivalent). The harness window is 1280×720 CSS px, which is 2560×1440 device pixels on a Retina display.
- One physics step of 1/60 s and one 1/60 s animation step per rendered frame in every prototype, so the
  work per frame is the same whatever the frame rate.
- No MSAA (both pipelines render into post-processing targets); separate meshes sharing geometry for the
  bodies (no instancing) in both engines.
- Stock engine features: Three's `UnrealBloomPass` + a hand-written CPU `Points` emitter (Three has no
  particle system); Babylon's `DefaultRenderingPipeline` bloom + CPU `ParticleSystem`. Babylon's PBR
  `maxSimultaneousLights` is raised from its default of 4 to 12, otherwise it silently drops point lights.
- TTFF means the first *complete* frame: Babylon compiles shaders in parallel and skips unready meshes, so
  its prototypes only count frames after `scene.executeWhenReady`.

## Running

Needs Node 24 and pnpm via corepack (same as the game). Works on a fresh clone on any Mac.

```bash
corepack enable
pnpm -C spikes setup                       # install + Playwright WebKit/Firefox for the determinism check

# Official frame benchmark: 3 interleaved rounds × 3 prototypes × vsync on/off, 5 s warm-up + 30 s sampled
pnpm -C spikes bench:official              # Google Chrome (contract reference browser), ~15 min
pnpm -C spikes bench:official --browser brave

# AC-2 determinism: Chrome twice, WebKit, Node, plus real apps opened with `open -a` that post results back
pnpm -C spikes determinism --browsers chrome,chrome,webkit --external Firefox,Safari

pnpm -C spikes bench:quick --headless      # 1 round, 5 s: smoke-tests the harness only
```

Results land in `spikes/bench/results/` (git-ignored) as JSON + Markdown (+ one screenshot per prototype).
`git add -f` the official ones when the ADR records them.

`bench/run.ts` options (override the preset): `--browser chrome|brave|edge|chromium|<path>`, `--rounds`,
`--warmup` / `--sample` (seconds), `--vsync on|off|both`, `--prototypes three-rapier,babylon-havok,babylon-rapier`,
`--load-threshold 3 --load-wait-min 0` (the load gate logs the 1-minute load average before and after each
block and flags blocks above the threshold; it only waits if you give it minutes), `--window 1280x720`,
`--no-build`, `--screenshots false`, `--out DIR`, `--headless` (smoke only).

### What the numbers mean

- **Frame p50/p95/p99** — interval between successive frame starts (rAF cadence), median of the
  per-round percentiles. With **vsync on** it cannot go below the display refresh (8.33 ms on the 120 Hz
  ProMotion panel of the reference MacBook Pro, 16.7 ms on 60 Hz displays), so a capped p50 only says
  "keeps up". With **vsync off** (`--disable-gpu-vsync --disable-frame-rate-limit`) the interval is the
  real CPU+GPU throughput; use that run to compare engines and the vsync-on run for the ≤ 16.7 ms budget.
- **CPU p50/p95** — main-thread time inside the frame callback (animation, physics, scene submission).
  If CPU ≈ frame interval with vsync off, the scene is CPU-bound.
- **GPU p50/p95** — `EXT_disjoint_timer_query_webgl2` time of each frame's GL commands; `n/a` when the
  browser does not expose the extension.
- **Bundle gz** — gzip -9 of the JS + WASM the page actually fetched (the shared 464 KB glTF excluded);
  **dist gz** is the whole build output (Babylon emits many lazy chunks it never loads here).
  `@dimforge/rapier3d-compat` inlines its WASM as base64 inside JS (1614 KB gz vs 1141 KB gz as a
  `.wasm` file), so Rapier prototypes' JS numbers are inflated by ~470 KB versus a production build that
  ships the `.wasm` separately.
- **JS heap** — `performance.memory.usedJSHeapSize` with `--enable-precise-memory-info`, and V8's
  `Runtime.getHeapUsage` over CDP. WASM linear memory is not part of either.
- **Noise** — 1-minute load average before/after every block, power source (`pmset -g batt`), low-power mode
  and thermal warnings. Engines are interleaved (round 1: A B C, round 2: B C A, …) so background load
  hits them equally.

## Test assets and licences

| Asset | Source | Licence |
|---|---|---|
| `shared/models/RobotExpressive.glb` (skinned, 14 clips incl. Idle/Walking/Running) | Tomás Laulhé ([Quaternius](https://quaternius.com)), glTF conversion and modifications by Don McCurdy; copied from [three.js r186 `examples/models/gltf/RobotExpressive`](https://github.com/mrdoob/three.js/tree/r186/examples/models/gltf/RobotExpressive) | CC0 1.0 |

Everything else is generated geometry. The model is a benchmark stand-in only: it is not in `assets/`, not
in the asset approval pipeline and must not ship in the game.

| Dependency | Version | Licence |
|---|---|---|
| three / @types/three | 0.186.1 / 0.186.0 | MIT |
| @babylonjs/core, @babylonjs/loaders | 9.28.0 | Apache-2.0 |
| @babylonjs/havok | 1.3.14 | MIT |
| @dimforge/rapier3d-compat, @dimforge/rapier3d-deterministic-compat | 0.21.0 | Apache-2.0 |
| playwright | 1.63.0 | Apache-2.0 |
| vite / typescript | 8.3.1 / 6.0.3 | MIT / Apache-2.0 |

All versions are pinned exactly; `pnpm -C spikes audit` reported no known vulnerabilities on 2026-09-28.

## Known limitations

- Playwright's Firefox build (firefox-1543, Firefox 155) exits with "Could not find profile folder" on this
  macOS 27 machine, headless or headed, even when launched by hand. The determinism harness therefore also
  supports real browsers via `--external <App>`: it opens the page with `open -a` and the page POSTs its
  result back. Safari works this way; Firefox needs the stock Firefox app installed.
- GPU time comes from `EXT_disjoint_timer_query_webgl2` (Chrome exposes it on macOS). On ANGLE/Metal it is
  indicative rather than exact; the vsync-off frame interval is the ground truth for throughput.
- Havok has no world snapshot API. Its "restore" copies every body's transform and velocities into a new
  world, which is what a game could do; it is reported so the difference from Rapier's real snapshot is visible.
