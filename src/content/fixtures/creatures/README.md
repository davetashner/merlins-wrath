# Creature test fixtures (frozen)

Three deliberately boring grey-box creatures for AI and stealth rule tests (mw-e12.3). They are **not
bestiary content**: tuning the real bestiary (E13) never changes them, so rule tests that use them stay
stable.

| Id                 | Archetype | What tests rely on                                                                                                                                  |
| ------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture-guard`    | humanoid  | `humanoid` senses (sight-dominant, needs light) and locomotion; tags `patrols` and `communicates`; sleeps; one melee attack `fixture-guard-strike`. |
| `fixture-hound`    | beast     | `beast` senses (hearing and smell dominant, follows scent trails); fast (9 m/s run); cannot climb, open doors or swim; sleeps.                     |
| `fixture-sentinel` | undead    | `undead` senses (dark vision 1.0, 3 m `life-sense` through walls); tag `never-sleeps` and no needs; slow, never jumps, opens doors (a Hollow Sentinel stand-in). |

## Rules

- **Frozen.** Changing any value here means updating every scenario test that depends on it (AI, stealth,
  perception, navigation). Every optional section is written out in full so a schema default changing
  cannot silently change a fixture either.
- **Senses** use the baseline `sense` profiles by id; a baseline profile is a tuning band, not a
  bestiary creature, and its notes name these fixtures. **Locomotion** is inline except the guard's,
  which uses the `humanoid` baseline; the hound and sentinel do not borrow the Briar Wolf or any other
  bestiary profile.
- **Capsules only**: `placeholder-capsule` mesh, `placeholder` SFX.
- **Attacks** (mw-e12.5): only `fixture-guard` attacks, with `fixture-guard-strike` (`attack/`, its
  `move/` and its `socket-track/` here, a single identity key): melee, 18/4/14 ticks, telegraph `fixture-guard-strike-windup`, range 0–1.8 m, 2 s
  cooldown, and two packets per hit (18 slash + 15 poise from the move, then 4 blunt). The hound and
  sentinel have none.
- **Behaviour** (mw-e11.2): only `fixture-guard` has a behaviour file (`behaviour/fixture-guard.json`), the
  ADR-0005 guard reduced to what the AI runtime's tests need: patrol (or nap when sleepy and lax), look
  toward a stimulus when Suspicious, walk to it and look around when Investigating, fight a visible target
  in Combat. The hound's and sentinel's profiles have no behaviour yet, so they spawn without a brain.
- **Never shipped in a release build.** Files live under `src/content/fixtures/creatures/<type>/`,
  outside the game's content root (`src/content/data`), so the game's own content never includes
  them. Tests load them with `loadFixtureContent()` from `src/content/test-fixtures.ts` (game content
  plus these fixtures). Debug builds (the debug console built in) also load them, with the dev-only
  scenes in `src/content/fixtures/dev/`, through `loadDevContent()` in `src/content/dev-content.ts`
  (mw-e12.4), so designers can spawn them in the grey-box testbed; a release build
  (`VESPER_DEBUG_CONSOLE=off`) never downloads them.
