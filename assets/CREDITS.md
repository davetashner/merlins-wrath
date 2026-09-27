# Asset Credits & Provenance

Every asset committed to this repository — generated, downloaded, or made by hand — has a row here,
**added in the same commit as the asset**. The asset validator (`e37-asset-validator`) fails CI when a runtime
asset has no matching row, or a row uses a licence that isn't allowed.

Rules: `docs/art/style-bible.md` §16–17 and `docs/audio/audio-bible.md` §9. Every **final** (non-placeholder)
asset must also have an owner approval record in `assets/approvals.json` matching its file hash
(`e37-asset-approval-log`).

Typical sources: `generated:codex-gpt-image/<model>` (ChatGPT subscription via Codex CLI),
`generated:openai-images-api/<model>`, `generated:meshy-api/<model>` or `generated:tripo-api/<model>`,
`generated:suno/<model>` (owner-generated, paid tier), `generated:elevenlabs-sfx/<model>`, `kit:<name>`,
`library:<url>` (CC0). Never record API keys or account emails here.

## Allowed licences

| Licence id | Meaning | In-game credit required |
|---|---|---|
| `CC0-1.0` | Public domain dedication | No (credited anyway as courtesy) |
| `CC-BY-4.0` | Attribution | **Yes** — listed on the in-game credits screen |
| `OFL-1.1` | SIL Open Font License (fonts only) | Licence text shipped alongside font |
| `MIT` / `Apache-2.0` | Permissive | Licence text retained |
| `GEN-OWNED` | Generated with an AI tool whose terms, **at the recorded tier and date**, grant us rights to distribute the output freely (e.g. paid-tier ownership) | Per tool terms |
| `ORIGINAL` | Made by the project | No |

**Not allowed:** CC-BY-NC, CC-BY-ND, CC-BY-SA, "editorial use", "royalty-free — no redistribution" (the repo is
public), unknown/unrecorded provenance. Free-tier AI outputs whose terms restrict ownership or require
non-commercial use are **placeholders only** and must be flagged `placeholder: yes`.

## Column reference

- **Asset id** — exact asset id (= filename stem), or a glob for a set/kit (`kit-kaykit-dungeon/*`).
- **Type** — concept | texture | model | anim | ui | icon | portrait | book | vfx | sky | keyart | music | sfx | amb | font | kit.
- **Source** — `generated:<tool>/<model-version>` | `library:<url>` | `kit:<name>@<version>` | `original`.
- **Tier** — account tier at generation (e.g. `ChatGPT Plus`, `Suno Pro`, `Meshy Free`) or `n/a`.
- **Date** — generation/download date (YYYY-MM-DD).
- **Licence** — licence id from the table above.
- **Terms / URL** — link to the licence or tool terms page as read on that date.
- **Author / attribution** — required text for CC-BY; author name for kits.
- **Prompt file** — `assets/prompts/<category>/<asset-id>.md` for generated assets.
- **Placeholder** — `yes` if it must be replaced before m3.

---

## Art

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | | | | |

## 3D models & animation

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | | | | |

## Music

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| music-title-main-theme | music | generated:suno/(model not recorded) | Suno Pro (annual) | 2026-09-27 | GEN-OWNED | https://suno.com/terms | owner | `assets/prompts/music/music-title-main-theme.md` | no |

## Sound effects & ambience

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | | | | |

## Fonts

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| _(none yet — planned: Cinzel, Cinzel Decorative, Alegreya Sans, IM Fell English, Uncial Antiqua, Atkinson Hyperlegible; all OFL-1.1)_ | | | | | | | | | |

## Third-party kits

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | | | | |

---

## Audit log

| Date | Milestone | Auditor | Result | Notes |
|---|---|---|---|---|
| _(first audit at m1 exit — bead `e37-credits-audit`)_ | | | | |
