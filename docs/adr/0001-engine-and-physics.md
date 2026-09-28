# ADR-0001: Renderer and physics engine

- **Status:** Proposed (DRAFT: waiting for the official benchmark run; every `TODO(official)` is filled from it)
- **Date:** 2026-09-28
- **Decider:** Owner
- **Bead:** `mw-e00.13`

## Decision

**Proposed:** render with **Three.js** and simulate physics with **Rapier's deterministic build**
(`@dimforge/rapier3d-deterministic`), with gameplay physics stepped **inside `src/sim`** on the sim's
fixed timestep. `src/render` only reads interpolated transforms. Babylon.js + Havok and Babylon.js + Rapier
are rejected (see [Options](#options-considered)).

The proposal is based on qualitative evidence, the determinism check and a smoke benchmark. It becomes a
decision only once the official benchmark on the reference machine fills the results table and the
scorecard's performance rows are confirmed (AC-1, AC-3).

## Platform: browser vs native engine

The owner has decided to **stay in the browser**. This ADR only chooses between browser engines.

**Why:** agents do all the work, levels included; the owner will not hand-build levels. That needs a
text-only toolchain: TypeScript, data-authored levels, headless tests, Playwright and screenshot checks.
It also gives zero-install playtests from a URL and keeps `src/sim` engine-agnostic.

| Option | Result |
|---|---|
| **Browser (TypeScript + WebGL/WebGPU engine)** | **Chosen** |
| Unity, Unreal | **Rejected**: GUI editors and binary assets are hostile to agents; Unreal cannot target the web |
| Godot 4 | **Rejected**, but the closest alternative: it has an editor, an animation tree, navmesh and Jolt physics. It lost because the owner does not want an editor, its web export is weak, C# has no web export, and `src/sim` would have to be rewritten |
| Bevy | **Rejected**: too immature, with weak animation and tooling |

**Costs we accept:** a lower performance ceiling (measured by this spike); tooling must be built or
borrowed (E33 Developer/Content Tools, Blender → glTF for levels); browser quirks such as pointer lock,
reserved keys and storage eviction (E30 Save/Load, E32 Performance & Browser Compatibility).

**Revisit the platform if:** selling on Steam becomes a goal (first mitigation: wrap the web build in
Tauri or Electron before considering a port); the benchmark misses budgets that the mitigations below
cannot fix; or the owner wants to hand-author levels. No native-engine prototype was built.

## Context

The backlog contract §1 leaves the renderer open ("Three.js vs Babylon.js — decided by the `mw-e00` ADR
spike") and says physics is "Rapier (WASM) unless the engine ADR says otherwise". Stories talk about "the
renderer" so that they do not assume either engine. Twelve beads are blocked on this decision, among them
`mw-e00.19` (bootstrap the renderer), `mw-e03.10` (physics objects stepped inside the sim),
`mw-e02.2` (deterministic kinematic controller) and `mw-e04.2` (swept hitboxes in the sim).

Constraints that decide it:

- **Hardware baseline (contract §1):** High preset at a steady 60 fps at 1440p-equivalent on a MacBook Pro
  M1 Pro 16 GB in current Chrome; JS heap ≤ 1.5 GB; initial download ≤ 50 MB; playable in ≤ 10 s on 50 Mbps.
- **Architecture boundary (contract §2):** rules of the game live in `src/sim`, which is deterministic,
  fixed-step and free of DOM, renderer, wall clock and `Math.random`. It is replay-tested to identical state
  hashes (contract §3), with 100% coverage.
- **Constitution:** "deterministic game systems where practical"; a systemic world (fire, water, physics,
  movable objects) whose outcomes must be consistent and testable without a browser.

## Options considered

| Option | Summary | Result |
|---|---|---|
| **Three.js + Rapier (deterministic)** | Minimal renderer library, rich ecosystem; physics is a separate renderer-agnostic WASM module | **Proposed** |
| Babylon.js + Havok | Full engine with first-party inspector, particles and physics integration; Havok is a closed-source WASM binary driven through Babylon's Physics V2 | **Rejected (proposed)**: roughly 2× main-thread cost per frame in the smoke run, about 2.5× the JS heap, no physics snapshot/restore, and physics bound to the scene graph rather than the sim |
| Babylon.js + Rapier | Babylon renderer, Rapier synced by hand (no official plugin) | **Rejected (proposed)**: same renderer cost as Babylon + Havok, and it gives up Babylon's physics integration, which is Babylon's main advantage over Three.js here |

## Evidence

### How it was measured

Everything is in [`spikes/`](../../spikes/README.md), in its own pnpm workspace outside `src/`, coverage and
the root build. The same scene is described once in `spikes/shared/scene-config.ts` and built by each
prototype. It has a greybox room, a skinned glTF player blending Idle/Walking/Running and 30 skinned NPC
clones (CC0 RobotExpressive). It also has 200 dynamic boxes and barrels that are kicked every 90 frames,
8 moving point lights, a directional light with a 2048² PCF shadow map, a 2000-particle emitter, and HDR
bloom with ACES tone mapping. The drawing buffer is fixed at 2560×1440.

- Frame benchmark: `pnpm -C spikes bench:official [--browser brave]` runs 3 interleaved rounds per
  prototype. Each round has a 5 s warm-up and 30 s of sampling, once with vsync on and once with vsync off
  (`--disable-gpu-vsync --disable-frame-rate-limit`). The browser is headed at a 1280×720 window. The
  harness records TTFF (first *complete* frame), frame intervals, main-thread CPU per frame, GPU time per
  frame (`EXT_disjoint_timer_query_webgl2`), JS heap, the gzip size of the JS + WASM actually fetched, the
  load average and the power source.
- Determinism: `pnpm -C spikes determinism --browsers chrome,chrome,webkit --external Firefox,Safari` runs
  the committed [`spikes/determinism/input-script.json`](../../spikes/determinism/input-script.json) (200
  bodies, 600 steps of 1/60 s, 244 scripted impulses and torque impulses, snapshot before step 300). It
  runs in each browser and in Node, and hashes every body's position, rotation and velocities as float64
  bits at 10 checkpoints.

Versions: three 0.186.1, @babylonjs/core 9.28.0, @babylonjs/havok 1.3.14, @dimforge/rapier3d(-deterministic)-compat
0.21.0, Vite 8.3.1, Playwright 1.63.0.

### Results table (AC-1)

TODO(official): paste the `vsync off` and `vsync on` tables from `spikes/bench/results/<date>-chrome-official.md`
and the Brave one, and `git add -f` those result files.

| Prototype | Frame p50 / p95 / p99 ms (vsync on) | Frame p50 / p95 ms (vsync off) | CPU p95 ms | GPU p95 ms | Bundle gz KB (JS + WASM loaded) | TTFF ms | JS heap MB |
|---|---|---|---|---|---|---|---|
| Three.js + Rapier | TODO(official) | TODO(official) | TODO | TODO | TODO | TODO | TODO |
| Babylon.js + Havok | TODO(official) | TODO(official) | TODO | TODO | TODO | TODO | TODO |
| Babylon.js + Rapier | TODO(official) | TODO(official) | TODO | TODO | TODO | TODO | TODO |

- **Browser:** TODO(official): Google Chrome version, plus the Brave version (Chromium version)
- **OS / machine:** TODO(official): macOS version and build; MacBookPro18,1 (M1 Pro, 16 GB, 16-core GPU); the owner's M3 Mac, if run
- **Low-tier machine:** none available (no Iris Xe / base-M1 8 GB machine). TODO: add one if the owner can
  borrow one, otherwise this stays an open risk for the Low preset.

**Smoke run. These are not the official numbers.** They were taken on 2026-09-28 in Chrome 153.0.8010.53,
headed, on the reference MacBook Pro, with 1 round of 4 s while other agent sessions were building (load
average 4–5 on 10 cores). They only show that the harness works and which way the results lean.

| Prototype | Frame p50 / p95 ms (vsync on, 120 Hz panel) | Frame p50 / p95 ms (vsync off) | CPU p50 / p95 ms | GPU p50 / p95 ms (vsync off) | Bundle gz KB loaded | TTFF ms | JS heap MB |
|---|---|---|---|---|---|---|---|
| Three.js + Rapier | 8.3 / 9.3 | 6.1 / 6.7 | 5.9 / 6.5 | 6.9 / 8.0 | 1772 | ~350 | ~42 |
| Babylon.js + Havok | 12.8 / 13.8 | 12.5 / 13.4 | 12.3 / 13.2 | 5.9 / 8.5 | 1313 | ~870 | ~105 |
| Babylon.js + Rapier | 12.3 / 13.1 | 12.0 / 12.8 | 11.8 / 12.7 | 6.0 / 8.5 | 2260 | ~900 | ~115 |

Reading it:

- **Both engines keep up with 60 Hz; Three.js has about twice the headroom.** All three have p95 well
  under 16.7 ms. With vsync off, Babylon is CPU-bound at about 12–13 ms of main-thread work per frame,
  which leaves about 4 ms of a 60 Hz frame for game logic, AI, audio and UI. Three.js needs about 6 ms,
  leaving about 10 ms.
- **Profile of the Babylon prototype** (CDP sampling, Chrome headless): the cost is spread across
  per-mesh and per-light work each frame, led by uniform caching (`_cacheFloat4`, about 7%), world-matrix
  sync, active-mesh evaluation, material updates and light binding. No single setting fixes it. One
  setting did matter: Babylon's default of re-fitting the shadow frustum to every caster each frame cost
  about 6%, so it was turned off to match the Three prototype. Babylon has deeper CPU optimisations
  (`freezeActiveMeshes`, frozen materials, thin instances) that were **not** tried. Three.js would get
  the same instancing gains.
- **Bundle:** Three.js alone is about 160 KB gz. The Rapier `-compat` packages inline their WASM as
  base64 (1614 KB gz inside JS, against 1141 KB gz as a separate `.wasm`), so a production Three + Rapier
  build is about 1.3 MB gz, comparable to Babylon + Havok (670 KB JS + 643 KB WASM). All options are far
  below the 50 MB budget.
- **GPU time** is similar (6–9 ms) and not the bottleneck on the M1 Pro. Three's `UnrealBloomPass` is
  heavier than Babylon's pipeline bloom. Treat timer-query numbers on ANGLE/Metal as indicative.

### Determinism (AC-2)

Smoke run on 2026-09-28 on the reference MacBook Pro. TODO(official): rerun with Firefox (see below) and
record it here. Script: `spikes/determinism/input-script.json`.

| Runtime | rapier-deterministic 0.21.0 | rapier-standard 0.21.0 | Havok 1.3.14 |
|---|---|---|---|
| Chrome 153.0.8010.53, run 1 | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| Chrome 153.0.8010.53, run 2 | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| Playwright WebKit 26.6 | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| Safari 27.0 (real app, `--external Safari`) | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| Node 24.21.0 | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| Firefox | TODO: blocked, see below | TODO | TODO |
| **Snapshot → restore → replay steps 300–599** | **identical** (every checkpoint) | **identical** | **differs** (no snapshot API; copying transforms and velocities into a new world does not carry Havok's internal contact/solver state) |

- **Final hashes match across every runtime tested, for all three engines.** This is expected: WASM float
  arithmetic is IEEE-754 and neither module imports `Math.*` from the host (checked: 0 of 29 Rapier and 0
  of 25 Havok WASM imports are math functions). Every runtime here is the same Apple-silicon CPU, though.
  The deterministic build's point is portability across CPU architectures and compilers. **Not tested:**
  x86-64 (Windows/Linux/Intel Mac). Proposed follow-up: run `node spikes/determinism/src/node-run.ts` on a
  CI `ubuntu-latest` x86-64 runner and compare hashes. It takes a few seconds.
- **Only Rapier has real snapshot/restore.** `World.takeSnapshot()` / `World.restoreSnapshot()` continue
  bit-identically. The snapshot is 350 KB for 200 bodies, so it needs compression if it goes into saves.
- **Firefox is blocked on this machine.** Playwright's Firefox 155 build (`firefox-1543`) exits with
  "Could not find profile folder" on macOS 27, headless or headed, even when launched by hand. The harness
  can drive a real Firefox through `--external Firefox` (it opens the page with `open -a`, and the page
  posts its result back). Stock Firefox is not installed. **Owner action:** install Firefox, or run the
  check on the M3.
- **Cost:** 600 + 300 replayed steps took about 460 ms with the deterministic build, about 410 ms with the
  standard build and about 300 ms with Havok. That is roughly 0.5 ms per step for 200 awake bodies, a
  real share of the sim's 1 ms `step()` budget (`mw-e00.15` AC-6). The e03 max-body budget and sleeping
  have to respect it.

### Qualitative evidence

- **TypeScript ergonomics.** Three.js uses `@types/three`, versioned in lockstep. The prototype
  type-checked under the project's strict settings (`noUncheckedIndexedAccess`) with plain imports.
  Babylon is written in TypeScript, but tree-shaken deep imports rely on side-effect imports, and the
  Babylon prototypes needed five of them: shadow generator component, particle component, physics
  component, animatable, glTF loader. Leaving one out fails at runtime, not at compile time. Babylon also
  degrades silently in places: PBR materials render at most 4 lights by default, and shadow extents are
  auto-fitted. Both matter to agents, who learn from errors, not from missing pixels.
- **glTF and animation.** Both loaded the same skinned glTF, cloned it 30 times and blended three clips
  by weight in about 20 lines. Three.js uses `SkeletonUtils.clone` + `AnimationMixer` weights, and
  `SkeletonUtils.retargetClip` for retargeting (functional, less polished). Babylon uses
  `instantiateModelsToScene` (clones animation groups) + `AnimationGroup.weight`, and has built-in
  retargeting (`AnimatorAvatar`). Babylon is ahead on retargeting. `e37-3d-pipeline-decision` should
  consume this.
- **Inspector and debug tooling.** Babylon's first-party Inspector, Playground and node editors are
  clearly better. Three.js relies on Spector.js, community devtools and lil-gui. This matters less in a
  project where agents debug through tests, screenshots and a text debug console (E33), but it is a real
  gap for the owner's playtests.
- **WebGPU path.** Babylon's `WebGPUEngine` is mature and ships WGSL shaders. Three.js ships
  `WebGPURenderer` with TSL and a WebGL2 fallback (`three/webgpu`, `BloomNode`), but moving from
  `EffectComposer` to TSL post-processing is a migration. Both have a credible path.
- **Docs and community.** npm weekly downloads for the week to 2026-09-28: three 19.6 M, @babylonjs/core
  0.42 M, @dimforge/rapier3d-compat 10.3 M, @babylonjs/havok 23 k. Three.js has far more examples and
  answers, which also helps agents. Babylon's official docs and forum, with the core team answering, are
  excellent.
- **Licence.** three is MIT; Babylon is Apache-2.0; Rapier is Apache-2.0. Havok's npm package is
  MIT-licensed but is a closed-source binary, so we could not patch or audit it.

### Weighted scorecard (AC-3)

Scores are 1–5. Weights are proposed and should be confirmed by the owner. Performance scores are
provisional until the official run.

| Criterion | Weight | Three + Rapier | Babylon + Havok | Babylon + Rapier | Basis |
|---|---|---|---|---|---|
| Runtime performance (p95 frame, CPU/GPU headroom) | 25 | 5 | 3 | 3 | Smoke: CPU 6 vs 12–13 ms per frame. TODO(official) |
| Physics determinism + `src/sim` fit | 20 | 5 | 2 | 5 | Rapier snapshot/restore identical, runs in Node, renderer-agnostic; Havok has no snapshot and is bound to Babylon's scene |
| Bundle size, TTFF, heap | 10 | 4 | 3 | 2 | Smoke: TTFF ~350 vs ~870 ms, heap ~42 vs ~105 MB. TODO(official) |
| glTF / animation / retargeting | 10 | 4 | 5 | 5 | Babylon has built-in retargeting |
| TypeScript ergonomics (for agents) | 10 | 4 | 3 | 3 | Babylon's side-effect imports and silent defaults |
| Inspector / debug tooling | 7 | 2 | 5 | 5 | Babylon Inspector |
| WebGPU path | 6 | 4 | 5 | 5 | Both viable; Babylon more mature |
| Docs / community | 7 | 5 | 4 | 3 | Babylon + Rapier is an unsupported combination |
| Licence | 5 | 5 | 4 | 5 | Havok is a closed binary |
| **Weighted total (of 100)** | 100 | **88.6** | **67.6** | **77.2** | Σ(weight × score) / 5 |

The ranking holds if performance is weighted 0. The totals are then 63.6, 52.6 and 62.2, which is closer
between Three + Rapier and Babylon + Rapier. The deciding factors are then the renderer's CPU cost per
frame and heap, and physics living in the sim. It would flip toward Babylon only if tooling and
retargeting together weighed more than performance and determinism.

## Where gameplay physics runs (AC-5)

**Proposal: inside `src/sim`, deterministically.** Rapier's deterministic build is stepped by the sim on
its fixed timestep and wrapped behind a sim-owned physics port, as `mw-e03.10` already assumes. The sim
owns bodies, impacts and outcomes. `src/game` never steps physics, and `src/render` only interpolates the
transforms the sim publishes.

Why not `src/game` with sim-owned outcomes: the replay tests hash sim state (contract §3). If physics ran
outside the sim, every tumble, stack and impact that feeds breakables, noise and damage would be outside
the replayed state. We would then need either a second determinism mechanism or rules that ignore physics.
With Rapier deterministic that trade buys nothing.

How it fits the §2 rules:

- *No DOM, no renderer, no wall clock, no `Math.random`:* Rapier is a WASM module with no DOM or host math
  imports, and it steps on the dt it is given. `node spikes/determinism/src/node-run.ts` shows it running
  under plain Node, so Vitest can run sim physics tests without a browser.
- *Async initialisation:* WASM needs `await init()`. The sim stays synchronous by taking an
  already-initialised physics module (injected like the clock and RNG). The async load lives in
  `src/game` bootstrap and in test setup.
- *100% coverage:* covers the TypeScript port in `src/sim`. The WASM binary is a dependency, like zod.
  Tests run the real engine in Node, and a reference integrator stays possible for pure unit tests, as
  `mw-e03.10` suggests.
- *Layer lint:* `eslint/layers.js` restricts imports between `src/` layers, not npm packages. Importing
  `@dimforge/rapier3d-deterministic-compat` from `src/sim` needs no rule change. It is worth adding a rule
  that only the physics port may import it.
- *Replays and saves:* restoring from a Rapier snapshot continues bit-identically, so save/load and replay
  checkpoints can store physics state exactly (350 KB per 200 bodies before compression).

**The contract's "the renderer" wording stays valid.** Physics is not part of the renderer, so stories keep
saying "the renderer" for whatever `src/render` wraps. When this ADR is accepted, the contract §1 rows
become "Rendering engine: Three.js (ADR-0001)" and "Physics: Rapier deterministic build, stepped inside
`src/sim` (ADR-0001)". Babylon + Havok would have broken this: its Physics V2 aggregates attach bodies to
scene-graph nodes and step inside `scene.render()`, which puts physics on the renderer's side of the
boundary.

## Performance gap and mitigations (AC-4)

TODO(official): fill in from the official run. If every option has **p95 ≤ 16.7 ms on High** with vsync
on, record "no gap" plus the headroom (16.7 minus CPU p95), and keep the mitigations below as the plan for
growth. If an option misses, record the gap in milliseconds and which mitigations are assumed to close it.

The smoke run shows no gap on the reference machine: p95 ≤ 13.8 ms for every option. But the scene is
lighter than a full combat encounter (no AI, audio, UI or game logic), and the Low preset is untested.

Mitigations the renderer bootstrap and E32 should assume, cheapest first:

1. Instancing for repeated props (boxes and barrels as one `InstancedMesh` each: about 200 fewer draw
   calls in each of the main and shadow passes).
2. Animation LOD: update distant NPC mixers at 30 or 15 Hz, and stop off-screen ones.
3. Fewer shadow casters: small props and distant NPCs do not cast. Use a 1024² shadow map on Low, and
   cascades only if a level needs them.
4. Bloom at half resolution; the particle budget from `mw-e29.1`.
5. Dynamic resolution scale on Low (render below 1080p, upscale), keeping the UI at native resolution.
6. Physics budget: cap awake bodies (`mw-e03.10` max-body budget) and rely on sleeping.

Budget changes to propose if the official run misses: TODO(official). Candidates: define "1440p-equivalent"
as a render scale rather than a fixed buffer; set a per-subsystem CPU budget (render submission ≤ 7 ms,
sim ≤ 4 ms); and add the "worst-case combat 30 fps floor" from the Low preset to High as well.

## Consequences

- `mw-e00.19` bootstraps Three.js with a Rapier deterministic physics port in `src/sim`; `mw-e03.10`,
  `mw-e02.2`, `mw-e04.2` and `mw-e05.2` build on that port.
- We build our own debug overlay and inspector-like tools (E33) instead of getting Babylon's Inspector
  for free.
- We ship Rapier's WASM as a separate `.wasm` file, not the base64 `-compat` package (about 470 KB gz saved).
- Animation retargeting uses `SkeletonUtils.retargetClip` or pre-retargeted clips from the 3D pipeline
  (`e37-3d-pipeline-decision`).
- Physics step cost counts against the sim `step()` budget.
- The spike code in `spikes/` is deleted, or moved to an archive branch, after this ADR merges.

## Revisit triggers

- The official run or a later perf-budget suite (`e32-perf-budgets`) shows Three.js + Rapier missing
  p95 ≤ 16.7 ms on High after the mitigations above, while another option meets it.
- Rapier deterministic hashes differ across the browsers or CPU architectures we support (x86-64 CI run,
  Firefox, Edge), or a Rapier release breaks snapshot compatibility.
- Physics step cost for a real level's awake bodies exceeds its share of the sim budget.
- Three.js drops WebGL2 support before `WebGPURenderer` covers our pipeline, or its release cadence
  causes more breaking changes than one upgrade bead per quarter can absorb.
- The owner starts regular hands-on scene debugging and the missing inspector costs more than building E33
  tools.
- Any platform trigger in [Platform: browser vs native engine](#platform-browser-vs-native-engine).
