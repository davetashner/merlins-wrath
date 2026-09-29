// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { InteractPrompt, type InteractPromptModel } from '@ui/interact-prompt';

const PULL: InteractPromptModel = {
  glyph: 'E',
  label: 'Pull lever',
  available: true,
  reason: '',
  hold: false,
  progress: 0,
};

const part = (prompt: InteractPrompt, name: string): HTMLElement => {
  const el = prompt.element.querySelector<HTMLElement>(`[data-part="${name}"]`);
  if (el === null) throw new Error(`no ${name}`);
  return el;
};

describe('Interact prompt (mw-e02.5)', () => {
  it('is hidden until something is in focus, then shows the bound key and the action', () => {
    const prompt = new InteractPrompt();
    expect(prompt.element.dataset['testid']).toBe('interact-prompt');
    expect(prompt.element.hidden).toBe(true);
    prompt.update(PULL);
    expect(prompt.element.hidden).toBe(false);
    expect(prompt.element.querySelector('kbd')?.textContent).toBe('E');
    expect(prompt.element.querySelector('.vb-glyph-prompt')?.textContent).toBe('EPull lever');
    expect(prompt.element.dataset['available']).toBe('true');
    expect(part(prompt, 'reason').hidden).toBe(true);
    expect(part(prompt, 'progress').hidden).toBe(true);
    prompt.update({ ...PULL, glyph: 'X' });
    expect(prompt.element.querySelector('kbd')?.textContent).toBe('X');
    prompt.update(null);
    expect(prompt.element.hidden).toBe(true);
  });

  it('AC-4: greys an unavailable affordance and shows the reason', () => {
    const prompt = new InteractPrompt();
    prompt.update({
      ...PULL,
      label: 'Unlock',
      available: false,
      reason: 'Locked — needs Iron Key',
      hold: true,
    });
    expect(prompt.element.dataset['available']).toBe('false');
    expect(part(prompt, 'reason').textContent).toBe('Locked — needs Iron Key');
    expect(part(prompt, 'reason').hidden).toBe(false);
    expect(part(prompt, 'progress').hidden).toBe(true); // nothing to hold for
  });

  it('shows a hold affordance with a filling bar, clamped to 0…1', () => {
    const prompt = new InteractPrompt();
    const fill = () =>
      prompt.element.querySelector<HTMLElement>('.vb-interact-fill')?.style.transform;
    prompt.update({ ...PULL, label: 'Search', hold: true, progress: 0.5 });
    expect(prompt.element.querySelector('.vb-glyph-prompt')?.textContent).toBe('ESearch (hold)');
    expect(part(prompt, 'progress').hidden).toBe(false);
    expect(fill()).toBe('scaleX(0.500)');
    prompt.update({ ...PULL, hold: true, progress: 2 });
    expect(fill()).toBe('scaleX(1.000)');
    prompt.update({ ...PULL, hold: true, progress: -1 });
    expect(fill()).toBe('scaleX(0.000)');
  });
});
