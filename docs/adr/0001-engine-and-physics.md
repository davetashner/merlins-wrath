# ADR-0001: Renderer and physics engine

- **Status:** Accepted
- **Date:** 2026-09-28
- **Decider:** Owner
- **Bead:** `mw-e00.13`

## Decision

Render with **Three.js** and simulate physics with **Rapier's deterministic build**
(`@dimforge/rapier3d-deterministic`), with gameplay physics stepped **inside `src/sim`** on the sim's
fixed timestep. `src/render` only reads interpolated transforms. Babylon.js + Havok and Babylon.js + Rapier
are rejected (see [Options](#options-considered)).

The decision rests on the official benchmark on the reference machine (Chrome 154 and Brave 154), the
determinism check across six runtimes and the qualitative evidence below. The owner accepted the decision
and the scorecard weights on 2026-09-28 (AC-3).

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
| **Three.js + Rapier (deterministic)** | Minimal renderer library, rich ecosystem; physics is a separate renderer-agnostic WASM module | **Chosen** |
| Babylon.js + Havok | Full engine with first-party inspector, particles and physics integration; Havok is a closed-source WASM binary driven through Babylon's Physics V2 | **Rejected**: roughly 2× the main-thread cost per frame in the official run (CPU p95 11.2 vs 5.7 ms), about 3× the JS heap, no physics snapshot/restore, and physics bound to the scene graph rather than the sim |
| Babylon.js + Rapier | Babylon renderer, Rapier synced by hand (no official plugin) | **Rejected**: same renderer cost as Babylon + Havok, and it gives up Babylon's physics integration, which is Babylon's main advantage over Three.js here |

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

Official run on 2026-09-28 on the reference machine. Raw results:
[`2026-09-28T22-52-14-chrome-official`](../../spikes/bench/results/2026-09-28T22-52-14-chrome-official.md)
and [`2026-09-28T23-03-23-brave-official`](../../spikes/bench/results/2026-09-28T23-03-23-brave-official.md)
(`.md` + `.json`).

- **Browsers:** Google Chrome 154.0.8037.58 (contract reference browser); Brave 154.1.96.59 (Chromium 154.0.8037.58)
- **OS / machine:** macOS 27.0 (26A428); MacBookPro18,1, Apple M1 Pro (10 CPU cores, 16-core GPU), 16 GB;
  built-in 3456×2234 Liquid Retina XDR display at 120 Hz (ProMotion); on AC power
- **Method:** 3 interleaved rounds per prototype, 5 s warm-up then 30 s sampled, median across rounds;
  drawing buffer 2560×1440 in every prototype; headed browser, 1280×720 CSS px window
- **Low-tier machine:** none available (no Iris Xe or base-M1 8 GB machine), so the Low preset stays an
  open risk. TODO: add a run if the owner can borrow one.

**Chrome 154, vsync off** (uncapped, so the frame interval is real CPU+GPU throughput; use this to compare engines)

| Prototype | Frame p50 / p95 / p99 ms | FPS | CPU p50 / p95 ms | GPU p50 / p95 ms | Bundle gz KB (JS + WASM loaded) | TTFF ms | JS heap MB |
|---|---|---|---|---|---|---|---|
| Three.js + Rapier | 5.5 / **5.9** / 6.5 | 182 | 5.3 / 5.7 | 6.7 / 7.5 | 1772 | 354 | 34 |
| Babylon.js + Havok | 10.8 / **11.3** / 11.7 | 93 | 10.6 / 11.2 | 6.7 / 8.5 | 1313 | 860 | 106 |
| Babylon.js + Rapier | 10.3 / **10.9** / 11.4 | 97 | 10.2 / 10.8 | 6.6 / 8.5 | 2260 | 916 | 113 |

**Chrome 154, vsync on** (default flags; capped at the 8.33 ms refresh of the 120 Hz panel; use this for the ≤ 16.7 ms budget)

| Prototype | Frame p50 / p95 / p99 ms | FPS | CPU p50 / p95 ms | GPU p50 / p95 ms | TTFF ms | JS heap MB |
|---|---|---|---|---|---|---|
| Three.js + Rapier | 8.3 / **10.2** / 10.4 | 120 | 5.4 / 5.9 | 8.5 / 11.5 | 280 | 28 |
| Babylon.js + Havok | 11.1 / **12.1** / 12.7 | 90 | 10.9 / 11.9 | 6.6 / 8.6 | 801 | 104 |
| Babylon.js + Rapier | 10.7 / **11.7** / 12.3 | 92 | 10.6 / 11.5 | 6.6 / 8.7 | 841 | 117 |

**Brave 154 (secondary: the owner's daily browser)**

| Prototype | vsync off: frame p50 / p95 ms | vsync off: CPU p95 ms | vsync on: frame p50 / p95 ms | TTFF ms (vsync on) | JS heap MB (vsync on) |
|---|---|---|---|---|---|
| Three.js + Rapier | 5.5 / 5.9 | 5.7 | 8.3 / 9.9 | 274 | 35 |
| Babylon.js + Havok | 10.7 / 11.2 | 11.0 | 10.8 / 11.4 | 819 | 101 |
| Babylon.js + Rapier | 10.4 / 10.9 | 10.7 | 10.4 / 10.9 | 865 | 107 |

No frame in any block was longer than 25 ms, and no page logged a console error.

**Noise.** The 1-minute load average was 3.3–6 on 10 cores throughout, even with the peer agent
session idle. That is most likely the harness and the browser themselves (the headed browser, its GPU
process and the Node harness), which is why the harness flagged every block as noisy against its 3.0
threshold. Because the engines were interleaved (round 1 A B C, round 2 B C A, …), they all saw the same
background load, so the comparison between them is fair; the absolute numbers may be slightly
pessimistic. Chrome and Brave agree to within about 0.5 ms.

Reading it:

- **Every option keeps up with 60 Hz; Three.js has about twice the headroom.** With vsync off, Babylon
  is CPU-bound at about 11 ms of main-thread work per frame (CPU p95 ≈ frame p95). That leaves about 5.5 ms
  of a 60 Hz frame for game logic, AI, audio and UI. Three.js needs about 5.7 ms, leaving about 11 ms.
- **Profile of the Babylon prototype** (CDP sampling, Chrome headless): the cost is spread across
  per-mesh and per-light work each frame, led by uniform caching (`_cacheFloat4`, about 7%), world-matrix
  sync, active-mesh evaluation, material updates and light binding. No single setting fixes it. One
  setting did matter: Babylon's default of re-fitting the shadow frustum to every caster each frame cost
  about 6%, so it was turned off to match the Three prototype. Babylon has deeper CPU optimisations
  (`freezeActiveMeshes`, frozen materials, thin instances) that were **not** tried. Three.js would get
  the same instancing gains.
- **TTFF and heap:** Three.js reaches its first complete frame in about 0.3 s against about 0.8–0.9 s
  for Babylon, and uses about a third of the JS heap (28–35 MB against 100–117 MB). All are far inside
  the 10 s and 1.5 GB budgets. The first block of each browser launch pays a cold-start cost (up to
  1.9 s TTFF), which the median across rounds removes.
- **Bundle:** Three.js alone is about 160 KB gz. The Rapier `-compat` packages inline their WASM as
  base64 (1614 KB gz inside JS, against 1141 KB gz as a separate `.wasm`), so a production Three + Rapier
  build is about 1.3 MB gz, comparable to Babylon + Havok (670 KB JS + 643 KB WASM). All options are far
  below the 50 MB budget.
- **GPU time** is similar (about 6.6–6.7 ms p50) and is not the bottleneck on the M1 Pro. Three's
  `UnrealBloomPass` has a heavier tail than Babylon's pipeline bloom. With vsync on, Three's GPU p95
  (11.5 ms) is above its frame p95 (10.2 ms). That can only be a pipelining or measurement artefact, so
  treat timer-query numbers on ANGLE/Metal as indicative.

<details><summary>Superseded: smoke run before the official one</summary>

Taken on 2026-09-28 in Chrome 153.0.8010.53, headed, 1 round of 4 s while other agent sessions were
building (load average 4–5). It only showed that the harness worked. It leaned the same way as the
official run, with Babylon about 1–2 ms slower under that load.

| Prototype | Frame p50 / p95 ms (vsync on) | Frame p50 / p95 ms (vsync off) | CPU p50 / p95 ms | TTFF ms | JS heap MB |
|---|---|---|---|---|---|
| Three.js + Rapier | 8.3 / 9.3 | 6.1 / 6.7 | 5.9 / 6.5 | ~350 | ~42 |
| Babylon.js + Havok | 12.8 / 13.8 | 12.5 / 13.4 | 12.3 / 13.2 | ~870 | ~105 |
| Babylon.js + Rapier | 12.3 / 13.1 | 12.0 / 12.8 | 11.8 / 12.7 | ~900 | ~115 |

</details>

### Determinism (AC-2)

Run on 2026-09-28 on the reference MacBook Pro. Script: `spikes/determinism/input-script.json`. Raw results:
[`2026-09-28T23-48-32-determinism`](../../spikes/bench/results/2026-09-28T23-48-32-determinism.md) (`.md` + `.json`).

| Runtime | rapier-deterministic 0.21.0 | rapier-standard 0.21.0 | Havok 1.3.14 |
|---|---|---|---|
| Chrome 154.0.8037.58, run 1 | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| Chrome 154.0.8037.58, run 2 | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| Playwright WebKit 26.6 | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| Firefox 156.0 (real app, `--external Firefox`) | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| Safari 27.0 (real app, `--external Safari`) | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| Node 24.21.0 | `44c1e00d2abd4e5a` | `44c1e00d2abd4e5a` | `cdc259c1f3d6ae7e` |
| **Snapshot → restore → replay steps 300–599** | **identical** (every checkpoint) | **identical** | **differs** (no snapshot API; copying transforms and velocities into a new world does not carry Havok's internal contact/solver state) |

- **Final hashes match across all six runtimes, for all three engines** (Chrome twice, WebKit, Firefox,
  Safari, Node). This is expected: WASM float
  arithmetic is IEEE-754 and neither module imports `Math.*` from the host (checked: 0 of 29 Rapier and 0
  of 25 Havok WASM imports are math functions). Every runtime here is the same Apple-silicon CPU, though.
  The deterministic build's point is portability across CPU architectures and compilers. **Not tested:**
  x86-64 (Windows/Linux/Intel Mac). Follow-up bead `mw-548`: run
  `node spikes/determinism/src/node-run.ts` on a CI `ubuntu-latest` x86-64 runner and compare its hashes
  with the ones above. It takes a few seconds.
- **Only Rapier has real snapshot/restore.** `World.takeSnapshot()` / `World.restoreSnapshot()` continue
  bit-identically. The snapshot is 350 KB for 200 bodies, so it needs compression if it goes into saves.
- **Firefox ran as the real app.** Playwright's Firefox 155 build (`firefox-1543`) exits with "Could not
  find profile folder" on macOS 27, headless or headed. So Firefox 156.0.1 was installed and driven through
  `--external Firefox`: the harness opens the page with `open -a`, and the page posts its result back.
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

Scores are 1–5. The owner accepted the weights on 2026-09-28. The official run confirmed
the performance and bundle/TTFF/heap scores from the smoke run.

| Criterion | Weight | Three + Rapier | Babylon + Havok | Babylon + Rapier | Basis |
|---|---|---|---|---|---|
| Runtime performance (p95 frame, CPU/GPU headroom) | 25 | 5 | 3 | 3 | Official, vsync off: frame p95 5.9 vs 11.3 / 10.9 ms, CPU-bound |
| Physics determinism + `src/sim` fit | 20 | 5 | 2 | 5 | Rapier snapshot/restore identical, runs in Node, renderer-agnostic; Havok has no snapshot and is bound to Babylon's scene |
| Bundle size, TTFF, heap | 10 | 4 | 3 | 2 | Official: TTFF 0.28–0.35 vs 0.80–0.92 s; heap 28–34 vs 104–117 MB; about 1.3 MB gz production vs 1.3 / 2.3 MB |
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

**Decision: inside `src/sim`, deterministically.** Rapier's deterministic build is stepped by the sim on
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
- *As built (mw-e03.35):* the port is `src/sim/physics/port.ts` (`PhysicsPort`: static and moving
  colliders, `step(dt)`, plain-data `snapshot()`/`restore()`), implemented by `RapierPhysics` in
  `src/sim/physics/rapier.ts`. The World owns it, steps it before its systems every tick and puts its
  state (Rapier's snapshot as base64) in every `WorldSnapshot`, so the state hash covers physics. The
  sim only imports Rapier's types; `src/game/physics-loader.ts` loads the non-compat package and
  injects it, and an ESLint rule forbids value imports of `@dimforge/*` in non-test sim code. Vitest
  loads the same non-compat build through `vite-plugin-wasm` (a test-only alias points the bare
  specifier at the package's ES entry, since it has no `main`/`exports`), so no `-compat` package is
  used anywhere.
- *Replays and saves:* restoring from a Rapier snapshot continues bit-identically, so save/load and replay
  checkpoints can store physics state exactly (350 KB per 200 bodies before compression).

**The contract's "the renderer" wording stays valid.** Physics is not part of the renderer, so stories keep
saying "the renderer" for whatever `src/render` wraps. This PR updates the contract §1 rows to "Rendering
engine: Three.js (ADR-0001)" and "Physics: Rapier deterministic build, stepped inside `src/sim`
(ADR-0001)". Babylon + Havok would have broken this: its Physics V2 aggregates attach bodies to
scene-graph nodes and step inside `scene.render()`, which puts physics on the renderer's side of the
boundary.

## Performance gap and mitigations (AC-4)

**No gap.** Every option meets **p95 ≤ 16.7 ms on High** on the reference machine: vsync-on p95 is
10.2 / 12.1 / 11.7 ms in Chrome and 9.9 / 11.4 / 10.9 ms in Brave. Uncapped (vsync off), Three.js
+ Rapier's p95 is about 5.9 ms and both Babylon options are about 11 ms. No block had a frame over 25 ms.
No budget change is proposed.

**Headroom** is what matters for the choice. The benchmark scene has no AI, audio, UI, save or game
logic, and a real combat encounter will add all of them on the same main thread. On a 16.7 ms frame,
Three.js + Rapier leaves about 11 ms of main-thread time (16.7 − CPU p95 5.7), and the Babylon options
about 5.5 ms (16.7 − 11.2 / 10.8). The Low preset (Iris Xe / base-M1 class) is still untested and has
less CPU. Babylon's margin is the one that would run out first there.

Mitigations the renderer bootstrap and E32 should plan for as content grows, cheapest first:

1. Instancing for repeated props (boxes and barrels as one `InstancedMesh` each: about 200 fewer draw
   calls in each of the main and shadow passes).
2. Animation LOD: update distant NPC mixers at 30 or 15 Hz, and stop off-screen ones.
3. Fewer shadow casters: small props and distant NPCs do not cast. Use a 1024² shadow map on Low, and
   cascades only if a level needs them.
4. Bloom at half resolution; the particle budget from `mw-e29.1`.
5. Dynamic resolution scale on Low (render below 1080p, upscale), keeping the UI at native resolution.
6. Physics budget: cap awake bodies (`mw-e03.10` max-body budget) and rely on sleeping.

Budget discussion for `e32-perf-budgets` (not changes to the contract): add a per-subsystem CPU budget
so the headroom above stays visible, e.g. render submission ≤ 7 ms and sim ≤ 4 ms per 60 Hz frame on
High; define "1440p-equivalent" as a render scale rather than a fixed buffer, so dynamic resolution
counts; and consider giving High the Low preset's "30 fps floor in worst-case combat" as well. Revisit
with a Low-tier measurement before any of these goes into the contract.

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

- A later perf-budget suite (`e32-perf-budgets`) or a Low-tier measurement shows Three.js + Rapier missing
  p95 ≤ 16.7 ms on High after the mitigations above, while another option meets it.
- Rapier deterministic hashes differ across the browsers or CPU architectures we support (x86-64 CI run,
  Firefox, Edge), or a Rapier release breaks snapshot compatibility.
- Physics step cost for a real level's awake bodies exceeds its share of the sim budget.
- Three.js drops WebGL2 support before `WebGPURenderer` covers our pipeline, or its release cadence
  causes more breaking changes than one upgrade bead per quarter can absorb.
- The owner starts regular hands-on scene debugging and the missing inspector costs more than building E33
  tools.
- Any platform trigger in [Platform: browser vs native engine](#platform-browser-vs-native-engine).
