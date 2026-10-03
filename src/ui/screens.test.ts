// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onIntent, UiRoot, uiIntentEvent, UI_INTENT_EVENT, type UiState } from '@ui/screens';
import { find, place, rectFromData } from '@ui/testing/layout';

function btn(id: string, left = 0, top = 0): HTMLButtonElement {
  const b = document.createElement('button');
  b.id = id;
  b.textContent = id;
  return place(b, left, top);
}

function panel(...children: HTMLElement[]): HTMLElement {
  const div = document.createElement('div');
  div.append(...children);
  return div;
}

const active = (): string => (document.activeElement as HTMLElement).id;

describe('UiRoot', () => {
  let container: HTMLElement;
  let ui: UiRoot;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    container = document.createElement('main');
    document.body.append(container);
    ui = new UiRoot(container, { focus: { rectOf: rectFromData } });
  });

  it('mounts a pointer-through HUD layer and a menu layer over the canvas', () => {
    expect(container.querySelector('.vb-ui > .vb-hud')).toBe(ui.hud);
    expect(container.querySelector('.vb-ui > .vb-menus')).toBe(ui.menus);
    expect(document.getElementById('vb-ui-styles')).not.toBeNull();
    expect(ui.top).toBeUndefined();
    expect(ui.capturesInput).toBe(false);
    expect(ui.pausesSim).toBe(false);
    const bare = document.createElement('div');
    document.head.innerHTML = '';
    new UiRoot(bare, { unstyled: true });
    expect(document.getElementById('vb-ui-styles')).toBeNull();
  });

  it('AC-1: back (Esc or gamepad B) pops a capturing modal, restores focus and releases capture at once', () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'canvas';
    canvas.tabIndex = 0;
    container.prepend(canvas);
    canvas.focus();
    const states: UiState[] = [];
    ui.subscribe((state) => states.push(state));

    for (const device of ['keyboard', 'gamepad'] as const) {
      const inventory = ui.push({
        id: 'inventory',
        label: 'Inventory',
        content: panel(btn('sword'), btn('shield', 0, 50)),
        modal: true,
        capturesInput: true,
      });
      expect(ui.top).toBe(inventory);
      expect(ui.capturesInput).toBe(true);
      expect(active()).toBe('sword');
      if (device === 'keyboard') {
        const input = ui.attachInput({ window, now: () => 0 });
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
        input.detach();
      } else {
        expect(ui.intent('back', 'gamepad')).toBe(true);
      }
      // Same call: the screen is gone, capture is released, focus is back on the canvas.
      expect(ui.top).toBeUndefined();
      expect(ui.capturesInput).toBe(false);
      expect(active()).toBe('canvas');
      expect(inventory.element.isConnected).toBe(false);
    }
    expect(states.map((s) => s.capturesInput)).toEqual([true, false, true, false]);
  });

  it('screens below the top are inert; closing restores them and the focus they had', () => {
    const opener = btn('open');
    const menu = ui.push({
      id: 'menu',
      label: 'Menu',
      content: panel(opener, btn('other', 0, 50)),
    });
    expect(active()).toBe('open');
    ui.push({
      id: 'confirm',
      label: 'Confirm',
      content: panel(btn('yes')),
      modal: true,
      pausesSim: true,
    });
    expect(menu.element.inert).toBe(true);
    expect(ui.pausesSim).toBe(true);
    expect(ui.top?.element.getAttribute('aria-modal')).toBe('true');
    expect(ui.screens.map((s) => s.id)).toEqual(['menu', 'confirm']);
    ui.pop();
    expect(menu.element.inert).toBe(false);
    expect(active()).toBe('open');
    expect(ui.pausesSim).toBe(false);
  });

  it('focuses the new top screen when the remembered element is gone', () => {
    ui.push({ id: 'menu', label: 'Menu', content: panel(btn('first'), btn('second', 0, 50)) });
    const second = find('#second');
    second.focus();
    ui.push({ id: 'dialog', label: 'Dialog', content: panel(btn('ok')) });
    second.remove();
    ui.pop();
    expect(active()).toBe('first');
  });

  it('closing a screen below the top keeps focus where it is', () => {
    const lower = ui.push({ id: 'lower', label: 'Lower', content: panel(btn('l')) });
    const onClose = vi.fn();
    ui.push({ id: 'upper', label: 'Upper', content: panel(btn('u')), onClose });
    lower.close();
    lower.close(); // twice is harmless
    expect(ui.screens.map((s) => s.id)).toEqual(['upper']);
    expect(active()).toBe('u');
    ui.clear();
    expect(onClose).toHaveBeenCalledOnce();
    expect(ui.pop()).toBeUndefined();
  });

  it('a non-capturing screen neither takes focus nor intents', () => {
    const outside = btn('outside');
    container.append(outside);
    outside.focus();
    ui.push({ id: 'banner', label: 'Banner', content: panel(btn('b')), capturesInput: false });
    expect(active()).toBe('outside');
    expect(ui.capturesInput).toBe(false);
    expect(ui.intent('down', 'keyboard')).toBe(false);
    expect(ui.intent('down', 'keyboard')).toBe(false);
  });

  it('with no screen open, intents stay with the game', () => {
    expect(ui.intent('confirm', 'gamepad')).toBe(false);
    const input = ui.attachInput({ window, now: () => 0 });
    const event = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    input.poll();
    input.detach();
  });

  it('routes directions to spatial focus, Tab to the trap, confirm to a click', () => {
    const pressed = vi.fn();
    const a = btn('a', 0, 0);
    const b = btn('b', 120, 0);
    const c = btn('c', 0, 50);
    b.addEventListener('click', pressed);
    ui.push({ id: 'menu', label: 'Menu', content: panel(a, b, c) });
    ui.intent('right', 'gamepad');
    expect(active()).toBe('b');
    expect(ui.element.dataset['modality']).toBe('nav');
    ui.intent('confirm', 'gamepad');
    expect(pressed).toHaveBeenCalledOnce();
    ui.intent('next', 'keyboard');
    expect(active()).toBe('c');
    ui.intent('next', 'keyboard');
    expect(active()).toBe('a');
    ui.intent('prev', 'keyboard');
    expect(active()).toBe('c');
    ui.element.dispatchEvent(new Event('pointerdown'));
    expect(ui.element.dataset['modality']).toBe('pointer');
  });

  it('gives the focused component first refusal, then the screen handler', () => {
    const a = btn('a');
    const seen: string[] = [];
    onIntent(a, (intent) => {
      seen.push(`component:${intent}`);
      return intent === 'left';
    });
    ui.push({
      id: 'menu',
      label: 'Menu',
      content: panel(a),
      onIntent: (intent) => {
        seen.push(`screen:${intent}`);
        return intent === 'up';
      },
    });
    ui.intent('left', 'keyboard');
    ui.intent('up', 'keyboard');
    ui.intent('down', 'keyboard');
    expect(seen).toEqual([
      'component:left',
      'component:up',
      'screen:up',
      'component:down',
      'screen:down',
    ]);
  });

  it('onBack can keep a screen open', () => {
    ui.push({ id: 'root', label: 'Root', content: panel(btn('a')), onBack: () => true });
    ui.intent('back', 'gamepad');
    expect(ui.top?.id).toBe('root');
  });

  it('sends tabPrev/tabNext from anywhere on the screen to its first tab strip', () => {
    const strip = document.createElement('div');
    strip.dataset['uiTabs'] = '';
    const got: string[] = [];
    strip.addEventListener(UI_INTENT_EVENT, (event) => {
      got.push((event as CustomEvent<{ intent: string }>).detail.intent);
    });
    ui.push({ id: 'journal', label: 'Journal', content: panel(btn('a'), strip) });
    ui.intent('tabNext', 'gamepad');
    ui.intent('tabPrev', 'keyboard');
    // The secondary action (R, X) is the screen's own: unhandled, it does nothing.
    expect(ui.intent('secondary', 'keyboard')).toBe(true);
    expect(got).toEqual(['tabNext', 'tabPrev']);
    ui.pop();
    ui.push({ id: 'plain', label: 'Plain', content: panel(btn('b')) });
    expect(ui.intent('tabNext', 'gamepad')).toBe(true); // no strip: consumed, nothing happens
  });

  it('dispatches to the screen itself when nothing inside is focused', () => {
    const content = panel();
    const got = vi.fn();
    ui.push({ id: 'empty', label: 'Empty', content });
    ui.top?.element.addEventListener(UI_INTENT_EVENT, got);
    ui.intent('confirm', 'keyboard');
    expect(got).toHaveBeenCalledOnce();
  });

  it('a press on a screen background does not blur the focused element', () => {
    const text = document.createElement('p');
    const a = btn('a');
    ui.push({ id: 'menu', label: 'Menu', content: panel(text, a), modal: true });
    const onBackground = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    text.dispatchEvent(onBackground);
    expect(onBackground.defaultPrevented).toBe(true);
    const onButton = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    a.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(false);
    const onHud = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    ui.hud.dispatchEvent(onHud);
    expect(onHud.defaultPrevented).toBe(false);
  });

  it('unsubscribes listeners and removes intent handlers', () => {
    const listener = vi.fn();
    const off = ui.subscribe(listener);
    off();
    ui.push({ id: 'x', label: 'X', content: panel(btn('a')) });
    expect(listener).not.toHaveBeenCalled();
    const el = document.createElement('div');
    const handler = vi.fn(() => true);
    const remove = onIntent(el, handler);
    remove();
    el.dispatchEvent(uiIntentEvent('up', 'keyboard'));
    expect(handler).not.toHaveBeenCalled();
  });
});
