// The container window (mw-e18.4): what a chest, barrel or corpse holds, with Take and Take All, so
// looting is one or two inputs. Grey-box styling on the kit's tokens; the container window frame is an
// asset bead (mw-e37.121), and item icons are the placeholder category glyphs (item-icons.ts).
//
// - Rows: one button per stack (icon, name, count) and one for the gold. Confirm or a click on a row
//   takes that stack; the window stays open and the game answers with a new model (`update`).
// - Take All: a button that has focus when the window opens, so Interact then confirm (E, Enter or
//   A, A) loots a chest; R or X (the UI's `secondary` intent) presses it from anywhere in the window.
//   It closes the window at once, in the same frame, and reports `onTakeAll`.
// - Empty: a container with nothing in it says "Empty", and Take All is disabled (focus starts on
//   Close instead).
//
// The window pauses the sim and captures input; Back (Esc, B) or Close shuts it. It never changes
// game state: every choice is reported, and the game sends it to the sim as a command. Every size is
// in em, so the window follows the text-size setting, and names wrap rather than clip.

import { button } from './components/controls';
import { h } from './components/dom';
import { UI_INTENT_GLYPHS } from './components/overlays';
import { itemIcon, type ItemIconKind } from './item-icons';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the container window. */
export const CONTAINER_SCREEN = 'container';

export const CONTAINER_TEXT = Object.freeze({
  contents: 'Contents',
  empty: 'Empty',
  takeAll: 'Take All',
  close: 'Close',
  hint: `${UI_INTENT_GLYPHS.keyboard.secondary} or ${UI_INTENT_GLYPHS.gamepad.secondary}: Take All. ${UI_INTENT_GLYPHS.keyboard.back} or ${UI_INTENT_GLYPHS.gamepad.back}: Close.`,
});

/** One stack in the container. */
export interface ContainerRowModel {
  /** Stable while the stack exists (the container's inventory instance id). */
  readonly id: number;
  readonly name: string;
  readonly icon: ItemIconKind;
  readonly count: number;
}

/** What the container window shows. */
export interface ContainerWindowModel {
  /** The container's name, e.g. "Supply chest". */
  readonly title: string;
  readonly gold: number;
  readonly items: readonly ContainerRowModel[];
}

export interface ContainerWindowOptions {
  readonly model: ContainerWindowModel;
  /** Take the stack `id` (the window stays open). */
  readonly onTake: (id: number) => void;
  /** Take the gold (the window stays open). */
  readonly onTakeGold: () => void;
  /** Take everything (the window has already closed). */
  readonly onTakeAll: () => void;
  /** The window closed (after Take All, Close or Back). */
  readonly onClose?: () => void;
}

export interface ContainerWindow {
  readonly screen: Screen;
  /** Whether the container shows as empty. */
  readonly empty: boolean;
  /** Shows a new model, keeping focus on the same row, or a neighbour when that row is gone. */
  update(model: ContainerWindowModel): void;
  /** Says something on the status line (a refused take). */
  say(text: string): void;
  /** Presses Take All (disabled while empty: does nothing then). */
  takeAll(): void;
  close(): void;
}

/** A row's accessible name: "Take Healing draught, 2". */
export function takeLabel(name: string, count: number): string {
  return `Take ${name}${count > 1 ? `, ${String(count)}` : ''}`;
}

/** "12 gold". */
const goldName = (gold: number): string => `${String(gold)} gold`;

/** Whether a model holds nothing. */
export const containerModelEmpty = (model: ContainerWindowModel): boolean =>
  model.items.length === 0 && model.gold === 0;

