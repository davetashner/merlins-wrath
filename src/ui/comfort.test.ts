// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  clampTextScale,
  reducedMotion,
  setMotionPreference,
  setTextScale,
  textScale,
} from '@ui/comfort';

describe('comfort hooks', () => {
  it('clamps the text scale to 0.8–2.0', () => {
    expect(clampTextScale(0.5)).toBe(0.8);
    expect(clampTextScale(3)).toBe(2);
    expect(clampTextScale(1.25)).toBe(1.25);
    expect(clampTextScale(Number.NaN)).toBe(1);
  });

  it('sets and reads --ui-text-scale on the root', () => {
    const root = document.createElement('div');
    expect(textScale(root)).toBe(1);
    expect(setTextScale(root, 2)).toBe(2);
    expect(root.style.getPropertyValue('--ui-text-scale')).toBe('2');
    expect(textScale(root)).toBe(2);
    expect(setTextScale(root, 9)).toBe(2);
  });

  it('reduced motion follows the root preference, else the OS', () => {
    const root = document.createElement('div');
    const os = (matches: boolean) => () => ({ matches });
    expect(reducedMotion(root)).toBe(false);
    expect(reducedMotion(root, os(true))).toBe(true);
    setMotionPreference(root, 'reduce');
    expect(root.dataset['motion']).toBe('reduce');
    expect(reducedMotion(root, os(false))).toBe(true);
    setMotionPreference(root, 'full');
    expect(reducedMotion(root, os(true))).toBe(false);
    setMotionPreference(root, 'system');
    expect(root.dataset['motion']).toBeUndefined();
    expect(reducedMotion(root, os(true))).toBe(true);
  });
});
