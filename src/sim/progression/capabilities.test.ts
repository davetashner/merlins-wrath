import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../snapshot';
import {
  addCapabilities,
  CapabilitiesComponent,
  capabilitiesOf,
  capabilityGained,
  capabilityLost,
  CapabilityRegistry,
  capabilitySources,
  hasCapability,
  isCapabilitySource,
  UnknownCapabilityError,
  type CapabilityChange,
} from './capabilities';

const IDS = ['verb.climb.ledge', 'verb.climb.rough', 'tool.lockpick', 'spell.ember'];

/** A world with one actor that has a capability set, and every capability event it emits. */
function setup(registry = new CapabilityRegistry(IDS)) {
  const world = new World({ seed: 1 });
  const actor = world.spawn();
  addCapabilities(world, actor);
  const events: [string, CapabilityChange][] = [];
  world.events.on(capabilityGained, (e) => events.push(['gained', e]));
  world.events.on(capabilityLost, (e) => events.push(['lost', e]));
  const flush = () => {
    world.events.flush();
    return events.splice(0);
  };
  return { world, actor, registry, flush };
}

describe('capability registry (mw-e19.2)', () => {
  it('AC-1: a capability granted by two sources is still held, silently, when one revokes', () => {
    const { world, actor, registry, flush } = setup();
    registry.grant(world, actor, 'tool.lockpick', 'class');
    registry.grant(world, actor, 'tool.lockpick', 'equipment:lockpicks');
    flush();

    expect(registry.revoke(world, actor, 'tool.lockpick', 'equipment:lockpicks')).toBe(false);
    expect(hasCapability(world, actor, 'tool.lockpick')).toBe(true);
    expect(capabilitySources(world, actor, 'tool.lockpick')).toEqual(['class']);
    expect(flush()).toEqual([]);

    // The last source going is what loses it: one capability.lost.
    expect(registry.revoke(world, actor, 'tool.lockpick', 'class')).toBe(true);
    expect(hasCapability(world, actor, 'tool.lockpick')).toBe(false);
    expect(capabilitySources(world, actor, 'tool.lockpick')).toEqual([]);
    expect(flush()).toEqual([
      ['lost', { tick: 0, actor, capability: 'tool.lockpick', source: 'class' }],
    ]);
  });

  it('AC-2: granting a capability with zero sources emits exactly one capability.gained', () => {
    const { world, actor, registry, flush } = setup();
    expect(registry.grant(world, actor, 'verb.climb.ledge', 'class')).toBe(true);
    // Another source, and the same source again, add no event.
    expect(registry.grant(world, actor, 'verb.climb.ledge', 'deed:deepworks-fall')).toBe(false);
    expect(registry.grant(world, actor, 'verb.climb.ledge', 'class')).toBe(false);
    expect(flush()).toEqual([
      ['gained', { tick: 0, actor, capability: 'verb.climb.ledge', source: 'class' }],
    ]);
    expect(capabilitySources(world, actor, 'verb.climb.ledge')).toEqual([
      'class',
      'deed:deepworks-fall',
    ]);
  });

  it('AC-3: an undefined capability id throws in dev/test builds', () => {
    const { world, actor, registry, flush } = setup();
    expect(registry.isDefined('spell.ember')).toBe(true);
    expect(registry.isDefined('spell.firebal')).toBe(false);
    expect(() => registry.grant(world, actor, 'spell.firebal', 'book:embers')).toThrow(
      new UnknownCapabilityError('spell.firebal'),
    );
    expect(() => registry.revoke(world, actor, 'spell.firebal', 'book:embers')).toThrow(
      UnknownCapabilityError,
    );
    expect(capabilitiesOf(world, actor)).toEqual([]);
    expect(flush()).toEqual([]);
  });

  it('AC-3: an undefined capability id is a logged no-op in production builds', () => {
    const warned: string[] = [];
    const registry = new CapabilityRegistry(IDS, {
      mode: 'ignore',
      warn: (error) => warned.push(error.message),
    });
    const { world, actor, flush } = setup(registry);
    const before = hashWorld(world);
    expect(registry.grant(world, actor, 'spell.firebal', 'book:embers')).toBe(false);
    expect(registry.revoke(world, actor, 'spell.firebal', 'book:embers')).toBe(false);
    expect(hashWorld(world)).toBe(before);
    expect(flush()).toEqual([]);
    expect(warned).toEqual([
      'capability "spell.firebal" is not declared: add it to src/content/data/capability/',
      'capability "spell.firebal" is not declared: add it to src/content/data/capability/',
    ]);
  });

  it('counts grants per actor and lists capabilities sorted', () => {
    const { world, actor, registry, flush } = setup();
    const other = world.spawn();
    addCapabilities(world, other);
    registry.grant(world, actor, 'verb.climb.rough', 'class');
    registry.grant(world, actor, 'spell.ember', 'book:embers');
    registry.grant(world, other, 'spell.ember', 'learned');
    expect(capabilitiesOf(world, actor)).toEqual(['spell.ember', 'verb.climb.rough']);
    expect(capabilitiesOf(world, other)).toEqual(['spell.ember']);
    expect(flush().map(([kind, e]) => [kind, e.actor, e.capability])).toEqual([
      ['gained', actor, 'verb.climb.rough'],
      ['gained', actor, 'spell.ember'],
      ['gained', other, 'spell.ember'],
    ]);
  });

  it('ignores a revoke from a source that never granted it', () => {
    const { world, actor, registry, flush } = setup();
    expect(registry.revoke(world, actor, 'spell.ember', 'class')).toBe(false);
    registry.grant(world, actor, 'spell.ember', 'learned');
    flush();
    expect(registry.revoke(world, actor, 'spell.ember', 'class')).toBe(false);
    expect(hasCapability(world, actor, 'spell.ember')).toBe(true);
    expect(flush()).toEqual([]);
  });

  it('counts several grants and revokes inside one tick, stamping that tick', () => {
    const { world, actor, registry, flush } = setup();
    world.addSystem({
      name: 'grants',
      run: () => {
        registry.grant(world, actor, 'tool.lockpick', 'tool:lockpicks');
        registry.grant(world, actor, 'tool.lockpick', 'class');
        registry.revoke(world, actor, 'tool.lockpick', 'tool:lockpicks');
      },
    });
    world.step();
    world.step();
    expect(capabilitySources(world, actor, 'tool.lockpick')).toEqual(['class']);
    // The first tick (0) gained it; the second tick's grants and revoke change no count from 0 or to 0.
    expect(flush()).toEqual([
      ['gained', { tick: 0, actor, capability: 'tool.lockpick', source: 'tool:lockpicks' }],
    ]);
  });

  it('keeps grants as plain data that snapshots, restores and hashes carry', () => {
    const { world, actor, registry } = setup();
    const empty = hashWorld(world);
    registry.grant(world, actor, 'verb.climb.ledge', 'class');
    registry.grant(world, actor, 'verb.climb.ledge', 'temporary:haste-3');
    expect(world.get(actor, CapabilitiesComponent)).toEqual({
      sources: { 'verb.climb.ledge': ['class', 'temporary:haste-3'] },
    });
    const granted = hashWorld(world);
    expect(granted).not.toBe(empty);

    const snapshot = world.snapshot();
    const restored = new World({ seed: 1 }).register(CapabilitiesComponent);
    restored.restore(snapshot);
    expect(hashWorld(restored)).toBe(granted);
    expect(capabilitySources(restored, actor, 'verb.climb.ledge')).toEqual([
      'class',
      'temporary:haste-3',
    ]);

    // Revoking every source returns to the hash of the empty set.
    registry.revoke(world, actor, 'verb.climb.ledge', 'class');
    registry.revoke(world, actor, 'verb.climb.ledge', 'temporary:haste-3');
    expect(hashWorld(world)).toBe(empty);
  });

  it('reads an actor without a capability set (or a world without any) as having none', () => {
    const world = new World({ seed: 1 });
    const actor = world.spawn();
    expect(hasCapability(world, actor, 'spell.ember')).toBe(false);
    expect(capabilitiesOf(world, actor)).toEqual([]);
    expect(capabilitiesOf(world, undefined)).toEqual([]);
    addCapabilities(world, world.spawn());
    expect(capabilitySources(world, actor, 'spell.ember')).toEqual([]);
  });

  it('refuses a malformed source and an actor without a capability set', () => {
    const { world, registry } = setup();
    const bare = world.spawn();
    expect(() => registry.grant(world, bare, 'spell.ember', 'class')).toThrow(
      'has no capability set',
    );
    const fresh = new World({ seed: 1 });
    expect(() => registry.grant(fresh, fresh.spawn(), 'spell.ember', 'class')).toThrow(
      'has no capability set',
    );
    expect(() => registry.grant(world, 1, 'spell.ember', 'equipment')).toThrow(
      '"equipment" is not a capability source',
    );
  });

  it('names sources: class, learned, or a kind and a reference', () => {
    const ok = ['class', 'learned', 'book:vesperine-hours', 'trainer:hale', 'schematic:rope-arrow'];
    const more = ['trick:dot', 'deed:brother-horn', 'equipment:lantern', 'tool:lockpicks'];
    for (const source of [...ok, ...more, 'temporary:haste-3']) {
      expect(isCapabilitySource(source), source).toBe(true);
    }
    for (const source of ['', 'Class', 'equipment', 'equipment:', 'xp:100', 'level', 'class:x']) {
      expect(isCapabilitySource(source), source).toBe(false);
    }
  });
});
