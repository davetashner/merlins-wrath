// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEATH_FADE_MAX_OPACITY, DeathFade } from './death-fade';

describe('DeathFade (mw-e01.8)', () => {
  it('starts hidden and clear, and ignores the pointer', () => {
    const fade = new DeathFade();
    expect(fade.element.hidden).toBe(true);
    expect(fade.element.getAttribute('aria-hidden')).toBe('true');
    expect(fade.element.style.opacity).toBe('0');
    expect(fade.element.style.pointerEvents).toBe('none');
  });

  it('darkens with the beat’s progress, clamped, up to the maximum', () => {
    const fade = new DeathFade();
    fade.update(0);
    expect(fade.element.hidden).toBe(false);
    expect(fade.element.dataset['opacity']).toBe('0.00');
    fade.update(0.5);
    expect(fade.element.style.opacity).toBe('0.43'); // 0.85 / 2, to the hundredth
    fade.update(2);
    expect(fade.element.dataset['opacity']).toBe(DEATH_FADE_MAX_OPACITY.toFixed(2));
    fade.update(-1);
    expect(fade.element.dataset['opacity']).toBe('0.00');
  });

  it('hides again when the player is alive, and writes nothing for an unchanged frame', () => {
    const fade = new DeathFade();
    fade.update(0.4);
    fade.element.style.opacity = 'tampered';
    fade.update(0.4001);
    expect(fade.element.style.opacity).toBe('tampered');
    fade.update(null);
    expect(fade.element.hidden).toBe(true);
  });
});
