// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { LockMarker, NO_LOCK_MARKER } from './lock-marker';

describe('LockMarker (mw-e02.16)', () => {
  it('starts hidden and shows over the target it is given', () => {
    const marker = new LockMarker();
    expect(marker.element.hidden).toBe(true);
    expect(marker.element.getAttribute('aria-hidden')).toBe('true');
    marker.update({ target: 12, x: 100.4, y: 50.6 });
    expect(marker.element.hidden).toBe(false);
    expect(marker.element.dataset['target']).toBe('12');
    expect(marker.element.style.transform).toBe('translate(100px, 51px)');
  });

  it('follows the target as it moves and hides on release, keeping its last place', () => {
    const marker = new LockMarker();
    marker.update({ target: 12, x: 100, y: 50 });
    marker.update({ target: 14, x: 300, y: 60 });
    expect(marker.element.dataset['target']).toBe('14');
    expect(marker.element.style.transform).toBe('translate(300px, 60px)');
    marker.update(NO_LOCK_MARKER);
    expect(marker.element.hidden).toBe(true);
    expect(marker.element.dataset['target']).toBeUndefined();
    expect(marker.element.style.transform).toBe('translate(300px, 60px)');
  });

  it('writes nothing while the rounded position stays the same', () => {
    const marker = new LockMarker();
    marker.update({ target: 3, x: 10, y: 10 });
    marker.element.style.transform = 'sentinel';
    marker.update({ target: 3, x: 10.2, y: 9.8 });
    expect(marker.element.style.transform).toBe('sentinel');
  });
});
