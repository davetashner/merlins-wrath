// Placeholder item icons (mw-e17.10): one flat ink glyph per item category, plus the stolen marker and
// the gold coin, until the painted icons land (style bible §9.2; the e37 icon integration beads swap
// them in by each item's `icon` asset id). Drawn as inline SVG in `currentColor`, so they take the
// text colour of wherever they sit (ink on parchment, parchment on the HUD) and scale with the text.
// Always decorative: the item's name next to them is what a screen reader reads.

/** The placeholder icon kinds: every item category, plus the stolen marker. */
export const ITEM_ICON_KINDS = [
  'weapon',
  'armor',
  'shield',
  'ammo',
  'book',
  'key',
  'consumable',
  'tool',
  'quest',
  'artifact',
  'currency',
  'misc',
  'stolen',
] as const;
export type ItemIconKind = (typeof ITEM_ICON_KINDS)[number];

/** 24×24 path data per kind (stroked, round caps). */
export const ITEM_ICON_PATHS: Readonly<Record<ItemIconKind, string>> = Object.freeze({
  weapon: 'M5 19 19 5m-4 0h4v4M7 13l4 4m-6 0 2 2',
  armor: 'M8 4 4 7l2 4 2-1v10h8V10l2 1 2-4-4-3c-1 2-2.5 3-4 3S9 6 8 4z',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  ammo: 'M4 20 20 4m-6 0h6v6M4 20l1-4m-1 4 4-1',
  book: 'M5 4h10a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zm2 14h10',
  key: 'M4 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0m7 3 8 8m-3-3 2-2m0 4 2-2',
  consumable: 'M10 3h4m-4 0v5l-4 8a3 3 0 0 0 3 4h6a3 3 0 0 0 3-4l-4-8V3',
  tool: 'M14 4a4 4 0 0 0 5 5l-9 9a2 2 0 0 1-3-3l9-9a4 4 0 0 1-2-2z',
  quest: 'M6 5h11v13a2 2 0 0 1-2 2H7M6 5a2 2 0 0 0 0 4h2m1 0h6m-6 4h6',
  artifact: 'M7 4h10l4 5-9 11L3 9zM3 9h18',
  currency: 'M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0m8-4v8',
  misc: 'M8 7h8l3 11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zm1-3h6l-1 3h-4z',
  stolen:
    'M8 12V6a1 1 0 0 1 2 0v5m0 0V4a1 1 0 0 1 2 0v7m0 0V5a1 1 0 0 1 2 0v6m0 0V8a1 1 0 0 1 2 0v6a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2-3a1 1 0 0 1 2-1l2 2',
});

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A decorative placeholder icon (`aria-hidden`), `1em` square unless CSS sizes it. */
export function itemIcon(kind: ItemIconKind, className = 'vb-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset['icon'] = kind;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ITEM_ICON_PATHS[kind]);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.75');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}
