import { describe, expect, it, vi } from 'vitest';
import { World } from '../core/world';
import { FALLBACK_RESPAWN, RespawnRules, type RespawnRule } from './rules';

const rule = (over: Partial<RespawnRule> & Pick<RespawnRule, 'id'>): RespawnRule => ({
  region: 'slice',
  priority: 0,
  destination: { scene: 'slice', spawn: 'player-start' },
  mode: 'reload',
  factsToSet: [],
  ...over,
});

const facts = () => new World({ seed: 1 }).facts;

describe('respawn rules (mw-e01.8)', () => {
  it('AC-3: of two matching rules the higher priority wins, whatever their order', () => {
    const low = rule({ id: 'a-low', priority: 1 });
    const high = rule({ id: 'z-high', priority: 5, mode: 'wake-in-place' });
    for (const rules of [
      [low, high],
      [high, low],
    ]) {
      const resolved = new RespawnRules(rules).resolve({ region: 'slice', facts: facts() });
      expect(resolved).toEqual({
        rule: 'z-high',
        mode: 'wake-in-place',
        destination: high.destination,
        factsToSet: [],
      });
    }
  });

  it('AC-3: a priority tie breaks by rule id deterministically (code-unit order)', () => {
    const b = rule({ id: 'slice-b', priority: 2 });
    const a = rule({ id: 'slice-a', priority: 2 });
    const B = rule({ id: 'Slice-c', priority: 2 });
    const table = new RespawnRules([b, a, B]);
    expect(table.order).toEqual(['Slice-c', 'slice-a', 'slice-b']);
    expect(new RespawnRules([a, b]).resolve({ region: 'slice', facts: facts() }).rule).toBe(
      'slice-a',
    );
    expect(new RespawnRules([b, a]).resolve({ region: 'slice', facts: facts() }).rule).toBe(
      'slice-a',
    );
  });

  it('AC-4: with no rule for the region it falls back to reload-last-save and warns', () => {
    const warn = vi.fn();
    const table = new RespawnRules([rule({ id: 'slice-reload' })]);
    expect(table.resolve({ region: 'testbed', facts: facts() }, warn)).toBe(FALLBACK_RESPAWN);
    expect(FALLBACK_RESPAWN).toEqual({
      rule: null,
      mode: 'reload',
      destination: null,
      factsToSet: [],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/no respawn rule matches region "testbed"/);
    // Without a logger the fallback is the same.
    expect(table.resolve({ region: 'testbed', facts: facts() })).toBe(FALLBACK_RESPAWN);
  });

  it('applies only rules whose conditions hold over world facts', () => {
    const world = new World({ seed: 1 });
    const table = new RespawnRules([
      rule({ id: 'fold', priority: 9, conditions: { fact: 'slice.fold-open' } }),
      rule({ id: 'slice-reload', factsToSet: [{ fact: 'slice.deaths-seen', value: true }] }),
    ]);
    const before = table.resolve({ region: 'slice', facts: world.facts });
    expect(before.rule).toBe('slice-reload');
    expect(before.factsToSet).toEqual([{ fact: 'slice.deaths-seen', value: true }]);
    world.facts.set('slice.fold-open', true);
    expect(table.resolve({ region: 'slice', facts: world.facts }).rule).toBe('fold');
  });

  it('refuses a rule id defined twice', () => {
    expect(() => new RespawnRules([rule({ id: 'x' }), rule({ id: 'x', region: 'other' })])).toThrow(
      'respawn rule "x" is defined twice',
    );
  });
});
