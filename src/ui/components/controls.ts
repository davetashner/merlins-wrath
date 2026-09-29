// Menu controls (mw-e00.23): button, toggle, slider and select. Each is a real focusable element with
// the matching ARIA role, reacts to pointer clicks, and to UI intents while focused (see
// screens.ts: `ui-intent` events reach the focused element first). Values change only through the
// callbacks: the kit never reaches into sim or settings state itself.

import { onIntent } from '../screens';
import { h } from './dom';

export interface ButtonOptions {
  readonly label: string;
  readonly onPress?: () => void;
  /** `warning` draws the ember border (destructive actions). */
  readonly variant?: 'default' | 'warning';
  readonly disabled?: boolean;
  /** Focused when its screen opens. */
  readonly autofocus?: boolean;
}

/** A push button (confirm or click presses it). */
export function button(options: ButtonOptions): HTMLButtonElement {
  const el = h('button', {
    className: 'vb-button',
    text: options.label,
    attrs: { type: 'button' },
    data: { uiComponent: 'button' },
  });
  if (options.variant === 'warning') el.dataset['variant'] = 'warning';
  if (options.disabled === true) el.disabled = true;
  if (options.autofocus === true) el.dataset['autofocus'] = '';
  const { onPress } = options;
  if (onPress) el.addEventListener('click', onPress);
  return el;
}

export interface ToggleOptions {
  readonly label: string;
  readonly checked?: boolean;
  readonly onChange?: (checked: boolean) => void;
}

export interface Toggle {
  readonly element: HTMLButtonElement;
  checked: boolean;
}

/** An on/off switch (role switch); confirm or click flips it. */
export function toggle(options: ToggleOptions): Toggle {
  const element = h(
    'button',
    {
      className: 'vb-toggle',
      attrs: { type: 'button', role: 'switch' },
      data: { uiComponent: 'toggle' },
    },
    h('span', { text: options.label }),
    h('span', { className: 'vb-toggle-track', attrs: { 'aria-hidden': 'true' } }),
  );
  let checked = options.checked ?? false;
  const render = (): void => {
    element.setAttribute('aria-checked', String(checked));
  };
  render();
  element.addEventListener('click', () => {
    checked = !checked;
    render();
    options.onChange?.(checked);
  });
  return {
    element,
    get checked() {
      return checked;
    },
    set checked(value: boolean) {
      checked = value;
      render();
    },
  };
}

export interface SliderOptions {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** Text read out for a value (default: the number). */
  readonly format?: (value: number) => string;
  readonly onChange?: (value: number) => void;
}

export interface Slider {
  readonly element: HTMLElement;
  value: number;
}

/** A horizontal slider (role slider); left/right step it while focused. */
export function slider(options: SliderOptions): Slider {
  const { min, max, step } = options;
  const format = options.format ?? String;
  const fill = h('span', { className: 'vb-slider-fill' });
  const valueText = h('span', { className: 'vb-slider-value' });
  const element = h(
    'div',
    {
      className: 'vb-slider',
      attrs: {
        role: 'slider',
        tabindex: '0',
        'aria-label': options.label,
        'aria-valuemin': String(min),
        'aria-valuemax': String(max),
      },
      data: { uiComponent: 'slider' },
    },
    h('span', { text: options.label }),
    h('span', { className: 'vb-slider-track', attrs: { 'aria-hidden': 'true' } }, fill),
    valueText,
  );
  const clamp = (v: number): number => Math.min(max, Math.max(min, v));
  let value = clamp(options.value);
  const render = (): void => {
    element.setAttribute('aria-valuenow', String(value));
    element.setAttribute('aria-valuetext', format(value));
    valueText.textContent = format(value);
    fill.style.width = `${String(((value - min) / (max - min)) * 100)}%`;
  };
  const set = (next: number): void => {
    const clamped = clamp(next);
    if (clamped === value) return;
    value = clamped;
    render();
    options.onChange?.(value);
  };
  render();
  onIntent(element, (intent) => {
    if (intent === 'left') set(value - step);
    else if (intent === 'right') set(value + step);
    else return false;
    return true;
  });
  return {
    element,
    get value() {
      return value;
    },
    set value(next: number) {
      value = clamp(next);
      render();
    },
  };
}

export interface SelectOptions<T extends string> {
  readonly label: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange?: (value: T) => void;
}

export interface Select<T extends string> {
  readonly element: HTMLElement;
  value: T;
}

/**
 * A game-style option picker: left/right (or a click) cycle through the options, wrapping. It is a
 * spinbutton to assistive tech, announcing the option's label as its value text.
 */
export function select<T extends string>(options: SelectOptions<T>): Select<T> {
  const choices = options.options;
  if (choices.length === 0) throw new RangeError('select needs at least one option');
  const valueEl = h('span', { className: 'vb-select-value' });
  const element = h(
    'div',
    {
      className: 'vb-select',
      attrs: {
        role: 'spinbutton',
        tabindex: '0',
        'aria-label': options.label,
        'aria-valuemin': '0',
        'aria-valuemax': String(choices.length - 1),
      },
      data: { uiComponent: 'select' },
    },
    h('span', { text: options.label }),
    h('span', { text: '‹', attrs: { 'aria-hidden': 'true' } }),
    valueEl,
    h('span', { text: '›', attrs: { 'aria-hidden': 'true' } }),
  );
  let index = Math.max(
    0,
    choices.findIndex((choice) => choice.value === options.value),
  );
  const current = (): { value: T; label: string } => choices[index] as { value: T; label: string };
  const render = (): void => {
    element.setAttribute('aria-valuenow', String(index));
    element.setAttribute('aria-valuetext', current().label);
    valueEl.textContent = current().label;
  };
  const shift = (delta: number): void => {
    index = (index + delta + choices.length) % choices.length;
    render();
    options.onChange?.(current().value);
  };
  render();
  element.addEventListener('click', () => {
    shift(1);
  });
  onIntent(element, (intent) => {
    if (intent === 'left') shift(-1);
    else if (intent === 'right' || intent === 'confirm') shift(1);
    else return false;
    return true;
  });
  return {
    element,
    get value() {
      return current().value;
    },
    set value(next: T) {
      const found = choices.findIndex((choice) => choice.value === next);
      if (found === -1) throw new RangeError(`no option ${next}`);
      index = found;
      render();
    },
  };
}
