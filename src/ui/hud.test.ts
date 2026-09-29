// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SLOT,
  HudBinding,
  IconSlot,
  Meter,
  VitalsHud,
  WriteCache,
  type VitalsViewModel,
} from '@ui/hud';

/** Counts DOM mutations under `el` made by `run` (attributes, text and children). */
async function mutations(el: HTMLElement, run: () => void): Promise<number> {
  let count = 0;
  const observer = new MutationObserver((records) => {
    count += records.length;
  });
  observer.observe(el, { subtree: true, attributes: true, childList: true, characterData: true });
  run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  count += observer.takeRecords().length;
  observer.disconnect();
  return count;
}

/** A stand-in for a sim snapshot: the binding derives the vitals from it. */
interface FakeSnapshot {
  readonly tick: number;
  readonly hp: number;
}

const select = (s: FakeSnapshot): VitalsViewModel => ({
  health: { value: s.hp, max: 100 },
  stamina: { value: 50, max: 100 },
  slots: [{ label: 'Healing draught', glyph: '♥', count: 3 }],
});

describe('HUD binding', () => {
  it('AC-5: an unchanged snapshot causes zero DOM writes; a health change updates the bar in the same frame', async () => {
    const hud = new VitalsHud({ slots: 4 });
    document.body.append(hud.element);
    const binding = new HudBinding(select, [hud]);
    let snapshot: FakeSnapshot = { tick: 1, hp: 100 };
    binding.frame(snapshot, 0);
    const fill = hud.health.element.querySelector<HTMLElement>('.vb-meter-fill');
    expect(fill?.style.transform).toBe('scaleX(1.0000)');

    // Frames with the same snapshot: nothing is written.
    expect(
      await mutations(hud.element, () => {
        for (let frame = 1; frame <= 10; frame++) binding.frame(snapshot, frame * 16);
      }),
    ).toBe(0);
    // A new snapshot with equal values: derived again, still nothing written.
    snapshot = { tick: 2, hp: 100 };
    expect(
      await mutations(hud.element, () => {
        binding.frame(snapshot, 200);
      }),
    ).toBe(0);

    // Health drops: the very next frame writes the new fill.
    snapshot = { tick: 3, hp: 60 };
    const writes = await mutations(hud.element, () => {
      binding.frame(snapshot, 216);
    });
    expect(writes).toBeGreaterThan(0);
    expect(fill?.style.transform).toBe('scaleX(0.6000)');
    expect(hud.health.element.getAttribute('aria-valuenow')).toBe('60');
    expect(binding.model?.health.value).toBe(60);
  });

  it('writes only through the cache when a value changes', () => {
    const cache = new WriteCache();
    const written: string[] = [];
    const write = (v: string): void => {
      written.push(v);
    };
    expect(cache.set('a', '1', write)).toBe(true);
    expect(cache.set('a', '1', write)).toBe(false);
    expect(cache.set('b', '1', write)).toBe(true);
    expect(cache.set('a', '2', write)).toBe(true);
    expect(written).toEqual(['1', '1', '2']);
  });
});

describe('Meter delayed-damage segment', () => {
  const trail = (m: Meter): string | undefined =>
    m.element.querySelector<HTMLElement>('.vb-meter-trail')?.style.transform;

  it('holds at the old value, then drains to the new one', () => {
    const m = new Meter({ label: 'Health', trailHoldMs: 500, trailDrainPerSec: 0.5 });
    m.update({ value: 100, max: 100 }, 0);
    m.update({ value: 60, max: 100 }, 1000);
    expect(m.trail).toBe(1);
    m.update({ value: 60, max: 100 }, 1400); // still holding
    expect(m.trail).toBe(1);
    m.update({ value: 60, max: 100 }, 1600); // 100 ms into the drain: −0.05
    expect(m.trail).toBeCloseTo(0.95);
    m.update({ value: 60, max: 100 }, 5000);
    expect(m.trail).toBe(0.6);
    expect(trail(m)).toBe('scaleX(0.6000)');
  });

  it('a second hit while draining keeps the trail where it was; healing never trails', () => {
    const m = new Meter({ label: 'Health', trailHoldMs: 100, trailDrainPerSec: 1 });
    m.update({ value: 100, max: 100 }, 0);
    m.update({ value: 50, max: 100 }, 10);
    m.update({ value: 50, max: 100 }, 210); // drained 0.1 → 0.9
    m.update({ value: 20, max: 100 }, 220);
    expect(m.trail).toBeCloseTo(0.9);
    m.update({ value: 95, max: 100 }, 230);
    expect(m.trail).toBe(0.95);
  });

  it('snaps under reduced motion and clamps odd values', () => {
    const m = new Meter({ label: 'Stamina', kind: 'stamina', reducedMotion: () => true });
    expect(m.element.dataset['kind']).toBe('stamina');
    m.update({ value: 100, max: 100 }, 0);
    m.update({ value: 30, max: 100 }, 16);
    expect(m.trail).toBe(0.3);
    m.update({ value: 150, max: 100 }, 32);
    expect(m.trail).toBe(1);
    m.update({ value: 5, max: 0 }, 48);
    expect(m.trail).toBe(0);
    expect(new Meter({ label: 'x' }).element.dataset['kind']).toBe('health');
  });
});

describe('IconSlot', () => {
  it('shows glyph, count and cooldown and names itself', () => {
    const slot = new IconSlot({ key: '1' });
    slot.update({ label: 'Fire bolt', glyph: '✦', count: 2, cooldown: 0.5 });
    expect(slot.element.getAttribute('aria-label')).toBe('Fire bolt × 2 cooling down (1)');
    expect(slot.element.textContent).toBe('✦2');
    expect(slot.element.querySelector<HTMLElement>('.vb-slot-cooldown')?.style.transform).toBe(
      'scaleY(0.500)',
    );
    slot.update(EMPTY_SLOT);
    expect(slot.element.getAttribute('aria-label')).toBe('Empty slot (1)');
    const bare = new IconSlot();
    bare.update({ label: 'Rope', glyph: 'R', cooldown: 7 });
    expect(bare.element.getAttribute('aria-label')).toBe('Rope cooling down');
  });

  it('fills missing slots with empty ones', () => {
    const hud = new VitalsHud({ slots: 2, reducedMotion: () => false });
    hud.update({ health: { value: 1, max: 1 }, stamina: { value: 1, max: 1 }, slots: [] }, 0);
    expect(hud.slots.map((s) => s.element.getAttribute('aria-label'))).toEqual([
      'Empty slot (1)',
      'Empty slot (2)',
    ]);
  });
});
