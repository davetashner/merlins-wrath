import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import {
  addCapabilities,
  CapabilitiesComponent,
  capabilitySources,
  hashWorld,
  CLIMB_ICE_CAPABILITY,
  CLIMB_ROUGH_CAPABILITY,
  CLIMB_SHEER_CAPABILITY,
  hasCapability,
  LEDGE_HANG_CAPABILITY,
  UnknownCapabilityError,
  World,
  type LearnRule,
} from '@sim/index';
import {
  createCapabilityRegistry,
  createUnlockBook,
  unknownCapabilityPolicy,
  unlockDefs,
} from './capabilities';
import { createGameSaveRegistry } from './save/sections';

const content = loadGameContent();

afterEach(() => {
  vi.restoreAllMocks();
});

const actorIn = () => {
  const world = new World({ seed: 1 });
  const actor = world.spawn();
  addCapabilities(world, actor);
  return { world, actor };
};

describe('capability registry in the game', () => {
  it('declares every capability the sim checks (climbing and ledges)', () => {
    const registry = createCapabilityRegistry(content);
    const sim = [LEDGE_HANG_CAPABILITY, CLIMB_ROUGH_CAPABILITY, CLIMB_SHEER_CAPABILITY];
    for (const id of [...sim, CLIMB_ICE_CAPABILITY, 'spell.mage-hand']) {
      expect(registry.isDefined(id), id).toBe(true);
    }
  });

  it('AC-3: dev and test builds throw on an undefined capability id', () => {
    const { world, actor } = actorIn();
    const registry = createCapabilityRegistry(content);
    expect(() => registry.grant(world, actor, 'spell.mage-hnd', 'class')).toThrow(
      UnknownCapabilityError,
    );
    expect(unknownCapabilityPolicy(true)).toEqual({ mode: 'throw' });
  });

  it('AC-3: production builds log a warning and ignore it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { world, actor } = actorIn();
    const registry = createCapabilityRegistry(content, false);
    expect(registry.grant(world, actor, 'spell.mage-hnd', 'class')).toBe(false);
    expect(hasCapability(world, actor, 'spell.mage-hnd')).toBe(false);
    expect(warn).toHaveBeenCalledWith(new UnknownCapabilityError('spell.mage-hnd').message);
    expect(registry.grant(world, actor, 'spell.mage-hand', 'class')).toBe(true);
  });
});

describe('capability unlocks in the game (mw-e19.3)', () => {
  const FIRE = ['spell.ember', 'spell.firebolt', 'spell.flame-jet', 'spell.fire-wall'];

  it('builds the learn API from the content and walks the fire chain', ({ task }) => {
    markExercised(task, 'unlock', 'sorcerer-fire');
    const { world, actor } = actorIn();
    const book = createUnlockBook(content, createCapabilityRegistry(content));
    expect(book.learn(world, actor, 'spell.fire-wall', 'book:test').status).toBe('refused');
    for (const id of FIRE)
      expect(book.learn(world, actor, id, 'book:test').status, id).toBe('learned');
    expect(unlockDefs(content).map(({ capability }) => capability)).toEqual(
      expect.arrayContaining(FIRE),
    );
  });

  it('passes requirements and replacements through and runs extra rules', () => {
    const withExtras = {
      ...content,
      all: (type: string) =>
        type === 'unlock'
          ? [
              {
                id: 'test',
                unlocks: [
                  {
                    capability: 'spell.mage-hand',
                    prerequisites: [],
                    channels: ['book'],
                    requirements: { fact: 'test.ready' },
                    replaces: 'verb.climb.ice',
                  },
                ],
              },
            ]
          : content.all(type as 'capability'),
    } as typeof content;
    expect(unlockDefs(withExtras)).toEqual([
      {
        capability: 'spell.mage-hand',
        prerequisites: [],
        channels: ['book'],
        requirements: { fact: 'test.ready' },
        replaces: 'verb.climb.ice',
      },
    ]);
    const never: LearnRule = () => ({ reason: 'rule', rule: 'never', key: 'test.never' });
    const { world, actor } = actorIn();
    const book = createUnlockBook(content, createCapabilityRegistry(content), [never]);
    expect(book.check(world, actor, 'spell.ember', 'book:test').status).toBe('refused');
  });

  it('AC-5: a learned set saved and loaded gives an identical registry state', () => {
    const { world, actor } = actorIn();
    const registry = createCapabilityRegistry(content);
    const book = createUnlockBook(content, registry);
    for (const id of FIRE.slice(0, 3)) book.learn(world, actor, id, 'book:test');
    registry.grant(world, actor, 'verb.climb.ledge', 'class');
    registry.grant(world, actor, 'spell.ember', 'equipment:ember-wand');
    world.step();
    const before = world.get(actor, CapabilitiesComponent);

    const saves = createGameSaveRegistry();
    const bytes = saves.write(world, { build: BUILD, wallClockSavedAt: 0 });
    const loaded = new World({ seed: 99 }).register(CapabilitiesComponent);
    expect(saves.read(loaded, bytes).ok).toBe(true);

    expect(loaded.get(actor, CapabilitiesComponent)).toEqual(before);
    expect(capabilitySources(loaded, actor, 'spell.ember')).toEqual([
      'equipment:ember-wand',
      'learned',
    ]);
    expect(hashWorld(loaded)).toBe(hashWorld(world));
    // The loaded learner carries on where it left off.
    const again = createUnlockBook(content, createCapabilityRegistry(content));
    expect(again.learn(loaded, actor, 'spell.flame-jet', 'book:test').status).toBe('already-known');
    expect(again.learn(loaded, actor, 'spell.fire-wall', 'book:test').status).toBe('learned');
  });
});

const BUILD = { gameVersion: '0.0.0-test', buildSha: 'test', contentHash: 'test' } as const;
