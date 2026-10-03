import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import type { DoorProfile, LockSpec } from '../mechanisms/components';
import { installMechanisms, makeDoor, openDoor, unlockDoor } from '../mechanisms/system';
import { installSignals } from '../signals/runtime';
import { installStimuli } from '../stimulus/stimulus';
import { registerWorldProperties } from '../properties/components';
import { InMemoryColliderSink } from '../physics/static-colliders';
import { navDoorState, worldNavDoors } from './doors';
import { IN_A, IN_B, OPENER, twoRooms } from './fixtures';
import { NavMeshQuery } from './path';

const PROFILE: DoorProfile = {
  id: 'gate',
  kind: 'hinged',
  size: { x: 1.2, y: 2.2, z: 0.06 },
  seconds: 0.1,
  crush: 0,
  manual: true,
  blocks: { light: true, gas: true, sound: true },
  loudness: 0,
};
const LOCK: LockSpec = {
  id: 'gate-lock',
  tier: 1,
  pickTier: null,
  sealed: false,
  tags: [],
  hint: 'Locked.',
};

describe('doors for navigation (mw-e11.4)', () => {
  it('reads mechanism door statuses as open, closed or locked', () => {
    expect(navDoorState(undefined)).toBe('open');
    expect(navDoorState('open')).toBe('open');
    expect(navDoorState('broken')).toBe('open');
    expect(navDoorState('locked')).toBe('locked');
    expect(navDoorState('jammed')).toBe('locked');
    for (const status of ['closed', 'opening', 'closing', 'blocked'] as const) {
      expect(navDoorState(status)).toBe('closed');
    }
  });

  it('AC-2: a real locked door blocks the path; unlocked and opened, the path is found', () => {
    const world = installSignals(
      installStimuli(registerWorldProperties(new World<never>({ seed: 3 }))),
    );
    installMechanisms(world, {
      colliders: new InMemoryColliderSink(),
      occluders: new InMemoryColliderSink(),
    });
    const entity = world.spawn();
    makeDoor(world, entity, PROFILE, { origin: { x: 7, y: 0, z: 3 }, yaw: 90, lock: LOCK });
    const doors = worldNavDoors(world, new Map([['gate', entity]]));
    const query = new NavMeshQuery(twoRooms());
    const find = () => query.findPath({ start: IN_A, goal: IN_B, agent: OPENER, doors });
    expect(doors('gate')).toBe('locked');
    expect(find().status).toBe('unreachable');
    expect(unlockDoor(world, entity, { by: 'key' })).toBe(true);
    expect(doors('gate')).toBe('closed');
    openDoor(world, entity);
    for (let n = 0; n < 30; n++) world.step();
    expect(doors('gate')).toBe('open');
    expect(find().status).toBe('found');
    // Unknown spawns and doors that are gone count as open.
    expect(doors('elsewhere')).toBe('open');
    world.destroy(entity);
    world.step();
    expect(doors('gate')).toBe('open');
  });
});