/** Opens the container window on `ui`. */
export function openContainerWindow(ui: UiRoot, options: ContainerWindowOptions): ContainerWindow {
  let model = options.model;
  let rows: HTMLButtonElement[] = [];

  const title = h('h1', { text: model.title });
  const list = h('div', {
    className: 'vb-stack vb-container-rows',
    attrs: { role: 'group', 'aria-label': CONTAINER_TEXT.contents },
    data: { testid: 'container-rows' },
  });
  const empty = h('p', {
    className: 'vb-container-empty',
    text: CONTAINER_TEXT.empty,
    data: { testid: 'container-empty' },
  });
  const status = h('p', {
    className: 'vb-container-status',
    attrs: { role: 'status' },
    data: { testid: 'container-status' },
  });
  let closing = false;
  const takeAllButton = button({
    label: CONTAINER_TEXT.takeAll,
    onPress: () => {
      takeAll();
    },
  });
  takeAllButton.dataset['action'] = 'take-all';
  const closeButton = button({
    label: CONTAINER_TEXT.close,
    onPress: () => {
      screen.close();
    },
  });
  closeButton.dataset['action'] = 'close';
  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-container', data: { testid: 'container-window' } },
    title,
    list,
    empty,
    status,
    h('div', { className: 'vb-row vb-container-actions' }, takeAllButton, closeButton),
    h('p', { className: 'vb-container-hint', text: CONTAINER_TEXT.hint }),
  );

  function takeAll(): void {
    if (closing || containerModelEmpty(model)) return;
    closing = true;
    screen.close();
    options.onTakeAll();
  }

  function makeRow(
    key: string,
    name: string,
    icon: ItemIconKind,
    count: number,
    onPress: () => void,
  ): HTMLButtonElement {
    const row = button({ label: '', onPress });
    row.classList.add('vb-container-row');
    row.dataset['containerItem'] = key;
    row.setAttribute('aria-label', takeLabel(name, count));
    row.replaceChildren(
      itemIcon(icon, 'vb-icon vb-container-icon'),
      h('span', { className: 'vb-container-name', text: name, attrs: { 'aria-hidden': 'true' } }),
      ...(count > 1
        ? [
            h('span', {
              className: 'vb-container-count',
              text: `×${String(count)}`,
              attrs: { 'aria-hidden': 'true' },
            }),
          ]
        : []),
    );
    return row;
  }

  /** Rebuilds the rows; `refocus` puts focus on the row that had it, or its neighbour. */
  function render(refocus: boolean): void {
    const focusedKey = (document.activeElement as HTMLElement | null)?.dataset['containerItem'];
    const previous = rows.findIndex((row) => row.dataset['containerItem'] === focusedKey);
    title.textContent = model.title;
    rows = [
      ...(model.gold > 0
        ? [makeRow('gold', goldName(model.gold), 'currency', 1, options.onTakeGold)]
        : []),
      ...model.items.map((item) =>
        makeRow(String(item.id), item.name, item.icon, item.count, () => {
          options.onTake(item.id);
        }),
      ),
    ];
    list.replaceChildren(...rows);
    const isEmpty = rows.length === 0;
    list.hidden = isEmpty;
    empty.hidden = !isEmpty;
    takeAllButton.disabled = isEmpty;
    const first = isEmpty ? closeButton : takeAllButton;
    delete takeAllButton.dataset['autofocus'];
    delete closeButton.dataset['autofocus'];
    first.dataset['autofocus'] = '';
    if (!refocus) return;
    const kept =
      rows.find((row) => row.dataset['containerItem'] === focusedKey) ??
      (previous === -1 ? undefined : rows[Math.min(previous, rows.length - 1)]);
    (kept ?? first).focus();
  }

  render(false);
  const screen = ui.push({
    id: CONTAINER_SCREEN,
    label: model.title,
    content,
    pausesSim: true,
    onIntent: (intent) => {
      if (intent !== 'secondary') return false;
      takeAll();
      return true;
    },
    onClose: () => {
      closing = true;
      options.onClose?.();
    },
  });

  return {
    screen,
    get empty() {
      return containerModelEmpty(model);
    },
    update(next) {
      model = next;
      const active = document.activeElement;
      // Keep focus inside when it was on a row (the taken stack's row is about to go).
      render(list.contains(active) || active === takeAllButton);
    },
    say(text) {
      status.textContent = text;
    },
    takeAll,
    close() {
      screen.close();
    },
  };
}
