// @vitest-environment happy-dom
// Pickup toasts (mw-e18.4): at most four, merged by definition with a count, the oldest ordinary
// toast making way, discoveries with their flavour line staying their full time, waiting pickups,
// expiry on the clock passed in, and the HUD scale.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DISCOVERY_TOAST_MS,
  MAX_PICKUP_TOASTS,
  PICKUP_TOAST_MS,
  PickupToasts,
  pickupText,
  type Pickup,
} from '@ui/pickup-toasts';

beforeEach(() => {
  document.body.innerHTML = '';
});

const pickup = (key: string, count = 1, over: Partial<Pickup> = {}): Pickup => ({
  key,
  name: `${key.charAt(0).toUpperCase()}${key.slice(1)}`,
  icon: 'misc',
  count,
  ...over,
});
const CHARM = pickup('charm', 1, {
  name: 'Lodestone charm',
  icon: 'artifact',
  discovery: 'It points north, mostly.',
});

function corner() {
  const toasts = new PickupToasts();
  document.body.append(toasts.element);
  const texts = () =>
    [...toasts.element.querySelectorAll('.vb-pickup-name')].map((el) => el.textContent);
  return { toasts, texts };
}

describe('pickup toasts (mw-e18.4)', () => {
  it('AC-2: six pickups within a second show at most four toasts, duplicates merged with a count', () => {
    const { toasts, texts } = corner();
    const six = ['draught', 'arrow', 'draught', 'flask', 'key', 'arrow'];
    six.forEach((key, i) => {
      toasts.push(pickup(key, key === 'arrow' ? 5 : 1), i * 150); // 0–750 ms
    });
    expect(toasts.visible.length).toBeLessThanOrEqual(MAX_PICKUP_TOASTS);
    expect(texts()).toEqual(['Draught ×2', 'Arrow ×10', 'Flask', 'Key']);
    expect(toasts.visible.map((t) => t.count)).toEqual([2, 10, 1, 1]);
    // A fifth definition: the toast due to go first (the draughts, last merged at 300 ms) makes way.
    toasts.push(pickup('rope'), 900);
    expect(texts()).toEqual(['Arrow ×10', 'Flask', 'Key', 'Rope']);
    expect(toasts.element.querySelectorAll('.vb-pickup')).toHaveLength(4);
  });

  it('a merge restarts the toast’s time; toasts go when their time is up', () => {
    const { toasts, texts } = corner();
    toasts.push(pickup('draught'), 0);
    toasts.push(pickup('flask'), 1000);
    toasts.push(pickup('draught'), 2000);
    expect(toasts.visible.map((t) => t.until)).toEqual([
      2000 + PICKUP_TOAST_MS,
      1000 + PICKUP_TOAST_MS,
    ]);
    toasts.frame(1000 + PICKUP_TOAST_MS);
    expect(texts()).toEqual(['Draught ×2']);
    toasts.frame(2000 + PICKUP_TOAST_MS);
    expect(texts()).toEqual([]);
  });

  it('AC-3: a unique artifact shows a discovery toast with its flavour line for at least 4 s', () => {
    const { toasts } = corner();
    toasts.push(CHARM, 10_000);
    const card = toasts.element.querySelector<HTMLElement>('[data-kind="discovery"]');
    expect(card?.querySelector('.vb-pickup-heading')?.textContent).toBe('Discovery');
    expect(card?.querySelector('.vb-pickup-name')?.textContent).toBe('Lodestone charm');
    expect(card?.querySelector('[data-part="flavour"]')?.textContent).toBe(
      'It points north, mostly.',
    );
    expect(DISCOVERY_TOAST_MS).toBeGreaterThanOrEqual(4000);
    // Still there at 4 s, even with the corner flooded by ordinary pickups.
    for (let i = 0; i < 8; i++) toasts.push(pickup(`thing-${String(i)}`), 10_000 + 100 * i);
    toasts.frame(14_000);
    expect(toasts.visible.filter((t) => t.discovery).map((t) => t.text)).toEqual([
      'Lodestone charm',
    ]);
    toasts.frame(10_000 + DISCOVERY_TOAST_MS);
    expect(toasts.visible.some((t) => t.discovery)).toBe(false);
  });

  it('a pickup with no room (four discoveries showing) waits, merging with its kind, then shows', () => {
    const { toasts, texts } = corner();
    for (let i = 0; i < 4; i++) toasts.push({ ...CHARM, key: `charm-${String(i)}` }, 0);
    toasts.push(pickup('arrow', 3), 100);
    toasts.push(pickup('arrow', 2), 200);
    toasts.push({ ...CHARM, key: 'charm-4' }, 300);
    expect(toasts.waiting).toBe(2);
    expect(toasts.visible).toHaveLength(4);
    toasts.frame(DISCOVERY_TOAST_MS);
    expect(toasts.waiting).toBe(0);
    expect(texts()).toEqual(['Arrow ×5', 'Lodestone charm']);
    // A discovery with no flavour text shows just its name.
    toasts.clear();
    toasts.push({ ...CHARM, discovery: '' }, 0);
    expect(toasts.element.querySelector('[data-part="flavour"]')).toBeNull();
    expect(toasts.element.querySelector('.vb-pickup-heading')?.textContent).toBe('Discovery');
  });

  it('words gold as an amount, sits in a polite live region and follows the HUD scale', () => {
    const toasts = new PickupToasts({ scale: 1.5 });
    expect(toasts.element.getAttribute('role')).toBe('status');
    expect(toasts.element.getAttribute('aria-live')).toBe('polite');
    expect(toasts.element.style.fontSize).toBe('1.5em');
    toasts.setScale(2);
    expect(toasts.element.style.fontSize).toBe('2em');
    expect(new PickupToasts().element.style.fontSize).toBe('1em');
    const gold = pickup('gold', 12, { gold: true });
    expect(pickupText(gold, 12)).toBe('+12 gold');
    expect(pickupText(pickup('flask'), 1)).toBe('Flask');
    expect(pickupText(pickup('flask'), 3)).toBe('Flask ×3');
    toasts.push(gold, 0);
    toasts.push(pickup('gold', 8, { gold: true }), 10);
    expect(toasts.visible.map((t) => t.text)).toEqual(['+20 gold']);
    toasts.clear();
    expect(toasts.visible).toEqual([]);
  });
});
