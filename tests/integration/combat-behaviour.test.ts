// mw-e11.13: creature combat behaviour through the game's own wiring. In the grey-box fight room
// (fixtures/ai-scenarios/guard-fight-room.json) the player stands between two fixture guards with
// knight combat and the creature attack executor running: both guards see the player, enter Combat,
// take turns under the attack-token budget, swing their strike on the move system and land it, tell
// each other where the player is, and the fight runs to its end (the player dies) without an AI
// error. Unit coverage of every AC is src/sim/ai/combat.test.ts.
import { describe, expect, it } from 'vitest';
import { controllerTuningFor, compileCreatures, PLAYER_CONTROLLER_ID } from '@content/index';
import { loadDevContent } from '@content/dev-content';
import { markExercised } from '@content/testing';
import { prepareTestbedCombat, startTestbedCombat } from '@game/combat/index';
import { prepareCreatures } from '@game/creatures/index';
import {
  actionTimelineSystem,
  aiScenario,
  AiTargetShared,
  ATTACK_COMPONENTS,
  AttackEnded,
  buildFactionTable,
  characterPlacementSystem,
  compileBehaviours,
  currentAttack,
  DAMAGE_COMPONENTS,
  DamageApplied,
  factionSpecFromDef,
  healthOf,
  HIT_VOLUME_COMPONENTS,
  installAttacks,
  installTargetSharing,
  invulnerabilityRule,
  PlacementCentreComponent,
  TelegraphStarted,
  type EntityId,
  type World,
} from '@sim/index';
import fightRoom from './fixtures/ai-scenarios/guard-fight-room.json';

const content = loadDevContent();
const combat = prepareTestbedCombat(content);
const creatures = prepareCreatures(content, combat);
const controller = controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID));
const factions = buildFactionTable(content.all('faction').map(factionSpecFromDef));

describe('combat behaviour in the fight room (mw-e11.13)', () => {
  it('AC-4: the player fights 2 fixture guards: both attack within 10 s, never more than the token budget at once, and the fight resolves without AI errors', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    markExercised(task, 'creature', 'fixture-guard');
    markExercised(task, 'attack', 'fixture-guard-strike');
    let player: EntityId = -1;
    const scenario = aiScenario(
      { name: 'guard-fight-room', layout: fightRoom, duration: 30 },
      {
        creatures: compileCreatures(content.all('creature'), content),
        factions,
        behaviours: compileBehaviours(content.all('behaviour')),
        controller,
        ai: { attacks: creatures.attacks, attackTokens: 2 },
        install: (world, context) => {
          player = context.player;
          // The player's placement follows its controller (as installGamePhysics does in the game).
          const all = [
            PlacementCentreComponent,
            ...HIT_VOLUME_COMPONENTS,
            ...DAMAGE_COMPONENTS,
            ...ATTACK_COMPONENTS,
          ];
          for (const type of all) {
            if (!world.isRegistered(type)) world.register(type);
          }
          world.addSystem(characterPlacementSystem(controller));
          world.addSystem(actionTimelineSystem({ moves: combat.moves }));
          startTestbedCombat(world, combat, [], context.player);
          installAttacks(world, {
            attacks: creatures.attacks,
            damage: combat.damage,
            invulnerable: invulnerabilityRule(combat.moves),
          });
          installTargetSharing(world, { factions });
        },
      },
    );
    const { world, drive, agents } = scenario.start();
    const w = world as World<never>;
    const west = agents.get('west') ?? -1;
    const east = agents.get('east') ?? -1;
    const firstSwing = new Map<EntityId, number>();
    const ended: string[] = [];
    const hitsOnPlayer: number[] = [];
    let shares = 0;
    w.events.on(TelegraphStarted, ({ tick, attacker }) => {
      if (!firstSwing.has(attacker)) firstSwing.set(attacker, tick);
    });
    w.events.on(AttackEnded, ({ reason }) => ended.push(reason));
    w.events.on(DamageApplied, ({ target, total }) => {
      if (target === player) hitsOnPlayer.push(total);
    });
    w.events.on(AiTargetShared, () => {
      shares++;
    });
    let most = 0;
    let deathTick = -1;
    for (let tick = 0; tick < scenario.ticks && deathTick < 0; tick++) {
      world.step(drive(tick)); // throws on any AI error
      const swinging = [west, east].filter((g) => currentAttack(w, g) !== undefined).length;
      most = Math.max(most, swinging);
      if ((healthOf(w, player)?.current ?? 1) <= 0) deathTick = tick;
    }
    // Both guards swung within 10 s of the start.
    expect([...firstSwing.keys()].sort()).toEqual([west, east].sort());
    for (const tick of firstSwing.values()) expect(tick).toBeLessThan(600);
    expect(most).toBeLessThanOrEqual(2);
    // Their strikes landed, and the fight resolved: the player went down before 30 s.
    expect(hitsOnPlayer.length).toBeGreaterThan(0);
    expect(deathTick).toBeGreaterThan(0);
    expect(ended).toContain('completed');
    // They told each other where the player was.
    expect(shares).toBeGreaterThan(0);
  });
});
