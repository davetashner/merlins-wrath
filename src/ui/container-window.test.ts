// @vitest-environment happy-dom
// The container window (mw-e18.4): rows with icons, Take and Take gold, Take All on a button, R or X,
// closing in the same frame, the empty state, model updates that keep focus, the status line and
// pausing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTAINER_SCREEN,
  CONTAINER_TEXT,
  containerModelEmpty,
  openContainerWindow,
  takeLabel,
  type ContainerWindowModel,
} from '@ui/container-window';
import { keyIntent, padIntents } from '@ui/input';
import { UI_INTENT_GLYPHS } from '@ui/components/overlays';
import { UiRoot } from '@ui/screens';
import { find, rectFromData } from '@ui/testing/layout';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const CHEST: ContainerWindowModel = {
  title: 'Supply chest',
  gold: 12,
  items: [
    { id: 1, name: 'Healing draught', icon: 'consumable', count: 1 },
    { id: 2, name: 'Standard arrow', icon: 'ammo', count: 9 },
    { id: 3, name: 'Oil flask', icon: 'consumable', count: 2 },
  ],
};
const EMPTY: ContainerWindowModel = { title: 'Barrel', gold: 0, items: [] };

function open(model: ContainerWindowModel = CHEST) {
  const onTake = vi.fn<(id: number) => void>();
  const onTakeGold = vi.fn<() => void>();
  const onTakeAll = vi.fn<() => void>();
  const onClose = vi.fn<() => void>();
  const window = openContainerWindow(ui, { model, onTake, onTakeGold, onTakeAll, onClose });
  const rows = () => [
    ...document.querySelectorAll<HTMLButtonElement>(
      `[data-screen="${CONTAINER_SCREEN}"] [data-container-item]`,
    ),
  ];
  const takeAll = find('[data-screen="container"] [data-action="take-all"]') as HTMLButtonElement;
  return { window, onTake, onTakeGold, onTakeAll, onClose, rows, takeAll };
}

