// Tabs (mw-e00.23): a tab strip over panels. ui.tabPrev/tabNext (Q/E, PageUp/PageDown, LB/RB)
// switch tabs from anywhere on the screen, wrapping; with focus on the strip, left/right switch too.
// The strip uses a roving tabindex (only the selected tab is focusable), per the ARIA tabs pattern.

import { onIntent } from '../screens';
import { h, uid } from './dom';

export interface TabSpec {
  readonly id: string;
  readonly label: string;
  readonly panel: HTMLElement;
}

export interface TabsOptions {
  /** Accessible name of the tab strip. */
  readonly label: string;
  readonly tabs: readonly TabSpec[];
  /** Initially selected tab id (default: the first). */
  readonly selected?: string;
  readonly onChange?: (id: string) => void;
}

export interface Tabs {
  readonly element: HTMLElement;
  readonly selected: string;
  select(id: string): void;
}

export function tabs(options: TabsOptions): Tabs {
  const specs = options.tabs;
  if (specs.length === 0) throw new RangeError('tabs needs at least one tab');
  const prefix = uid('vb-tabs');
  const strip = h('div', { attrs: { role: 'tablist', 'aria-label': options.label } });
  const element = h(
    'div',
    { className: 'vb-tabs', data: { uiComponent: 'tabs', uiTabs: '' } },
    strip,
  );
  const entries = specs.map((spec) => {
    const tab = h('button', {
      className: 'vb-tab',
      text: spec.label,
      attrs: {
        type: 'button',
        role: 'tab',
        id: `${prefix}-tab-${spec.id}`,
        'aria-controls': `${prefix}-panel-${spec.id}`,
      },
      data: { tab: spec.id },
    });
    spec.panel.classList.add('vb-tabpanel');
    spec.panel.id = `${prefix}-panel-${spec.id}`;
    spec.panel.setAttribute('role', 'tabpanel');
    spec.panel.setAttribute('aria-labelledby', tab.id);
    strip.append(tab);
    element.append(spec.panel);
    return { spec, tab };
  });
  let index = Math.max(
    0,
    specs.findIndex((spec) => spec.id === options.selected),
  );
  let selectedId = '';
  const render = (): void => {
    entries.forEach(({ spec, tab }, i) => {
      const on = i === index;
      if (on) selectedId = spec.id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      spec.panel.hidden = !on;
    });
  };
  const choose = (next: number, focus: boolean): void => {
    const changed = next !== index;
    index = next;
    render();
    if (focus) {
      entries.forEach(({ tab }, i) => {
        if (i === index) tab.focus();
      });
    }
    if (changed) options.onChange?.(selectedId);
  };
  const shift = (delta: number, focus: boolean): void => {
    choose((index + delta + specs.length) % specs.length, focus);
  };
  entries.forEach(({ tab }, i) => {
    tab.addEventListener('click', () => {
      choose(i, true);
    });
  });
  render();
  onIntent(element, (intent, event) => {
    const onStrip = strip.contains(event.target as Node);
    if (intent === 'tabPrev') shift(-1, onStrip);
    else if (intent === 'tabNext') shift(1, onStrip);
    else if (onStrip && intent === 'left') shift(-1, true);
    else if (onStrip && intent === 'right') shift(1, true);
    else return false;
    return true;
  });
  return {
    element,
    get selected() {
      return selectedId;
    },
    select(id: string) {
      const found = specs.findIndex((spec) => spec.id === id);
      if (found === -1) throw new RangeError(`no tab ${id}`);
      choose(found, false);
    },
  };
}
