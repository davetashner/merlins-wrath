// The keyring on locks (mw-e17.5): Interact on a locked door uses a fitting key by itself, with no
// menu; single-use keys are used up and reusable ones stay; without a key the lock holds and the
// prompt shows the lock's hint. Driven through the real Interact verb (interaction system + prompt).
import { describe, expect, it } from 'vitest';
import { initialCharacterState } from '../character/controller';
import { CharacterController } from '../character/system';
import { World } from '../core/world';
import { actionButton, actionFrame, actionVector, type ActionFrame } from '../input/action-frame';
import { LOCKPICK_CAPABILITY } from './system';
import {
  addInteractor,
  installInteraction,
  interacted,
  interactionPrompt,
  type Interaction,
} from '../interaction/system';
import { addInventory, InventoryRules, type InventoryItemDef } from '../inventory/inventory';
import { PlayerLook } from '../player/player';
import { registerWorldProperties } from '../properties/components';
import { installStimuli } from '../stimulus/stimulus';
import { LockComponent, type DoorProfile, type LockSpec } from './components';
import { lockOpened, lockUnlocked, type LockOpened, type LockUnlocked } from './events';
import { keyring } from './keys';
import { doorStatus, installMechanisms, makeDoor, refreshAffordances } from './system';

const UP = actionButton(false, false, false);
function frame(interact: boolean): ActionFrame {
  const zero = actionVector(0, 0);
  return actionFrame({
    move: zero,
    look: zero,
    buttons: (action) => (action === 'interact' && interact ? actionButton(true, true, false) : UP),
  });
}
const IDLE = frame(false);
const PRESS = frame(true);

const DOOR: DoorProfile = {
  id: 'wooden-door',
  kind: 'hinged',
  size: { x: 1.2, y: 2.2, z: 0.06 },
  seconds: 1,
  crush: 0,
  manual: true,
  blocks: { light: true, gas: true, sound: true },
  loudness: 50,
};
const HINT = 'Locked. Perhaps someone in town has the key.';
const TOWER_DOOR: LockSpec = {
  id: 'tower-door',
  tier: 2,
  pickTier: 2,
  sealed: false,
  tags: ['warden-tower'],
  hint: HINT,
};

const key = (id: string, data: NonNullable<InventoryItemDef['key']>, questItem = false) => ({
  id,
  category: 'key' as const,
  stackable: false,
  flags: { unique: false, questItem },
  key: data,
});
const ITEMS: InventoryItemDef[] = [
  key('tower-key', { opens: ['tower-door'] }),
  key('brittle-key', { opens: ['tower-door'], singleUse: true }),
  key('sealed-letter-key', { opens: ['tower-door'], singleUse: true }, true),
  key('master-key', { opens: [], opensTag: 'warden-tower' }),
  key('cellar-key', { opens: ['cellar'] }),
  {
    id: 'bread',
    category: 'consumable',
    stackable: true,
    flags: { unique: false, questItem: false },
  },
];

/**
 * A player at (0, 0, 1.5) facing −z towards a door with `lock` at the origin, carrying `items`
 * (and `capabilities`), with interaction and mechanisms installed as the game does.
 */
function setup(
  items: readonly string[],
  lock: LockSpec = TOWER_DOOR,
  capabilities: readonly string[] = [],
) {
  const world = installStimuli(registerWorldProperties(new World<ActionFrame>({ seed: 3 })));
  world.register(CharacterController, PlayerLook);
  installInteraction(world);
  const rules = new InventoryRules(ITEMS);
  const off = installMechanisms(world, { keys: keyring(rules) });
  const sim = world as unknown as World<never>;
  const player = world.spawn();
  world.add(player, CharacterController, initialCharacterState({ x: 0, y: 0, z: 1.5 }));
  world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(world, player, { capabilities });
  addInventory(world, player);
  const gate = world.spawn();
  makeDoor(sim, gate, DOOR, { origin: { x: 0, y: 0, z: 0 }, lock });
  refreshAffordances(sim, gate);
  for (const item of items) rules.add(sim, player, item, 1);
  world.step([IDLE]); // focus on the door
  const interactions: Interaction[] = [];
  const unlocked: LockUnlocked[] = [];
  const opened: LockOpened[] = [];
  world.events.on(interacted, (e) => interactions.push(e));
  world.events.on(lockUnlocked, (e) => unlocked.push(e));
  world.events.on(lockOpened, (e) => opened.push(e));
  const prompt = () => interactionPrompt(sim, player);
  const locked = () => world.get(gate, LockComponent)?.locked;
  const held = (defId: string) => rules.count(sim, player, { defId });
  return {
    world,
    sim,
    rules,
    off,
    player,
    gate,
    interactions,
    unlocked,
    opened,
    prompt,
    locked,
    held,
  };
}

