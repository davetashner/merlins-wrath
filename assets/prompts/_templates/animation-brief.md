# Template: Animation brief (motion brief per clip)

> **How to use:** copy to `assets/prompts/anim/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. One brief per clip id (a tight clip family — e.g. a 3-hit chain — may share one file if every
> clip id is listed in §1 and has its own row in §4 and §5).
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude** — sources a CC0 library clip, or generates via the
> image-to-3D provider's rig/animation API (Meshy or Tripo auto-rig + auto-animate, per
> `e37-3d-pipeline-decision`), then retargets with `e37-animation-pipeline`. **The owner only approves.**
>
> Names, lore and behaviour must match `docs/narrative/story-bible.md` (§5 cast, §8 creature roster) and the
> creature/NPC silhouette and disposition rules in `docs/art/style-bible.md` §5. There is no image prompt and
> no preamble in this template: the "prompt" is the motion spec below (plus the provider text prompt if the
> clip is API-generated). Never paste Mixamo or other non-CC0 raw files into the repo.

## 1. Asset

| Field | Value |
|---|---|
| Clip id | `anim-<rig-or-creature>-<action>-<nn>` (kebab-case; equals the final clip name in the manifest), e.g. `anim-humanoid-sleepwalk-01`, `anim-horn-axe-sweep-01` |
| Category | anim |
| Target model(s) | `model-<…>` — the approved model(s) this clip is authored for / retargeted to |
| Rig | `<canonical humanoid (e37-animation-pipeline) | creature rig id from the model's turntable approval>` + bone count (≤ 65 standard, ≤ 80 hero, style bible §13.2) |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) whose state machine plays this clip |
| Prompt (brief) bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead | `mw-<…>` — `needs-human` owner gate "animation", see §7 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/animation-brief.md` v1 |

## 2. Brief

<What the body does and what the player must read from it: intent, disposition (style bible §5.2 "disposition
readability"), the story beat or habit it expresses. One sentence on what makes it memorable — e.g. "Horn
kneels slowly, axe laid flat, head bowed: he yields, he is not beaten.">

## 3. Source

| Field | Value |
|---|---|
| Source | `<CC0 library | Meshy auto-anim | Tripo auto-anim | hand-keyed by script (procedural)>` |
| Library + clip reference | `<library name, clip name, URL>` — CC0 only; record licence file path under `assets/kits/<kit>/` |
| Provider text prompt (API only) | `<short motion prompt sent to the provider; no artist/studio/game names>` |
| Retarget | `<source skeleton> → <target rig>`; bone map file `<path>` |

## 4. Motion spec

| Property | Value |
|---|---|
| Loop / one-shot | `<loop | one-shot | one-shot → hold last frame>` |
| Duration | `<frames>` @ 30 fps (`<seconds>` s); loops: first and last pose identical (validator checks pose delta) |
| Root motion policy | `<in-place + root velocity curve (default) | baked root motion extracted to curve | none (stationary)>` — the sim owns position; clips never move the capsule on their own |
| Blend in / out | `<ms>` / `<ms>` |
| Speed range | `<e.g. 0.8–1.2× for locomotion; fixed for attacks>` |
| Sim timing | Telegraph `<ms>` → active `<ms>` → recovery `<ms>` (must match the attack/interaction data in the consuming bead; attacks follow `e04-damage-model` windows) |
| Additive / layered | `<full-body | upper-body layer | additive breathing>` |

### Sim marker events

Markers are named events at a frame; the sim/animation bridge (`e02-animation-hooks` / `e02-animation-system`)
listens for them. Every clip that makes noise or contact **must** have markers (validator fails otherwise).

| Frame | Marker | Payload / notes |
|---|---|---|
| `<n>` | `footstep` | `<foot: l|r>`, surface from sim (drives `e02-footstep-events` / noise) |
| `<n>` | `hit-open` / `hit-close` | hitbox window id `<…>` |
| `<n>` | `grab` / `release` | attach point `<bone>` |
| `<n>` | `sfx` | sound id `<sfx-…>` (the sound itself is not baked into the clip) |
| `<n>` | `vfx` | effect id `<vfx-…>` |
| `<n>` | `interrupt-ok` | earliest frame the state machine may cancel |

## 5. Consistency checklist

- [ ] Clip id follows `anim-<rig-or-creature>-<action>-<nn>` and equals the manifest name
- [ ] Source licence is CC0 or provider output on a tier that permits free public distribution (recorded in §8)
- [ ] Reads clearly from the default third-person camera distance (style bible §10); silhouette of the key pose readable at 64 px
- [ ] Disposition cues match style bible §5.2 (head/ears/weapon up = hostile, lowered = calm/approachable)
- [ ] Weight matches the creature's scale (Horn ≈ 2.75 m is slow and heavy; goblins quick; Hushlings drift with no footfalls)
- [ ] No foot sliding (foot-lock check), no limb interpenetration, no pops at loop seam or blend
- [ ] Root motion policy honoured (in-place unless stated); duration within ±1 frame of the spec
- [ ] Marker list complete: every contact/noise frame has a marker; timings match sim data
- [ ] Nothing on the "we never do" list (style bible §11): no gore, no cruelty for its own sake; Horn stops, never kills
- [ ] Bone count within budget; no scale keys unless the rig requires them

## 6. Output spec

| Property | Value |
|---|---|
| Format | glTF 2.0 animation clip on the target rig (`.glb`), 30 fps, keyframe-reduced by the pipeline |
| Manifest | entry in the per-character clip manifest: id, loop flag, duration, root policy, markers, blend times |
| Preview | GIF + PNG contact strip rendered on the target model by `e37-turntable-preview` |

## 7. Approval gate

> Recorded in `assets/approvals.json` via `e37-asset-approval-log` (asset id, gate "animation", version,
> file SHA-256, approver, date, notes). CI refuses clips without a matching record.

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| animation (preview GIF) | v<N> | <approved / rejected> | <owner> | <yyyy-mm-dd> | <…> |

## 8. Iteration log

| # | Date | Source / provider / tier | Change | Result (`assets/_incoming/<asset-id>/vN.glb`) | Keep? |
|---|---|---|---|---|---|
| 1 | <yyyy-mm-dd> | <…> | initial | `assets/_incoming/<asset-id>/v1.glb` | <yes/no + why> |

## 9. Provenance (copy into `assets/CREDITS.md` in the same commit)

| Asset id | Source file | Library / provider | Tier | Date | Licence / terms | Brief file |
|---|---|---|---|---|---|---|
| <asset-id> | `assets/source/anim/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <CC0 licence path or terms URL> | this file |
