// Contract between layers (mw-e12.5): a creature's attack data, compiled by the content layer,
// resolves through the sim's damage model. Content may import the sim only as types, so this
// cross-layer test lives outside src/. It uses the frozen fixture-guard and its fixture-guard-strike
// (18/4/14 ticks, two packets: 18 slash + 15 poise, then 4 blunt).

import { describe, expect, it, vi } from 'vitest';
import { compileAttacks, compileMoves } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import {
  ATTACK_COMPONENTS,
  AttackHit,
  DAMAGE_COMPONENTS,
  DamageModel,
  PlacementComponent,
  canStartAttack,
  combatantFromCreature,
  giveAttacker,
  giveCombatant,
  healthOf,
  installAttacks,
  placeEntity,
  startAttack,
  World,
  type AttackHitInfo,
  type Vec3,
} from '@sim/index';

const content = loadFixtureContent();
const attacks = compileAttacks(content.all('attack'), compileMoves(content.all('move')));
const guardDef = content.get('creature', 'fixture-guard');

function fight(playerAt: Vec3) {
  const world = new World<never>({ seed: 11 }).register(
    ...DAMAGE_COMPONENTS,
    ...ATTACK_COMPONENTS,
    PlacementComponent,
  );
  const damage = new DamageModel();
  const apply = vi.spyOn(damage, 'apply');
  installAttacks(world, { attacks, damage });
  const hits: AttackHitInfo[] = [];
  world.events.on(AttackHit, (e) => hits.push(e));

  const guard = world.spawn();
  giveCombatant(world, guard, combatantFromCreature(guardDef));
  giveAttacker(world, guard);
  placeEntity(world, guard, { x: 0, y: 0, z: 0 }, 0.35);
  const player = world.spawn();
  giveCombatant(world, player, { health: 100, poise: 30, player: true });
  placeEntity(world, player, { ...playerAt, y: 1.2 }, 0.4);

  const [ref] = guardDef.attacks;
  const attack = attacks.get(ref?.id ?? '');
  if (attack === undefined) throw new Error('fixture-guard has no attack');
  return { world, guard, player, attack, apply, hits };
}

describe('creature attacks bind to the damage model', () => {
  it('AC-5: fixture-guard striking a player hurtbox in range sends one packet per packet definition', () => {
    const { world, guard, player, attack, apply, hits } = fight({ x: 0, y: 0, z: 1.2 });
    expect(canStartAttack(world, guard, attack, { distance: 1.2 })).toEqual({ ok: true });
    startAttack(world, guard, attack, { x: 0, y: 0, z: 1 });
    for (let tick = 0; tick < attack.move.totalTicks; tick++) world.step();

    expect(apply).toHaveBeenCalledTimes(attack.packets.length);
    expect(apply.mock.calls.map(([, target, packet]) => [target, packet.amounts])).toEqual([
      [player, { slash: 18 }],
      [player, { blunt: 4 }],
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.results.map((r) => [r.total, r.poiseDamage])).toEqual([
      [18, 15],
      [4, 0],
    ]);
    expect(healthOf(world, player)?.current).toBe(78);
  });

  it('AC-5: out of reach, the active window overlaps nothing and no packet is sent', () => {
    const { world, guard, attack, apply, hits } = fight({ x: 0, y: 0, z: 3 });
    expect(canStartAttack(world, guard, attack, { distance: 3 })).toEqual({
      ok: false,
      reason: 'too-far',
    });
    startAttack(world, guard, attack, { x: 0, y: 0, z: 1 });
    for (let tick = 0; tick < attack.move.totalTicks; tick++) world.step();
    expect(apply).not.toHaveBeenCalled();
    expect(hits).toEqual([]);
  });
});