describe('keyring on locks (mw-e17.5)', () => {
  it('AC-1: a key whose opens lists tower-door unlocks it on Interact; lock.opened records the key id', () => {
    const t = setup(['bread', 'cellar-key', 'tower-key']);
    expect(t.prompt()).toMatchObject({ target: t.gate, verb: 'unlock', available: true });
    const tick = t.world.tick;
    t.world.step([PRESS]);
    expect(t.locked()).toBe(false);
    expect(t.unlocked).toEqual([
      { tick, entity: t.gate, lock: 'tower-door', by: 'key', source: t.player, key: 'tower-key' },
    ]);
    expect(t.opened).toEqual([
      {
        tick,
        entity: t.gate,
        lock: 'tower-door',
        keyId: 'tower-key',
        actor: t.player,
        consumed: false,
      },
    ]);
    // One press: unlocked and swinging open, no menu in between.
    expect(t.interactions.map((e) => e.verb)).toEqual(['unlock']);
    expect(doorStatus(t.sim, t.gate)).toBe('opening');
  });

  it('AC-1: a master key opens the lock by its tag', () => {
    const t = setup(['master-key']);
    t.world.step([PRESS]);
    expect(t.locked()).toBe(false);
    expect(t.opened.map((e) => e.keyId)).toEqual(['master-key']);
  });

  it('AC-2: a single-use key is removed from the inventory when it opens its lock', () => {
    const t = setup(['brittle-key']);
    t.world.step([PRESS]);
    expect(t.locked()).toBe(false);
    expect(t.opened).toEqual([expect.objectContaining({ keyId: 'brittle-key', consumed: true })]);
    expect(t.held('brittle-key')).toBe(0);
    // A single-use quest key is used up too: opening its lock is what it is for.
    const quest = setup(['sealed-letter-key']);
    quest.world.step([PRESS]);
    expect(quest.opened.map((e) => e.consumed)).toEqual([true]);
    expect(quest.held('sealed-letter-key')).toBe(0);
  });

  it('AC-2: a reusable key stays on the keyring', () => {
    const t = setup(['tower-key']);
    t.world.step([PRESS]);
    expect(t.locked()).toBe(false);
    expect(t.held('tower-key')).toBe(1);
    // Used directly, a reusable key is never used up.
    const match = t.rules.query(t.sim, t.player, { defId: 'tower-key' })[0];
    if (match === undefined) throw new Error('no key');
    const reusable = { key: 'tower-key', instanceId: match.instanceId, singleUse: false };
    expect(keyring(t.rules).use(t.sim, t.player, reusable)).toBe(false);
    expect(t.held('tower-key')).toBe(1);
  });

  it("AC-3: with no matching key the lock stays locked and the prompt shows the lock's hint", () => {
    const t = setup(['bread', 'cellar-key']);
    expect(t.prompt()).toMatchObject({
      target: t.gate,
      verb: 'unlock',
      label: 'Unlock',
      available: false,
      reason: HINT,
    });
    t.world.step([PRESS]);
    expect(t.locked()).toBe(true);
    expect(doorStatus(t.sim, t.gate)).toBe('locked');
    expect(t.interactions).toEqual([]);
    expect(t.unlocked).toEqual([]);
    expect(t.prompt()).toMatchObject({ available: false, reason: HINT });
    // Picking up the key turns the prompt available; the next press opens it.
    t.rules.add(t.sim, t.player, 'tower-key', 1);
    expect(t.prompt()).toMatchObject({ verb: 'unlock', available: true, reason: '' });
    t.world.step([PRESS]);
    expect(t.locked()).toBe(false);
  });

  it('AC-3: a sealed lock shows its hint even to a key holder, and a thief without a key picks', () => {
    const sealed = setup(['tower-key'], { ...TOWER_DOOR, sealed: true });
    expect(sealed.prompt()).toMatchObject({ verb: 'unlock', available: false, reason: HINT });
    sealed.world.step([PRESS]);
    expect(sealed.locked()).toBe(true);
    // Unlock greyed, Interact moves on to Pick lock for someone with lockpicks.
    const thief = setup([], TOWER_DOOR, [LOCKPICK_CAPABILITY]);
    expect(thief.prompt()).toMatchObject({ verb: 'pick-lock', available: true });
    expect(thief.prompt()?.options[0]).toEqual({
      verb: 'unlock',
      label: 'Unlock',
      available: false,
      reason: HINT,
    });
    thief.world.step([PRESS]);
    expect(thief.locked()).toBe(false);
    expect(thief.unlocked.map((e) => e.by)).toEqual(['pick']);
    expect(thief.opened).toEqual([]);
  });

  it('gates only Unlock on a locked lock, and stops gating once mechanisms are removed', () => {
    const t = setup([]);
    // An Unlock on a lock that is not locked is not the keyring's business.
    const lock = t.world.get(t.gate, LockComponent);
    if (lock === undefined) throw new Error('no lock');
    t.world.set(t.gate, LockComponent, { ...lock, locked: false });
    expect(t.prompt()).toMatchObject({ target: t.gate, verb: 'unlock', available: true });
    t.world.set(t.gate, LockComponent, lock);
    expect(t.prompt()).toMatchObject({ available: false, reason: HINT });
    t.off();
    expect(t.prompt()).toMatchObject({ available: true, reason: '' });
  });
});
