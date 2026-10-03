// @vitest-environment happy-dom
// The title menu and slot screens (mw-e30.11): what they offer, where focus starts, the disabled
// Continue's reason, and that the slot rows are reachable with directions, confirm and back alone.
// AC-1 to AC-3 run end to end in e2e/save-menus.spec.ts; the flows behind the screens are tested in
// src/game/save/menus.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openSlotList,
  openTitleMenu,
  SAVE_MENU_TEXT,
  SAVE_SLOTS_SCREEN,
  TITLE_SCREEN,
  type SlotEntry,
} from '@ui/save-menus';
import { UiRoot } from '@ui/screens';
import { place, rectFromData } from '@ui/testing/layout';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const active = (): HTMLElement => document.activeElement as HTMLElement;

/** The accessible description (aria-describedby text) of `el`. */
const description = (el: Element): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

const ENTRIES: SlotEntry[] = [
  {
    id: 'manual-1',
    title: 'Manual save 1',
    detail: 'testbed · 2:03 played · just now',
    empty: false,
  },
  {
    id: 'auto-1',
    title: 'Autosave 1',
    detail: 'testbed · 1:00 played · 5 min ago',
    empty: false,
    thumbnail: 'data:image/png;base64,AAAA',
  },
  { id: 'manual-2', title: 'Manual save 2', detail: 'Empty slot', empty: true },
];

/** Lays the slot rows out as the stylesheet does: one row per slot, Delete to the right. */
function layOut(): void {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-slot]')];
  rows.forEach((row, i) => {
    const y = 100 + i * 60;
    const choose = row.querySelector<HTMLElement>('[data-action="choose"]');
    const remove = row.querySelector<HTMLElement>('[data-action="delete"]');
    if (choose) place(choose, 0, y, 400, 50);
    if (remove) place(remove, 410, y, 80, 50);
  });
  const back = document.querySelector<HTMLElement>('[data-action="back"]');
  if (back) place(back, 0, 100 + rows.length * 60, 80, 40);
}

const focusedAction = (): string =>
  `${active().closest<HTMLElement>('[data-slot]')?.dataset['slot'] ?? '-'}/${active().dataset['action'] ?? '?'}`;