describe('container window (mw-e18.4)', () => {
  it('lists the gold and every stack with an icon, name and count; Take All has focus', () => {
    const t = open();
    expect(ui.top?.id).toBe(CONTAINER_SCREEN);
    expect(ui.top?.element.getAttribute('aria-label')).toBe('Supply chest');
    expect(find('[data-testid="container-window"] h1').textContent).toBe('Supply chest');
    expect(t.rows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Take 12 gold',
      'Take Healing draught',
      'Take Standard arrow, 9',
      'Take Oil flask, 2',
    ]);
    expect(t.rows().map((row) => row.querySelector('svg')?.dataset['icon'])).toEqual([
      'currency',
      'consumable',
      'ammo',
      'consumable',
    ]);
    expect(t.rows()[2]?.querySelector('.vb-container-count')?.textContent).toBe('×9');
    expect(t.rows()[1]?.querySelector('.vb-container-count')).toBeNull();
    expect(document.activeElement).toBe(t.takeAll);
    expect(t.takeAll.disabled).toBe(false);
    expect(find('[data-testid="container-empty"]').hidden).toBe(true);
    expect(t.window.empty).toBe(false);
    expect(ui.pausesSim).toBe(true);
    expect(ui.capturesInput).toBe(true);
  });

  it('a row takes its stack, the gold row takes the gold, and the window stays open', () => {
    const t = open();
    t.rows()[2]?.click();
    expect(t.onTake).toHaveBeenCalledWith(2);
    t.rows()[0]?.click();
    expect(t.onTakeGold).toHaveBeenCalledOnce();
    expect(ui.top?.id).toBe(CONTAINER_SCREEN);
    // Confirm on a focused row presses it (gamepad A).
    t.rows()[1]?.focus();
    ui.intent('confirm', 'gamepad');
    expect(t.onTake).toHaveBeenLastCalledWith(1);
  });

  it('AC-1: Take All closes the window at once, then reports the take (button, confirm, R or X)', () => {
    const order: string[] = [];
    const first = open();
    first.onClose.mockImplementation(() => order.push('closed'));
    first.onTakeAll.mockImplementation(() => order.push('take-all'));
    first.takeAll.click();
    expect(order).toEqual(['closed', 'take-all']);
    expect(ui.top).toBeUndefined();
    expect(ui.pausesSim).toBe(false);
    // Pressing again (a stale reference) does nothing.
    first.window.takeAll();
    expect(first.onTakeAll).toHaveBeenCalledOnce();

    const confirm = open();
    ui.intent('confirm', 'keyboard'); // Take All has focus
    expect(confirm.onTakeAll).toHaveBeenCalledOnce();

    const keyR = open();
    keyR.rows()[3]?.focus(); // from anywhere in the window
    const intent = keyIntent({
      code: 'KeyR',
      repeat: false,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
    expect(intent).toBe('secondary');
    ui.intent('secondary', 'keyboard');
    expect(keyR.onTakeAll).toHaveBeenCalledOnce();
    expect(ui.top).toBeUndefined();

    const padX = open();
    const pressed = { pressed: true };
    const up = { pressed: false };
    const held = padIntents({
      connected: true,
      mapping: 'standard',
      buttons: [up, up, pressed],
      axes: [],
    });
    expect([...held]).toEqual(['secondary']);
    ui.intent('secondary', 'gamepad');
    expect(padX.onTakeAll).toHaveBeenCalledOnce();
    expect(UI_INTENT_GLYPHS.keyboard.secondary).toBe('R');
    expect(UI_INTENT_GLYPHS.gamepad.secondary).toBe('X');
    expect(CONTAINER_TEXT.hint).toBe('R or X: Take All. Esc or B: Close.');
  });

  it('AC-4: an empty container shows "Empty" and Take All is disabled', () => {
    const t = open(EMPTY);
    expect(find('[data-testid="container-empty"]').hidden).toBe(false);
    expect(find('[data-testid="container-empty"]').textContent).toBe('Empty');
    expect(find('[data-testid="container-rows"]').hidden).toBe(true);
    expect(t.rows()).toEqual([]);
    expect(t.takeAll.disabled).toBe(true);
    expect(t.window.empty).toBe(true);
    // Focus starts on Close; R, X and a stray press do nothing.
    expect((document.activeElement as HTMLElement).dataset['action']).toBe('close');
    ui.intent('secondary', 'keyboard');
    t.window.takeAll();
    expect(t.onTakeAll).not.toHaveBeenCalled();
    expect(ui.top?.id).toBe(CONTAINER_SCREEN);
    expect(containerModelEmpty(EMPTY)).toBe(true);
    expect(containerModelEmpty({ ...EMPTY, gold: 1 })).toBe(false);
  });

  it('keeps focus on the same row across updates, or moves it to a neighbour when its row goes', () => {
    const t = open();
    t.rows()[2]?.focus();
    t.window.update({ ...CHEST, gold: 0 }); // the gold row goes, the arrows stay focused
    expect((document.activeElement as HTMLElement).dataset['containerItem']).toBe('2');
    t.window.update({ ...CHEST, gold: 0, items: CHEST.items.filter((item) => item.id !== 2) });
    expect((document.activeElement as HTMLElement).dataset['containerItem']).toBe('3');
    t.rows()[1]?.focus(); // the last row
    t.window.update({ ...CHEST, gold: 0, items: CHEST.items.slice(0, 1) });
    expect((document.activeElement as HTMLElement).dataset['containerItem']).toBe('1');
    // Emptied with focus on a row: "Empty", Take All disabled, focus on Close.
    t.window.update({ ...EMPTY, title: 'Supply chest' });
    expect(t.window.empty).toBe(true);
    expect(t.takeAll.disabled).toBe(true);
    expect((document.activeElement as HTMLElement).dataset['action']).toBe('close');
    expect(find('[data-testid="container-empty"]').hidden).toBe(false);
  });

  it('focus on Take All stays there when the contents change; elsewhere it is left alone', () => {
    const t = open();
    t.window.update({ ...CHEST, title: 'Old chest', items: CHEST.items.slice(1) });
    expect(document.activeElement).toBe(t.takeAll);
    expect(find('[data-testid="container-window"] h1').textContent).toBe('Old chest');
    const close = find('[data-screen="container"] [data-action="close"]');
    close.focus();
    t.window.update(CHEST);
    expect(document.activeElement).toBe(close);
  });

  it('says why a take was refused; Close, Back and close() shut it', () => {
    const t = open();
    const status = find('[data-testid="container-status"]');
    expect(status.getAttribute('role')).toBe('status');
    t.window.say('You already carry one of those.');
    expect(status.textContent).toBe('You already carry one of those.');
    find('[data-screen="container"] [data-action="close"]').click();
    expect(t.onClose).toHaveBeenCalledOnce();
    expect(t.onTakeAll).not.toHaveBeenCalled();

    const back = open();
    ui.intent('back', 'keyboard');
    expect(back.onClose).toHaveBeenCalledOnce();
    // Other screen intents fall through to the defaults.
    const other = open();
    ui.intent('tabNext', 'gamepad');
    expect(ui.top?.id).toBe(CONTAINER_SCREEN);
    other.window.close();
    expect(other.onClose).toHaveBeenCalledOnce();
  });

  it('labels rows with their count', () => {
    expect(takeLabel('Oil flask', 1)).toBe('Take Oil flask');
    expect(takeLabel('Oil flask', 3)).toBe('Take Oil flask, 3');
  });
});
