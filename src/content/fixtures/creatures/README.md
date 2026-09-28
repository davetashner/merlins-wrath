# Creature test fixtures (frozen)

Three deliberately boring grey-box creatures for AI and stealth rule tests (mw-e12.3). They are **not
bestiary content**: tuning the real bestiary (E13) never changes them, so rule tests that use them stay
stable.

| Id                 | Archetype | What tests rely on                                                                                                                                  |
| ------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture-guard`    | humanoid  | `humanoid` senses (sight-dominant, needs light) and locomotion; tags `patrols` and `communicates`; sleeps.                                          |
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
- **Capsules only**: `placeholder-capsule` mesh, `placeholder` SFX. No attacks until the `attack`
  type exists (mw-e12.5).
- **Never shipped.** Files live under `src/content/fixtures/creatures/<type>/`, outside the game's
  content root (`src/content/data`), so the game bundle never includes them. Tests load them with
  `loadFixtureContent()` from `src/content/test-fixtures.ts` (game content plus these fixtures).
