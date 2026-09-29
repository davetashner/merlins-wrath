// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { button } from '@ui/components/controls';
import {
  attachTooltip,
  confirmDialog,
  glyphPrompt,
  ToastHost,
  UI_INTENT_GLYPHS,
} from '@ui/components/overlays';
import { UiRoot } from '@ui/screens';
import { place, rectFromData } from '@ui/testing/layout';

let ui: UiRoot;
beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { focus: { rectOf: rectFromData } });
});

describe('tooltip', () => {
  it('shows on focus or hover, hides on blur or leave, and describes its target', () => {
    const holder = document.createElement('div');
    const target = button({ label: 'Lockpick' });
    holder.append(target);
    document.body.append(holder);
    const tip = attachTooltip(target, 'Opens simple locks.');
    expect(target.getAttribute('aria-describedby')).toBe(tip.id);
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.hidden).toBe(true);
    target.focus();
    expect(tip.hidden).toBe(false);
    target.dispatchEvent(new Event('mouseleave'));
    expect(tip.hidden).toBe(false); // still focused
    target.blur();
    expect(tip.hidden).toBe(true);
    target.dispatchEvent(new Event('mouseenter'));
    expect(tip.hidden).toBe(false);
    target.dispatchEvent(new Event('mouseleave'));
    expect(tip.hidden).toBe(true);
  });
});

describe('toasts', () => {
  it('appear in a polite live region and remove themselves after their duration', () => {
    const timers: { callback: () => void; ms: number }[] = [];
    const host = new ToastHost({
      set: (callback, ms) => {
        timers.push({ callback, ms });
      },
    });
    expect(host.element.getAttribute('aria-live')).toBe('polite');
    const a = host.show('Saved.');
    const b = host.show('Low health!', { tone: 'warning', durationMs: 1000 });
    expect(a.dataset['tone']).toBe('info');
    expect(b.dataset['tone']).toBe('warning');
    expect(timers.map((t) => t.ms)).toEqual([4000, 1000]);
    timers[1]?.callback();
    expect([...host.element.children]).toEqual([a]);
  });

  it('uses browser timers by default', () => {
    vi.useFakeTimers();
    const host = new ToastHost();
    host.show('Hi');
    vi.advanceTimersByTime(4000);
    expect(host.element.children).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe('confirmDialog', () => {
  function opener(): HTMLButtonElement {
    const b = place(button({ label: 'Burn', autofocus: true }), 0, 0);
    ui.push({ id: 'menu', label: 'Menu', content: b });
    return b;
  }

  it('opens a modal with focus on cancel; back answers false and restores focus', async () => {
    const b = opener();
    const answer = confirmDialog(ui, { title: 'Burn it?', body: 'Gone for good.' });
    expect(ui.top?.id).toBe('confirm');
    expect(ui.top?.element.getAttribute('aria-modal')).toBe('true');
    expect(ui.pausesSim).toBe(false);
    expect(document.activeElement?.textContent).toBe('Cancel');
    ui.intent('back', 'gamepad');
    await expect(answer).resolves.toBe(false);
    expect(document.activeElement).toBe(b);
  });

  it('confirm answers true; cancel answers false; options style and pause', async () => {
    opener();
    const yes = confirmDialog(ui, {
      title: 'Quit?',
      body: 'Unsaved progress is lost.',
      confirmLabel: 'Quit',
      cancelLabel: 'Stay',
      destructive: true,
      pausesSim: true,
    });
    expect(ui.pausesSim).toBe(true);
    const quit = [...(ui.top?.element.querySelectorAll('button') ?? [])].find(
      (el) => el.textContent === 'Quit',
    );
    expect(quit?.dataset['variant']).toBe('warning');
    quit?.click();
    await expect(yes).resolves.toBe(true);
    const no = confirmDialog(ui, { title: 'Again?', body: '' });
    ui.intent('confirm', 'keyboard'); // cancel has focus
    await expect(no).resolves.toBe(false);
    expect(ui.top?.id).toBe('menu');
  });
});

describe('glyph prompt', () => {
  it('shows a glyph and action and swaps the glyph', () => {
    const prompt = glyphPrompt(UI_INTENT_GLYPHS.keyboard.back, 'Back');
    expect(prompt.element.textContent).toBe('EscBack');
    expect(prompt.element.querySelector('kbd')?.textContent).toBe('Esc');
    prompt.setGlyph(UI_INTENT_GLYPHS.gamepad.back);
    prompt.setGlyph('B');
    expect(prompt.element.querySelector('kbd')?.textContent).toBe('B');
  });

  it('has a glyph for every intent on both devices', () => {
    for (const device of ['keyboard', 'gamepad'] as const) {
      expect(Object.keys(UI_INTENT_GLYPHS[device]).sort()).toEqual([
        'back',
        'confirm',
        'down',
        'left',
        'next',
        'prev',
        'right',
        'tabNext',
        'tabPrev',
        'up',
      ]);
    }
  });
});
