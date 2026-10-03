// The creatures' autosave veto (mw-e01.7): it objects while a living creature is in Combat.
import {
  BrainComponent,
  DAMAGE_COMPONENTS,
  giveCombatant,
  HealthComponent,
  World,
  type Brain,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { COMBAT_VETO_ID, COMBAT_VETO_REASON, combatVeto, creaturesInCombat } from './save-veto';

function withCreature() {
  const world = new World<never>({ seed: 1 }).register(BrainComponent, ...DAMAGE_COMPONENTS);
  const skeleton = world.spawn();
  giveCombatant(world, skeleton, { health: 60, poise: 30 });
  const think = (state: Brain['state']): void => {
    world.set(skeleton, BrainComponent, { state } as Brain);
  };
  world.add(skeleton, BrainComponent, { state: 'unaware' } as Brain);
  return { world, skeleton, think };
}

describe('the combat autosave veto (mw-e01.7)', () => {
  it('objects while a living creature is in Combat, and only then', () => {
    expect(COMBAT_VETO_ID).toBe('combat');
    const { world, skeleton, think } = withCreature();
    const veto = combatVeto(world);
    expect(veto()).toBeNull();
    think('alerted');
    expect(creaturesInCombat(world)).toBe(false);
    think('combat');
    expect(creaturesInCombat(world)).toBe(true);
    expect(veto()).toBe(COMBAT_VETO_REASON);
    expect(COMBAT_VETO_REASON).toBe("Can't save during combat");
    // Dead, it no longer fights, whatever its brain still says.
    world.set(skeleton, HealthComponent, { max: 60, current: 0 });
    expect(veto()).toBeNull();
  });

  it('a world without creature AI never objects', () => {
    expect(combatVeto(new World<never>({ seed: 1 }))()).toBeNull();
  });
});