describe('title menu', () => {
  it('AC-1: with a save, Continue is focused, describes the save and continues', () => {
    const onContinue = vi.fn();
    const menu = openTitleMenu(ui, {
      last: { title: 'Manual save 1', detail: 'testbed · just now' },
      onContinue,
      onNewGame: vi.fn(),
      onLoad: vi.fn(),
    });
    expect(menu.screen.id).toBe(TITLE_SCREEN);
    expect(ui.pausesSim && ui.capturesInput).toBe(true);
    expect([...document.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Continue',
      'New Game',
      'Load',
    ]);
    expect(active()).toBe(menu.continueButton);
    expect(menu.continueButton.hasAttribute('aria-disabled')).toBe(false);
    expect(description(menu.continueButton)).toBe('Last save: Manual save 1 · testbed · just now');
    ui.intent('confirm', 'keyboard');
    expect(onContinue).toHaveBeenCalledOnce();
    ui.intent('back', 'keyboard');
    expect(ui.top?.id).toBe(TITLE_SCREEN);
  });

  it('AC-2: with no saves, Continue is disabled with the reason "No saves yet" and New Game is focused', () => {
    const onContinue = vi.fn();
    const onNewGame = vi.fn();
    const onLoad = vi.fn();
    const menu = openTitleMenu(ui, { last: undefined, onContinue, onNewGame, onLoad });
    const cont = menu.continueButton;
    expect(cont.getAttribute('aria-disabled')).toBe('true');
    expect(cont.dataset['reason']).toBe(SAVE_MENU_TEXT.noSaves);
    expect(description(cont)).toBe('No saves yet');
    expect(active().textContent).toBe('New Game');
    cont.click();
    expect(onContinue).not.toHaveBeenCalled();
    ui.intent('confirm', 'keyboard');
    expect(onNewGame).toHaveBeenCalledOnce();
    document.querySelector<HTMLElement>('[data-action="load"]')?.click();
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('gives the reason it is given when saves could not be read', () => {
    const menu = openTitleMenu(ui, {
      last: undefined,
      unavailable: 'Saves could not be read',
      onContinue: vi.fn(),
      onNewGame: vi.fn(),
      onLoad: vi.fn(),
    });
    expect(description(menu.continueButton)).toBe('Saves could not be read');
  });

  it('shows the build SHA when given one (mw-e01.2)', () => {
    openTitleMenu(ui, {
      last: undefined,
      build: 'abc1234',
      onContinue: vi.fn(),
      onNewGame: vi.fn(),
      onLoad: vi.fn(),
    });
    expect(document.querySelector('[data-testid="title-build"]')?.textContent).toBe(
      'Build abc1234',
    );
  });

  it('shows no build line without one', () => {
    openTitleMenu(ui, {
      last: undefined,
      onContinue: vi.fn(),
      onNewGame: vi.fn(),
      onLoad: vi.fn(),
    });
    expect(document.querySelector('[data-testid="title-build"]')).toBeNull();
  });
});

describe('slot list', () => {
  it('shows each slot with thumbnail and details, focuses the first and closes on Back', () => {
    const onClose = vi.fn();
    const list = openSlotList(ui, {
      mode: 'load',
      entries: ENTRIES,
      onChoose: vi.fn(),
      onDelete: vi.fn(),
      onClose,
    });
    expect(list.screen.id).toBe(SAVE_SLOTS_SCREEN);
    expect(list.screen.element.getAttribute('aria-label')).toBe('Load a save');
    expect(ui.pausesSim).toBe(true);
    const rows = [...document.querySelectorAll<HTMLElement>('[data-slot]')];
    expect(rows.map((row) => row.dataset['slot'])).toEqual(['manual-1', 'auto-1', 'manual-2']);
    expect(rows[0]?.querySelector('[data-action="choose"]')?.textContent).toBe(
      'Manual save 1testbed · 2:03 played · just nowLoad',
    );
    // A placeholder without a thumbnail, the image with one; both hidden from screen readers.
    expect(rows[0]?.querySelector('span.vb-slot-thumb')?.getAttribute('aria-hidden')).toBe('true');
    const img = rows[1]?.querySelector('img');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(img?.getAttribute('alt')).toBe('');
    // Empty slots have nothing to delete; Delete names the save it deletes.
    expect(rows[2]?.querySelector('[data-action="delete"]')).toBeNull();
    expect(rows[0]?.querySelector('[data-action="delete"]')?.getAttribute('aria-label')).toBe(
      'Delete Manual save 1',
    );
    expect(focusedAction()).toBe('manual-1/choose');
    expect(document.querySelector('[data-testid="save-slots-warning"]')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-testid="save-slots-error"]')?.hidden).toBe(
      true,
    );
    ui.intent('back', 'keyboard');
    expect(ui.top).toBeUndefined();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('AC-3: directions, confirm and back reach every row action', () => {
    const onChoose = vi.fn();
    const onDelete = vi.fn();
    openSlotList(ui, { mode: 'save', entries: ENTRIES, onChoose, onDelete });
    layOut();
    expect(focusedAction()).toBe('manual-1/choose');
    expect(active().textContent).toContain(SAVE_MENU_TEXT.saveVerb);
    ui.intent('confirm', 'keyboard');
    expect(onChoose).toHaveBeenLastCalledWith(ENTRIES[0]);
    ui.intent('right', 'keyboard');
    expect(focusedAction()).toBe('manual-1/delete');
    ui.intent('confirm', 'keyboard');
    expect(onDelete).toHaveBeenLastCalledWith(ENTRIES[0]);
    ui.intent('down', 'keyboard');
    expect(focusedAction()).toBe('auto-1/delete');
    ui.intent('down', 'keyboard');
    expect(focusedAction()).toBe('manual-2/choose');
    ui.intent('confirm', 'keyboard');
    expect(onChoose).toHaveBeenLastCalledWith(ENTRIES[2]);
    ui.intent('down', 'keyboard');
    expect(focusedAction()).toBe('-/back');
    ui.intent('up', 'keyboard');
    ui.intent('up', 'keyboard');
    expect(focusedAction()).toBe('auto-1/choose');
    ui.intent('confirm', 'keyboard');
    expect(onChoose).toHaveBeenLastCalledWith(ENTRIES[1]);
    ui.intent('back', 'keyboard');
    expect(ui.top).toBeUndefined();
  });

  it('an empty list says so and focuses Back', () => {
    openSlotList(ui, { mode: 'load', entries: [], onChoose: vi.fn(), onDelete: vi.fn() });
    expect(document.querySelector('[data-testid="save-slots-empty"]')?.textContent).toBe(
      SAVE_MENU_TEXT.emptyList,
    );
    expect(focusedAction()).toBe('-/back');
    ui.intent('confirm', 'keyboard');
    expect(ui.top).toBeUndefined();
  });

  it('AC-4: shows the warning and the read error it is given, as alerts', () => {
    openSlotList(ui, {
      mode: 'save',
      entries: [],
      warning: 'Saves will not persist',
      error: 'Saves could not be read: blocked',
      onChoose: vi.fn(),
      onDelete: vi.fn(),
    });
    const warning = document.querySelector('[data-testid="save-slots-warning"]');
    expect(warning?.textContent).toBe('Saves will not persist');
    expect(warning?.getAttribute('role')).toBe('alert');
    const error = document.querySelector<HTMLElement>('[data-testid="save-slots-error"]');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe('Saves could not be read: blocked');
  });

  it('a row that cannot load reads as disabled with its reason, and still reports the press', () => {
    const onChoose = vi.fn();
    const broken: SlotEntry = {
      id: 'manual-3',
      title: 'Manual save 3',
      detail: 'Damaged save',
      empty: false,
      unavailable: 'Damaged, and no backup could be read',
    };
    openSlotList(ui, { mode: 'load', entries: [broken], onChoose, onDelete: vi.fn() });
    const choose = active();
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    expect(choose.dataset['reason']).toBe(broken.unavailable);
    expect(description(choose)).toBe(broken.unavailable);
    choose.click();
    expect(onChoose).toHaveBeenCalledWith(broken);
  });

  it('update redraws the rows and the message, keeping focus on the same slot and action', () => {
    const list = openSlotList(ui, {
      mode: 'save',
      entries: ENTRIES,
      onChoose: vi.fn(),
      onDelete: vi.fn(),
    });
    layOut();
    ui.intent('right', 'keyboard');
    expect(focusedAction()).toBe('manual-1/delete');
    // The slot is still saved: focus stays on its Delete.
    list.update(ENTRIES, { status: 'Saved to Manual save 1' });
    expect(focusedAction()).toBe('manual-1/delete');
    expect(document.querySelector('[data-testid="save-slots-status"]')?.textContent).toBe(
      'Saved to Manual save 1',
    );
    // Deleted: the row has no Delete any more, so focus falls back to its main action.
    const emptied = ENTRIES.map((e) =>
      e.id === 'manual-1' ? { ...e, detail: 'Empty slot', empty: true } : e,
    );
    list.update(emptied, { status: 'Deleted Manual save 1' });
    expect(focusedAction()).toBe('manual-1/choose');
    // The row is gone (the Load list drops deleted saves): the first row takes focus.
    list.update(ENTRIES.slice(1), { error: 'Could not delete' });
    expect(focusedAction()).toBe('auto-1/choose');
    const error = document.querySelector<HTMLElement>('[data-testid="save-slots-error"]');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe('Could not delete');
    expect(document.querySelector('[data-testid="save-slots-status"]')?.textContent).toBe('');
    // No rows left: Back.
    list.update([]);
    expect(focusedAction()).toBe('-/back');
    // Focus outside any row (Back) stays where it is.
    list.update(ENTRIES);
    expect(focusedAction()).toBe('-/back');
  });
});
