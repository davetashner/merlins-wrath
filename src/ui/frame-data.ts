// The combat sandbox's frame-data overlay (mw-e04.9): one row per fighter — the knight, the attacker
// dummies, the training dummies — showing the move it is performing, its phase and the tick within
// the move, whether it is invulnerable (i-frames) or armored (hyperarmor) right now, the hit-stop
// freezing it (mw-e04.11), the hit reaction holding it, its health and poise, the damage per second
// it is taking and the latest harm the world dealt it (a fall, a wall strike, a crushing object, a
// hazard; mw-e04.34). A header line shows the world tick and the sim speed (slow motion). A HUD
// widget like the others: it shows a view model the game derives from the sim after each tick
// (src/game/combat/frame-data.ts) and writes the DOM only when a shown value changed.
//
// Readability over density: large monospace numbers, a coloured chip per phase (startup in the
// hearth accent, active in ember, recovery muted), and i-frame / hyperarmor badges that light up only
// while they apply. Its stylesheet is its own (installed once), built from the kit's tokens.

import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

/** The phase of a fighter's action timeline. */
export type FramePhase = 'idle' | 'startup' | 'active' | 'recovery' | 'locked';

/** One fighter's row. Text is final (the game formats numbers). */
export interface FrameDataRowModel {
  /** Stable key (the entity id). */
  readonly key: string;
  readonly label: string;
  /** Move id, or '—' when it performs none. */
  readonly move: string;
  readonly phase: FramePhase;
  /** Tick within the move over its length ("14/42"), or '' when idle. */
  readonly frame: string;
  readonly iframes: boolean;
  readonly hyperarmor: boolean;
  /** The hit-stop freezing it: tier and frozen ticks left ("heavy 4"), or ''. */
  readonly hitStop: string;
  /** The hit reaction holding it and ticks left ("stagger 31"), or ''. */
  readonly reaction: string;
  /** "812/1000", or '' without health. */
  readonly health: string;
  readonly poise: string;
  /** Damage per second taken ("34.5"), or ''. */
  readonly dps: string;
  /** The latest harm the world dealt it, kind and damage ("fall 42"), or ''. */
  readonly world: string;
}

/** What the overlay shows. */
export interface FrameDataModel {
  /** Header: world tick, sim speed and the key hints. */
  readonly header: string;
  readonly rows: readonly FrameDataRowModel[];
}

const COLUMNS = [
  ['label', 'Fighter'],
  ['move', 'Move'],
  ['phase', 'Phase'],
  ['frame', 'Tick'],
  ['flags', 'I-frames / armor'],
  ['hitStop', 'Hit-stop'],
  ['reaction', 'Reaction'],
  ['health', 'Health'],
  ['poise', 'Poise'],
  ['dps', 'DPS'],
  ['world', 'World'],
] as const;

type Column = (typeof COLUMNS)[number][0];

const STYLE_ID = 'vb-frame-data-styles';

const STYLES = `
.vb-frame-data {
  position: absolute;
  top: var(--ui-space-3);
  right: var(--ui-space-3);
  padding: var(--ui-space-2) var(--ui-space-3);
  background: var(--ui-color-backdrop);
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius);
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: calc(15px * var(--ui-text-scale));
  line-height: 1.5;
  text-shadow: none;
  max-width: calc(100% - 2 * var(--ui-space-3));
  overflow-x: auto;
}
.vb-frame-data[hidden] { display: none; }
.vb-frame-data-header { margin: 0 0 var(--ui-space-1); color: var(--ui-color-accent); }
.vb-frame-data table { border-collapse: collapse; }
.vb-frame-data th {
  text-align: left;
  font-weight: 400;
  font-size: 0.8em;
  opacity: 0.8;
  padding: 0 var(--ui-space-2);
}
.vb-frame-data td { padding: 1px var(--ui-space-2); white-space: nowrap; }
.vb-frame-data td[data-col='hitStop']:not(:empty) { color: var(--ui-color-warning); }
.vb-frame-data td[data-col='frame'],
.vb-frame-data td[data-col='health'],
.vb-frame-data td[data-col='poise'],
.vb-frame-data td[data-col='dps'] { text-align: right; }
.vb-frame-chip {
  display: inline-block;
  min-width: 5.5em;
  padding: 0 0.4em;
  border-radius: var(--ui-radius);
  text-align: center;
  color: var(--ui-color-text);
  background: var(--ui-color-panel);
}
.vb-frame-chip[data-phase='startup'] { background: var(--ui-color-accent); }
.vb-frame-chip[data-phase='active'] { background: var(--ui-color-warning); color: var(--ui-color-panel-raised); }
.vb-frame-chip[data-phase='recovery'] { background: var(--ui-color-text-muted); color: var(--ui-color-panel); }
.vb-frame-chip[data-phase='locked'] { background: var(--ui-color-border); }
.vb-frame-chip[data-phase='idle'] { background: transparent; color: inherit; opacity: 0.7; }
.vb-frame-badge {
  display: inline-block;
  margin-right: 0.3em;
  padding: 0 0.3em;
  border: 1px solid currentColor;
  border-radius: var(--ui-radius);
  opacity: 0.25;
}
.vb-frame-badge[data-on='true'] { opacity: 1; background: var(--ui-color-stamina); color: var(--ui-color-panel-raised); }
.vb-frame-badge[data-kind='armor'][data-on='true'] { background: var(--ui-color-border); color: var(--ui-color-text); }
`;

