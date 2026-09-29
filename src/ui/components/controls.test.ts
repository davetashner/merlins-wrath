// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { button, select, slider, toggle } from '@ui/components/controls';
import { UiRoot } from '@ui/screens';
import { rectFromData } from '@ui/testing/layout';

let ui: UiRoot;

/** Opens a screen with `el` in it and focuses it. */
function mount(el: HTMLElement): void {
  ui.push({ id: 'test', label: 'Test', content: el });
  el.focus();
}

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { focus: { rectOf: rectFromData } });
});

describe('button', () => {
  it('is a real button that confirm and click press', () => {
    const onPress = vi.fn();
    const b = button({ label: 'Save', onPress, autofocus: true });
    expect(b.type).toBe('button');
    expect(b.dataset['autofocus']).toBe('');
    mount(b);
    ui.intent('confirm', 'gamepad');
    b.click();
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('supports the warning variant and disabled state', () => {
    const b = button({ label: 'Delete', variant: 'warning', disabled: true });
    expect(b.dataset['variant']).toBe('warning');
    expect(b.disabled).toBe(true);
    expect(button({ label: 'Plain' }).dataset['variant']).toBeUndefined();
  });
});

describe('toggle', () => {
  it('flips on confirm or click and reports it', () => {
    const onChange = vi.fn();
    const t = toggle({ label: 'Subtitles', onChange });
    expect(t.element.getAttribute('role')).toBe('switch');
    expect(t.checked).toBe(false);
    mount(t.element);
    ui.intent('confirm', 'keyboard');
    expect(t.checked).toBe(true);
    expect(t.element.getAttribute('aria-checked')).toBe('true');
    t.element.click();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    t.checked = true;
    expect(t.element.getAttribute('aria-checked')).toBe('true');
    expect(toggle({ label: 'x', checked: true }).checked).toBe(true);
  });
});

describe('slider', () => {
  it('steps with left/right while focused, clamped to its range', () => {
    const onChange = vi.fn();
    const s = slider({ label: 'Volume', min: 0, max: 10, step: 5, value: 5, onChange });
    mount(s.element);
    ui.intent('right', 'gamepad');
    expect(s.value).toBe(10);
    ui.intent('right', 'gamepad'); // at max: no change, no report
    ui.intent('left', 'keyboard');
    ui.intent('left', 'keyboard');
    ui.intent('left', 'keyboard');
    expect(s.value).toBe(0);
    expect(onChange.mock.calls).toEqual([[10], [5], [0]]);
    expect(s.element.getAttribute('aria-valuenow')).toBe('0');
    expect(s.element.getAttribute('aria-valuetext')).toBe('0');
    s.value = 99;
    expect(s.value).toBe(10);
    expect(document.activeElement).toBe(s.element);
    ui.intent('up', 'keyboard'); // not a slider intent: falls through to focus movement
    expect(document.activeElement).toBe(s.element);
  });

  it('formats its value text', () => {
    const s = slider({
      label: 'V',
      min: 0,
      max: 100,
      step: 10,
      value: 50,
      format: (v) => `${String(v)}%`,
    });
    expect(s.element.getAttribute('aria-valuetext')).toBe('50%');
    expect(s.element.textContent).toContain('50%');
  });
});

describe('select', () => {
  const options = [
    { value: 'story', label: 'Story' },
    { value: 'normal', label: 'Normal' },
    { value: 'hard', label: 'Hard' },
  ] as const;

  it('cycles with left/right/confirm/click, wrapping, and reports the value', () => {
    const onChange = vi.fn();
    const s = select({ label: 'Difficulty', options, value: 'normal', onChange });
    mount(s.element);
    ui.intent('right', 'gamepad');
    expect(s.value).toBe('hard');
    ui.intent('confirm', 'gamepad');
    expect(s.value).toBe('story');
    ui.intent('left', 'keyboard');
    expect(s.value).toBe('hard');
    s.element.click();
    expect(onChange.mock.calls.flat()).toEqual(['hard', 'story', 'hard', 'story']);
    expect(s.element.getAttribute('aria-valuetext')).toBe('Story');
    ui.intent('down', 'keyboard'); // not consumed
    s.value = 'normal';
    expect(s.element.getAttribute('aria-valuenow')).toBe('1');
    expect(() => {
      s.value = 'nightmare' as 'hard';
    }).toThrow(RangeError);
  });

  it('starts on the first option when the value is unknown; needs options', () => {
    expect(select({ label: 'D', options, value: 'x' as 'hard' }).value).toBe('story');
    expect(() => select({ label: 'D', options: [], value: '' })).toThrow(RangeError);
  });
});
