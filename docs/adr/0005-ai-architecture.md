# ADR-0005: AI decision architecture — HFSM alert states with utility inside

- **Status:** Accepted (owner, 2026-10-02)
- **Date:** 2026-10-02
- **Decider:** Owner
- **Bead:** `mw-e11.1`

## Decision

Creature AI uses a **two-layer hybrid**. The top layer is a **hierarchical state machine (HFSM)** over the
six alert states of the constitution (Unaware → Suspicious → Investigating → Searching → Alerted →
Combat). Its transitions, timeouts and fallbacks are data, and it can take only the transitions the table
lists. Inside each state, **utility scoring** picks one **activity** from that state's list. An activity's
score is `weight × Π curve(input)` over its considerations, and its inputs include personality traits,
needs, awareness, timers and distances. An activity is a short, ordered list of action primitives
(`move-to`, `look-around`, `rest`, `attack`…). The runtime (`mw-e11.2`, `src/sim/ai/`) thinks at a
per-agent rate (default 10 Hz, staggered by entity id), runs the current primitive every tick, and keeps
all brain state as plain data in a component. That way snapshots, saves, replays and state hashes carry it.

Behaviour trees and flat utility AI were both prototyped and are rejected (see
[Options](#options-considered)). A pure HFSM and GOAP were rejected without a prototype.

## Context

Every enemy behaviour in E11 sits on this choice, and `mw-e11.2` (the runtime) is blocked on it. The
forces:

- **Constitution §5 (thief) and §7 (creatures):** guards must move visibly through *Unaware → Suspicious →
  Investigating → Searching → Alerted → Combat*. They must not know the player's position after losing
  sight. Creatures have "behaviors, relationships, weaknesses, fears and personalities", so a lazy guard
  and a curious goblin should behave differently without separate scripts.
- **Contract §2 and §3:** rules live in `src/sim`. They are deterministic (no wall clock, no `Math.random`),
  fixed-step and 100 % covered, and replays must reproduce identical state hashes. Content is
  schema-validated JSON (contract §1).
- **E11 beads that consume the decision:** `mw-e11.7` needs a transition table that a fuzz test can check
  ("no transition absent from the table", AC-6). `mw-e11.2` needs introspection that returns "the active
  node path (or top-3 utility scores)", a think rate of 10 Hz, and an AI think p95 ≤ 1.0 ms per tick for 50
  agents. `mw-e11.17` draws state, time in state and scores, and `mw-e11.18` sets a 3 ms budget for
  AI + perception + sound with 24 agents. `mw-e12.11` (personality traits) and `mw-e12.12` (needs) feed
  decisions as inputs.
- **What exists:** `src/sim/creatures` (`mw-e12.4`) spawns creatures with a `creature.creature` component.
  That component carries a behaviour profile id, numeric `tuning` overrides, need levels and a patrol
  route, and its comment already says "AI (e11) decides what it does". Creature definitions carry the six
  personality traits (`src/content/types/creature.ts`) and resolved sense profiles. The `humanoid` profile
  hears at a 30 dB threshold within 25 m. `src/sim/rng.ts` provides named seeded streams,
  `src/sim/math.ts` deterministic transcendental functions, and `src/sim/snapshot.ts` canonical hashing.

## Options considered

| Option | Summary | Result |
|---|---|---|
| **HFSM alert states + utility inside states** | Six alert states as a data transition table; each state scores its own activities from traits, needs and stimuli; activities are short primitive lists | **Chosen** |
| Behaviour tree | Selector/sequence/condition/action tree, reactive selectors, memory sequences; alert state written to the blackboard by actions | **Rejected**: the alert machine becomes implicit (state writes are scattered across branches, so the transition table cannot be checked); personality and needs become thresholds (step functions); the tree is ~1.8× the JSON of the chosen format. It was the fastest, but every candidate is far inside budget |
| Flat utility AI | One pool of activities competing every think; the alert label is set by the winning activity | **Rejected**: nothing enforces the alert ladder. In the benchmark crowd, 133 of 272 escalations jumped from Unaware straight to Investigating, skipping Suspicious. Every activity has to repeat the awareness gates, and investigating had to be made non-interruptible to stop it dithering. It was also the slowest |
| Pure hierarchical FSM | Every activity a state, with hand-written transitions guarded by traits and needs | **Rejected (not prototyped)**: the chosen design keeps this as its top layer. Pushing activities down into states turns every trait or need preference into a transition guard, which grows combinatorially and gives thresholds instead of graded preferences (the BT's problem) |
| GOAP / HTN planning | Planner searches action sequences toward goals | **Rejected (not prototyped)**: planning cost and plan-debugging are out of proportion for patrol/investigate/search/fight. Nothing in E11 needs multi-step plans that a step list cannot express. Revisit if creatures get open-ended goals (see triggers) |

## Evidence

### What was built

[`spikes/ai-architecture/`](../../spikes/ai-architecture/README.md) builds the same scenario three ways:
a guard (the `fixture-guard` creature: humanoid hearing, traits 0.5, sleep need 1/min) walks a square
loop with 2 s dwells, hears a noise, becomes Suspicious, investigates the spot and walks back to the
nearest waypoint to resume patrolling. Everything except the decision layer is shared byte for byte.
That covers the world, the noise schedule, hearing → awareness (a stand-in for `mw-e11.5`/`mw-e11.6`), the
primitives, think scheduling (10 Hz staggered by id, act every tick) and state hashing. The spike imports
the real sim `Rng`, `math.log`/`sin`/`cos` and `encodeCanonical` + `xxHash32`, so its determinism is the
sim's determinism.

| Candidate | Runtime | `fixture-guard` definition |
|---|---|---|
| A. Behaviour tree | [`bt/runtime.ts`](../../spikes/ai-architecture/bt/runtime.ts) (187 lines) | [`bt/fixture-guard.bt.json`](../../spikes/ai-architecture/bt/fixture-guard.bt.json) |
| B. HFSM + utility | [`hybrid/runtime.ts`](../../spikes/ai-architecture/hybrid/runtime.ts) (292 lines) | [`hybrid/fixture-guard.json`](../../spikes/ai-architecture/hybrid/fixture-guard.json) |
| C. Flat utility | same runtime as B, one state | [`hybrid/flat-utility.json`](../../spikes/ai-architecture/hybrid/flat-utility.json) |

### Tick cost (AC-2)

50 agents in the benchmark crowd (a 10×5 grid of patrol loops, a seeded random noise every 4–10 s at
45–75 dB) run **60 s of sim time (3,600 ticks) headless** after a 10 s warm-up. The harness times each
`step()` with `performance.now()`; the sim never reads it. There are 7 rounds per candidate, interleaved
with the order rotated each round and a different seed per round. Each figure is the median over rounds
of that round's statistic. Decision = think (at the think rate) + act for all 50 agents; perception is the
shared hearing pass and the same for every candidate (≈ 0.33 µs).

Command: `AI_SPIKE_BENCH=1 pnpm exec vitest run --config spikes/ai-architecture/vitest.config.ts` →
[`results/tick-cost.json`](../../spikes/ai-architecture/results/tick-cost.json). Machine: the contract
reference machine, MacBook Pro M1 Pro, 16 GB, macOS 27.0.1, on AC power; Node 24.21.0, Vitest 5.0.2.

**Decision cost per tick, 50 agents, µs**

| Candidate | Think rate | Mean | p50 | **p95** | p99 | Max |
|---|---|---|---|---|---|---|
| Behaviour tree | 10 Hz | **3.2** | 3.0 | **3.5** | 6.1 | 195 |
| **HFSM + utility** | 10 Hz | **4.3** | 4.0 | **4.7** | 6.9 | 221 |
| Flat utility | 10 Hz | **5.1** | 4.8 | **6.2** | 8.5 | 182 |
| Behaviour tree | 60 Hz (every tick) | 13.1 | 12.8 | 14.6 | 16.3 | 218 |
| HFSM + utility | 60 Hz | 19.3 | 18.6 | 20.2 | 24.3 | 202 |
| Flat utility | 60 Hz | 24.2 | 24.3 | 25.9 | 29.1 | 220 |

Total tick (decision + perception) at 10 Hz, mean / p95: behaviour tree 3.5 / 3.9 µs, **HFSM + utility
4.6 / 5.0 µs**, flat utility 5.4 / 6.8 µs.

- **Noise.** The machine was shared with other agent sessions (1-minute load average 3–19 across runs).
  Three runs gave HFSM + utility a 10 Hz mean of 4.3–5.6 µs, behaviour tree 3.2–3.3 µs and flat utility
  5.1–7.1 µs. The ranking never changed. The ~200 µs maxima are GC/JIT pauses that hit every candidate.
- **Against the budgets.** The chosen design's p95 of ~5 µs for 50 agents is **~200× inside** `mw-e11.2`
  AC-5 (1.0 ms) and a negligible share of `mw-e11.18`'s 3 ms. Thinking every tick would still cost only
  ~20 µs. The decision layer is not where the AI budget will go. Navmesh queries, line-of-sight and sound
  propagation (not in this spike) will dominate, and the think rate is the lever for those.
- **Why the hybrid costs more than the BT.** It scores every activity of the current state on each think,
  while the tree stops at the first branch that succeeds. Memoising inputs per think, which `offRoute` is
  read twice for today, is a cheap production fix. It is not worth it at these numbers.

### Determinism (AC-3)

[`scenario.test.ts`](../../spikes/ai-architecture/scenario.test.ts) runs, for every candidate:

- `AC-3`: 50 agents for 60 s, twice with seed 7, hashing all agent and brain state every tick (3,600
  hashes). The sequences are identical. Seed 8 diverges, so the test is not vacuous.
- A save after 20 s, JSON round-tripped and loaded into a fresh world, then 20 s more: the hash equals an
  uninterrupted 40 s run. Brain memory is plain data in every candidate.

All 24 tests pass (`pnpm exec vitest run --config spikes/ai-architecture/vitest.config.ts`). No
candidate needed wall-clock time or `Math.random`. Randomness (look-around directions, the noise
schedule) comes from seeded streams, and ties in utility scoring go to the earlier-listed activity. On
determinism the candidates are equal.

### Behaviour and the alert ladder

Measured on the single-guard scenario (noise 75 dB, ~18 m away, at t = 10 s) and the benchmark crowd
(7 rounds × 60 s × 50 agents):

| | Behaviour tree | HFSM + utility | Flat utility |
|---|---|---|---|
| Ladder taken in the scenario | Unaware → Suspicious → Investigating → Unaware | same | **Unaware → Investigating** → Unaware |
| Crowd escalations skipping Suspicious | 0 of 282 | 0 of 285 | **133 of 272** |
| Only table transitions taken (checked against the definition) | not checkable: no table | ✓ (test) | n/a: one state |
| Curiosity 0.1 vs 0.5 | gives up at 8 s (threshold `curiosity < 0.3`) | `call-it-off` outscores `investigate` after 7.3 s, graded by curiosity | never investigates; stares for 17 s |
| Sleepy (95) lax guard naps, diligent one patrols | ✓ (threshold `diligence < 0.7`) | ✓ (graded: `sleep² × (1.2 − diligence)`) | ✓ |

### Authoring effort (JSON, prettier-formatted)

| | Behaviour tree | HFSM + utility | Flat utility |
|---|---|---|---|
| Lines / minified bytes | 158 / 2,271 | **88 / 2,013** | 73 / 1,956 |
| Structure | 28 nodes, 6 conditions | 3 states, 7 activities, 9 considerations | 1 state, 5 activities, 14 considerations |
| Alert state writes / reads in content | 4 / 3, spread over branches | **0 / 0** (the machine owns it) | 5 / 0 |
| Adding Searching/Alerted/Combat | new top-level branches, each re-encoding entry/exit writes and timers by hand | new state entries + their activities | every activity gains more awareness gates |

### Evaluation against the bead's criteria

| Criterion | Behaviour tree | **HFSM + utility** | Flat utility |
|---|---|---|---|
| Determinism (no hidden time/random) | ✓ | ✓ | ✓ |
| Data-authorability (JSON) | ✓, but long; the alert machine is implicit | ✓, shortest for the full ladder; transitions are a table | ✓, but gates are duplicated per activity |
| Debuggability | active path `root › investigate › check-spot › go-to-noise` | state, time in state, activity, step, top-3 scores (with considerations in production) | top-3 scores only; why a state was skipped is not visible |
| Perf (50 agents, p95) | 3.5 µs | 4.7 µs | 6.2 µs |
| Testability at 100 % | ✓, but many composite × memory × pre-emption paths | ✓: three small pure pieces (transition table, curves/scoring, step runner), each unit-testable; the table is fuzzable (`mw-e11.7` AC-6) | ✓, but behaviour is emergent from tuning, so tests pin numbers rather than structure |
| Traits and needs as inputs | thresholds only | graded inputs to response curves | graded |

The spike did **not** test navmesh paths, line of sight, multiple stimuli per agent, group behaviour, the
Searching/Alerted/Combat states, or browser (V8 in Chrome) timings. Node uses the same V8, and the
decision layer is pure arithmetic. It also did not test a visual editor.

## Data format sketch (AC-4)

A behaviour definition is a content file, `src/content/data/behaviour/<id>.json`, schema-validated with
zod. The creature's `behaviour.profile` names it. Numbers can come from the AI tuning profile (`mw-e11.16`)
as `{ "tuning": "<key>" }`, so tuning can change without touching structure. The creature's
`behaviour.tuning` overrides those keys. This is the `fixture-guard` sketch for all six states; the
spike's runnable subset is [`hybrid/fixture-guard.json`](../../spikes/ai-architecture/hybrid/fixture-guard.json).

```json
{
  "$schema": "../behaviour.schema.json",
  "id": "fixture-guard",
  "tuning": "guard-default",
  "thinkHz": 10,
  "inertia": 0.1,
  "initial": "unaware",
  "states": {
    "unaware": {
      "transitions": [
        { "to": "suspicious", "when": { "input": "awareness", "gte": { "tuning": "suspiciousAt" } } },
        { "to": "alerted", "when": { "event": "damaged-by-unseen" } },
        { "to": "alerted", "when": { "event": "ally-alarm" } }
      ],
      "activities": ["patrol", "return-to-route", "nap"]
    },
    "suspicious": {
      "timeoutS": { "tuning": "suspiciousTimeoutS" },
      "onTimeout": "unaware",
      "transitions": [
        { "to": "investigating", "when": { "input": "awareness", "gte": { "tuning": "investigateAt" } } },
        { "to": "combat", "when": { "input": "targetVisible", "gte": 1 } },
        { "to": "unaware", "when": { "done": "shrug-off" } }
      ],
      "activities": ["look-toward-stimulus", "shrug-off"]
    },
    "investigating": {
      "timeoutS": { "tuning": "investigatingTimeoutS" },
      "onTimeout": "unaware",
      "transitions": [
        { "to": "combat", "when": { "input": "targetVisible", "gte": 1 } },
        { "to": "unaware", "when": { "done": "investigate" } },
        { "to": "searching", "when": { "failed": "investigate" } },
        { "to": "unaware", "when": { "done": "call-it-off" } }
      ],
      "activities": ["investigate", "call-it-off"]
    },
    "searching": {
      "timeoutS": { "tuning": "searchingTimeoutS" },
      "onTimeout": "unaware",
      "postAlert": true,
      "transitions": [{ "to": "combat", "when": { "input": "targetVisible", "gte": 1 } }],
      "activities": ["search-lkp", "check-hiding-spot", "call-for-help"]
    },
    "alerted": {
      "timeoutS": { "tuning": "alertedTimeoutS" },
      "onTimeout": "searching",
      "transitions": [{ "to": "combat", "when": { "input": "targetVisible", "gte": 1 } }],
      "activities": ["raise-alarm", "hunt", "guard-post"]
    },
    "combat": {
      "transitions": [
        { "to": "searching", "when": { "input": "targetLostS", "gte": { "tuning": "combatLostS" } } }
      ],
      "activities": ["engage", "flee", "call-for-help"]
    }
  },
  "activities": {
    "patrol": {
      "considerations": [
        { "input": "offRoute", "curve": { "kind": "step", "at": 1.5, "below": 1, "above": 0 } },
        { "input": "trait.diligence", "curve": { "kind": "linear", "slope": 0.5, "intercept": 0.5 } }
      ],
      "steps": [{ "do": "follow-route" }]
    },
    "return-to-route": {
      "considerations": [
        { "input": "offRoute", "curve": { "kind": "step", "at": 1.5, "below": 0, "above": 1 } }
      ],
      "steps": [{ "do": "move-to", "target": "nearest-waypoint" }]
    },
    "nap": {
      "weight": 1.5,
      "considerations": [
        { "input": "need.sleep", "curve": { "kind": "power", "exponent": 2 } },
        { "input": "trait.diligence", "curve": { "kind": "linear", "slope": -1, "intercept": 1.2 } }
      ],
      "steps": [{ "do": "move-to", "target": "rest-spot" }, { "do": "rest", "seconds": 8 }]
    },
    "look-toward-stimulus": {
      "considerations": [],
      "steps": [{ "do": "look-at", "target": "stimulus", "seconds": 1 }]
    },
    "shrug-off": {
      "weight": 2,
      "considerations": [
        { "input": "timeInState", "curve": { "kind": "step", "at": 6, "below": 0, "above": 1 } }
      ],
      "steps": [{ "do": "play-cue", "cue": "guard-shrug" }, { "do": "forget-stimulus" }]
    },
    "investigate": {
      "considerations": [
        { "input": "trait.curiosity", "curve": { "kind": "linear", "slope": 0.5, "intercept": 0.5 } }
      ],
      "steps": [
        { "do": "move-to", "target": "stimulus" },
        { "do": "look-around", "seconds": 3 },
        { "do": "forget-stimulus" }
      ]
    },
    "call-it-off": {
      "considerations": [
        { "input": "trait.curiosity", "curve": { "kind": "linear", "slope": -1, "intercept": 1 } },
        { "input": "timeInState", "curve": { "kind": "linear", "slope": 0.1, "intercept": 0 } }
      ],
      "steps": [{ "do": "forget-stimulus" }]
    },
    "engage": {
      "interruptible": false,
      "considerations": [
        { "input": "trait.bravery", "curve": { "kind": "linear", "slope": 0.6, "intercept": 0.4 } },
        { "input": "healthFraction", "curve": { "kind": "linear", "slope": 1, "intercept": 0.2 } }
      ],
      "steps": [{ "do": "move-to", "target": "target", "within": 1.6 }, { "do": "attack", "attack": "fixture-guard-strike" }]
    }
  }
}
```

The other activities (`search-lkp`, `flee`…) follow the same shape. Their primitives belong to the beads
that own them (`mw-e11.11`, `mw-e11.13`, `mw-e11.14`).

## Consequences

**Runtime semantics `mw-e11.2` implements (fixed by this ADR):**

1. **Think and act.** An agent thinks at `thinkHz` (default 10), on ticks where `(tick + entity) mod
   (60 / thinkHz) = 0`. It acts every tick. Agents are processed in ascending entity id.
2. **The machine moves first.** On each think, the current state's timeout is checked first, then its
   transitions in listed order. The machine takes at most one transition per think, and only to states
   that the table lists. External events (`damaged-by-unseen`, `ally-alarm`) are queued on the brain and
   read by `{ "event": … }` conditions. Every transition emits `AlertStateChanged{from, to, cause}`
   (`mw-e11.7`).
3. **Utility picks within the state.** Each listed activity is scored as `weight × Π curve(input)`, with
   curves clamped to 0–1. The running activity gets `+inertia`. The highest score wins, ties go to the
   earlier-listed activity, and a score of 0 is never chosen. `interruptible: false` holds an activity until
   it ends or the state changes. Any random choice (for example, weighted pick among near-equal scores)
   draws from the world's `ai` RNG stream in think order.
4. **Steps run in order.** A step returns running, success or failure. When the last step succeeds, the
   activity is `done`. When a step fails, the activity is `failed`, and either a `{ "failed": … }`
   transition or the next-best activity (the failed one is excluded for `retryAfterS`, default 2 s) is the
   fallback (`mw-e11.2` AC-3). A state change halts the running primitive.
5. **Inputs are named, typed accessors resolved at load:** `awareness`, `trait.*` (`mw-e12.11`), `need.*`
   (`mw-e12.12`), `timeInState`, `offRoute`, `targetVisible`, `targetLostS`, `healthFraction`, and so on.
   An unknown input, primitive, state or activity fails loading with the behaviour id and the name
   (`mw-e11.2` AC-2).
6. **Brain state is a component** (`ai.brain`: state, entered tick, activity index, step, pending events,
   last top-3 scores) of plain numbers and strings, so it is in every snapshot, save, replay and hash.
7. **Introspection** returns `{ state, timeInState, activity, step, scores: top-3 [{ activity, score,
   considerations: [{ input, value, curve }] }] }` for `mw-e11.17`. It is built only when asked
   (`mw-e11.17` AC-5).

**Other consequences:**

- **Easier.** `mw-e11.7` owns the transition table and can fuzz it, since the six states are the
  machine's states and not a convention. Personality (`mw-e12.11`) and needs (`mw-e12.12`) plug in as
  inputs without new structure. Designers tune curves and weights, and the debug overlay shows why one
  activity beat another.
- **Harder.** Utility behaviour depends on tuning: two activities with close scores can trade places when a
  number changes. Mitigations are inertia, `interruptible`, the pinned-default tests of `mw-e11.16`, and
  scenario tests (`mw-e11.3`) that assert behaviour over time rather than scores.
- **Costs we accept.** The hybrid is ~1.3–1.7× the behaviour tree's think cost (still ~5 µs p95 for 50
  agents). Long ordered scripts (a boss's multi-phase routine) are flattened into step lists or split into
  activities. If those get long, revisit (see triggers).
- **Contract.** §1 gains an "Enemy AI" row pointing here. `mw-e11.2`'s description already allows either
  path; its ACs (Running/Success/Failure, top-3 scores) match these semantics unchanged.
- **The spike.** `spikes/ai-architecture/` stays outside every root gate (its README explains how). It is
  deleted once `mw-e11.2` has its own tests for the same scenario (`mw-e00.30`).
- **Follow-up beads.** `mw-e11.19` (behaviour-definition lint: unreachable states, dead activities, states
  without an exit) and `mw-e00.30` (archive finished spikes).

## Revisit triggers

- Any creature needs an authored ordered routine of more than ~8 steps with branches inside it (bosses,
  set-piece NPCs). Then consider a behaviour-tree *activity* type inside a state, not a rewrite.
- `mw-e11.18`'s stress scene shows the decision layer (not perception or nav) above 0.5 ms p95 for 24
  agents on the reference machine.
- Scenario tests (`mw-e11.3`) show utility oscillation: an agent switching activity more than twice per
  second for more than 2 s in a stable situation, which inertia and `interruptible` cannot fix.
- A design needs creatures to pursue open-ended goals that a step list cannot express (crafting, trading
  chains). Then evaluate GOAP/HTN for that creature family only.
