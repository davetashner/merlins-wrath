# prop-rest-lamp-01

| Field | Value |
|---|---|
| Asset id | `prop-rest-lamp-01` |
| Category | prop (signature) + UI icon + favicon |
| Consuming bead(s) | `e27-rest-points` (mw-e27.13), site favicon, future UI iconography |
| Source | Owner-made in ChatGPT image generation, 2026-09-27 (1295×1215 PNG, transparent background) |

## Role in the game

The **rest lamp** is the game's bonfire. Every rest point is one of these lamps; lighting one discovers and
activates the rest point, and resting at a lit lamp passes time and resets the facts `e27-rest-points`
defines. The same lamp is the site favicon and appears in UI iconography (rest-point map markers, the
"lamp lit" toast). It fits canon: every ending "leaves a lamp lit", and in the Cradle the abbot's lanterns
are the only warm light.

## Notes for the 3D model

Hexagonal iron lantern with a ring handle, riveted bands, crossed-bar and plain glass panes, a dripping
candle. Needs an **unlit** and a **lit** state (emissive flame and glass, warm point light, `hearth`
#E8A24A glow per style bible §2). To reach the in-game low-poly look, the concept should be simplified
before image-to-3D (style bible key-art exception doesn't cover in-game props).

## Derived files

`site/favicon.ico` (16/32/48), `site/icons/favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png`
(180, on ink #1E1B2E), `icon-192.png`, `icon-512.png`: tightly cropped, small sizes brightened slightly
so the flame reads.

## Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v1 | approved as the signature lamp and favicon source | owner | 2026-09-27 | |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| prop-rest-lamp-01 | `assets/_incoming/prop-rest-lamp-01/v1.png` | ChatGPT image generation (OpenAI), owner-made | 2026-09-27 | OpenAI terms: output owned by the user | this file |
