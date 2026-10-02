import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  addCapabilities,
  CLIMB_ICE_CAPABILITY,
  CLIMB_ROUGH_CAPABILITY,
  CLIMB_SHEER_CAPABILITY,
  hasCapability,
  LEDGE_HANG_CAPABILITY,
  UnknownCapabilityError,
  World,
} from '@sim/index';
import { createCapabilityRegistry, unknownCapabilityPolicy } from './capabilities';

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