/** Adds the overlay's stylesheet to `doc` once. */
function installStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.append(style);
}

interface RowView {
  readonly element: HTMLTableRowElement;
  readonly cells: Readonly<Record<Column, HTMLTableCellElement>>;
  readonly chip: HTMLElement;
  readonly iframes: HTMLElement;
  readonly armor: HTMLElement;
  readonly cache: WriteCache;
}

function rowView(key: string): RowView {
  const chip = h('span', { className: 'vb-frame-chip', data: { part: 'phase' } });
  const iframes = h('span', {
    className: 'vb-frame-badge',
    text: 'IFR',
    data: { kind: 'iframes' },
  });
  const armor = h('span', { className: 'vb-frame-badge', text: 'ARM', data: { kind: 'armor' } });
  const cells = Object.fromEntries(
    COLUMNS.map(([col]) => [col, h('td', { data: { col } })]),
  ) as Record<Column, HTMLTableCellElement>;
  cells.phase.append(chip);
  cells.flags.append(iframes, armor);
  iframes.title = 'Invulnerable (i-frames)';
  armor.title = 'Hyperarmor';
  const element = h('tr', { data: { key } }, ...COLUMNS.map(([col]) => cells[col]));
  return { element, cells, chip, iframes, armor, cache: new WriteCache() };
}

/** The frame-data overlay; put its element in `ui.hud`. Hidden until `visible` is set. */
export class FrameDataPanel implements HudWidget<FrameDataModel> {
  readonly element: HTMLElement;
  readonly #header: HTMLElement;
  readonly #body: HTMLTableSectionElement;
  readonly #rows = new Map<string, RowView>();
  readonly #cache = new WriteCache();

  constructor(doc: Document = document) {
    installStyles(doc);
    this.#header = h('p', { className: 'vb-frame-data-header', data: { part: 'header' } });
    this.#body = h('tbody');
    const head = h(
      'thead',
      {},
      h('tr', {}, ...COLUMNS.map(([, title]) => h('th', { text: title }))),
    );
    this.element = h(
      'section',
      {
        className: 'vb-frame-data',
        attrs: { 'aria-label': 'Frame data' },
        data: { testid: 'frame-data', uiComponent: 'frame-data' },
      },
      this.#header,
      h('table', {}, head, this.#body),
    );
    this.element.hidden = true;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  set visible(value: boolean) {
    this.element.hidden = !value;
  }

  update(model: FrameDataModel): void {
    this.#cache.set('header', model.header, (v) => {
      this.#header.textContent = v;
    });
    const views = model.rows.map((row) => {
      const view = this.#rows.get(row.key) ?? rowView(row.key);
      this.#rows.set(row.key, view);
      updateRow(view, row);
      return view;
    });
    const keys = model.rows.map((row) => row.key);
    this.#cache.set('keys', keys.join(' '), () => {
      for (const [key, view] of this.#rows) {
        if (!keys.includes(key)) {
          view.element.remove();
          this.#rows.delete(key);
        }
      }
      // Appending moves rows already there, so the table follows the model's order.
      this.#body.append(...views.map((view) => view.element));
    });
  }
}

function updateRow(view: RowView, row: FrameDataRowModel): void {
  const { cache: c, cells } = view;
  const text = [
    'label',
    'move',
    'frame',
    'hitStop',
    'reaction',
    'health',
    'poise',
    'dps',
    'world',
  ] as const;
  for (const col of text) {
    c.set(col, row[col], (v) => {
      cells[col].textContent = v;
    });
  }
  c.set('phase', row.phase, (v) => {
    view.chip.textContent = v;
    view.chip.dataset['phase'] = v;
  });
  c.set('iframes', String(row.iframes), (v) => {
    view.iframes.dataset['on'] = v;
  });
  c.set('armor', String(row.hyperarmor), (v) => {
    view.armor.dataset['on'] = v;
  });
}
