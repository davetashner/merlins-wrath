// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FrameDataPanel, type FrameDataModel, type FrameDataRowModel } from '@ui/frame-data';

const row = (key: string, patch: Partial<FrameDataRowModel> = {}): FrameDataRowModel => ({
  key,
  label: `Fighter ${key}`,
  move: 'training-dummy-swing',
  phase: 'startup',
  frame: '5/42',
  iframes: false,
  hyperarmor: false,
  hitStop: '',
  reaction: '',
  health: '1000/1000',
  poise: '40/40',
  dps: '0.0',
  ...patch,
});

const model = (rows: FrameDataRowModel[], header = 'tick 5 · 1×'): FrameDataModel => ({
  header,
  rows,
});

const cell = (panel: FrameDataPanel, key: string, col: string): HTMLElement => {
  const el = panel.element.querySelector<HTMLElement>(`tr[data-key="${key}"] [data-col="${col}"]`);
  if (el === null) throw new Error(`no ${col} for ${key}`);
  return el;
};

describe('frame-data overlay (mw-e04.9)', () => {
  it('is hidden until shown and lists one row per fighter with its move, phase and tick', () => {
    const panel = new FrameDataPanel();
    expect(panel.element.dataset['testid']).toBe('frame-data');
    expect(panel.visible).toBe(false);
    panel.visible = true;
    expect(panel.element.hidden).toBe(false);
    panel.update(
      model([row('1', { label: 'Knight', move: '—', phase: 'idle', frame: '' }), row('7')]),
    );
    expect(panel.element.querySelector('[data-part="header"]')?.textContent).toBe('tick 5 · 1×');
    expect(cell(panel, '1', 'label').textContent).toBe('Knight');
    expect(cell(panel, '7', 'move').textContent).toBe('training-dummy-swing');
    expect(cell(panel, '7', 'phase').textContent).toBe('startup');
    expect(cell(panel, '7', 'phase').querySelector('span')?.dataset['phase']).toBe('startup');
    expect(cell(panel, '7', 'frame').textContent).toBe('5/42');
    expect(panel.element.querySelectorAll('th')).toHaveLength(10);
    expect(document.getElementById('vb-frame-data-styles')).not.toBeNull();
    new FrameDataPanel(); // the stylesheet is installed once
    expect(document.querySelectorAll('#vb-frame-data-styles')).toHaveLength(1);
  });

  it('lights the i-frame and hyperarmor badges only while they apply', () => {
    const panel = new FrameDataPanel();
    panel.update(model([row('1', { iframes: true })]));
    const badge = (kind: string) =>
      panel.element.querySelector<HTMLElement>(`[data-kind="${kind}"]`)?.dataset['on'];
    expect([badge('iframes'), badge('armor')]).toEqual(['true', 'false']);
    panel.update(model([row('1', { hyperarmor: true })]));
    expect([badge('iframes'), badge('armor')]).toEqual(['false', 'true']);
  });

  it('shows the hit-stop freezing a fighter, with its tier and ticks left (mw-e04.11)', () => {
    const panel = new FrameDataPanel();
    panel.update(model([row('1', { hitStop: 'heavy 5' })]));
    expect(cell(panel, '1', 'hitStop').textContent).toBe('heavy 5');
    panel.update(model([row('1')]));
    expect(cell(panel, '1', 'hitStop').textContent).toBe('');
  });

  it('writes only what changed, and adds, reorders and removes rows with the model', () => {
    const panel = new FrameDataPanel();
    panel.update(model([row('1'), row('2')]));
    const frame = cell(panel, '1', 'frame');
    let writes = 0;
    new MutationObserver((records) => (writes += records.length)).observe(panel.element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    panel.update(model([row('1'), row('2')]));
    const order = () =>
      [...panel.element.querySelectorAll<HTMLElement>('tbody tr')].map((tr) => tr.dataset['key']);
    return Promise.resolve().then(() => {
      expect(writes).toBe(0);
      panel.update(model([row('2'), row('1', { frame: '6/42' }), row('3')]));
      expect(order()).toEqual(['2', '1', '3']);
      expect(frame.textContent).toBe('6/42');
      panel.update(model([row('3')]));
      expect(order()).toEqual(['3']);
    });
  });
});
