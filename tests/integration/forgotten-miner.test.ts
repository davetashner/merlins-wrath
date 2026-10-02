// mw-e13.1: the Forgotten miner, the game's first creature and the vertical slice's arena fight
// (docs/design/vertical-slice.md B4), through the game's own wiring: the knight parries its overhead
// chop and has a riposte (AC-2), its resistance table turns blunt into more and poison into nothing,
// with the combat sheet's immune feedback (AC-3), and in a lit arena it notices a player 10 m away
// and enters Combat within 600 ticks (AC-4). AC-1 (its data and the readability rule) is
// src/content/forgotten-miner.test.ts.
import { describe, expect, it } from 'vitest';
import {
  compileCreatures,
  controllerTuningFor,
  PLAYER_CONTROLLER_ID,
  type CreatureTable,
} from '@content/index';
import { loadGameContent } from '@content/game-content';
import { markExercised } from '@content/testing';
import { AudioCueBridge, worldCueLookups } from '@game/cues/index';
import { installSandboxRules, prepareTestbedCombat, startTestbedCombat } from '@game/combat/index';
import { prepareCreatures, startCreatures } from '@game/creatures/index';
import {
  actionOf,
  actionTimelineSystem,
  ActionTimelineComponent,
  aiScenario,
  AttackEnded,
  buildFactionTable,
  compileBehaviours,
  DAMAGE_COMPONENTS,
  DamageApplied,
  DamageModel,
  factionSpecFromDef,
  giveActionTimeline,
  giveCombatant,
  giveFacing,
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  HitParried,
  installFactions,
  KNIGHT_RIPOSTE,
  parriedOf,
  placeEntity,
  registerCreatureComponents,
  registerWorldProperties,
  requestMove,
  riposteRedirect,
  riposteTargetOf,
  spawnCreature,
  startAttack,
  TelegraphStarted,
  World,
  type DamageResult,
  type EntityId,
} from '@sim/index';
import forgottenArena from './fixtures/ai-scenarios/forgotten-arena.json';

const ID = 'forgotten-miner';
const content = loadGameContent();

/** `value`, which the test knows is there. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing test value');
  return value;
}

describe('the Forgotten miner (mw-e13.1)', () => {
  it('AC-2: the knight parrying its overhead chop in the window leaves it Parried with a riposte available', ({
    task,
  }) => {
    markExercised(task, 'creature', ID);
    markExercised(task, 'attack', 'forgotten-overhead-chop');
    const combat = prepareTestbedCombat(content);
    const creatures = prepareCreatures(content, combat);
    const world = new World<unknown>({ seed: 1 });
    installSandboxRules(world, combat);
    world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
    // The knight's action timeline, with the light attack turning into the riposte (the player's).
    world.addSystem(
      actionTimelineSystem({
        moves: combat.moves,
        redirect: riposteRedirect({ trigger: 'sword-light-1', riposte: KNIGHT_RIPOSTE }),
      }),
    );
    startTestbedCombat(world, combat, []);
    const w: World<never> = world;
    const spawned = startCreatures(world, creatures, combat, [
      {
        id: 'skeleton',
        position: { x: 0, y: 0, z: 0 },
        yaw: 0,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        prop: undefined,
        tags: [],
        creature: ID,
      },
    ]);
    expect(spawned.errors).toEqual([]);
    const skeleton = must(spawned.entities[0]);
    const knight = w.spawn();
    placeEntity(w, knight, { x: 0, y: 0, z: 1.2 }, 0.35);
    giveFacing(w, knight, { x: 0, y: 0, z: -1 });
    giveHurtboxes(w, knight, {
      facing: { x: 0, y: 0, z: -1 },
      boxes: [
        {
          id: 'body',
          socket: 'root',
          region: 'torso',
          armored: false,
          multiplier: 1,
          shape: {
            kind: 'capsule',
            from: { x: 0, y: 0.4, z: 0 },
            to: { x: 0, y: 1.4, z: 0 },
            radius: 0.35,
          },
        },
      ],
    });
    giveCombatant(w, knight, { health: 100, poise: 40 });
    giveActionTimeline(w, knight);
    giveHitboxes(w, knight); // its sword: the riposte can land
    world.step([]); // spawns land at the end of the tick

    const start = w.tick;
    const parries: [number, EntityId, EntityId | null][] = [];
    const ends: [number, string, string][] = [];
    const telegraphs: [number, string, boolean][] = [];
    const onSkeleton: DamageResult[] = [];
    w.events.on(HitParried, (e) => parries.push([e.tick - start, e.entity, e.attacker]));
    w.events.on(AttackEnded, (e) => ends.push([e.tick - start, e.attack, e.reason]));
    w.events.on(TelegraphStarted, (e) => telegraphs.push([e.tick - start, e.move, e.parryable]));
    w.events.on(DamageApplied, (e) => {
      if (e.target === skeleton) onSkeleton.push(e);
    });

    const chop = must(creatures.attacks.get('forgotten-overhead-chop'));
    startAttack(w, skeleton, chop, { x: 0, y: 0, z: 1 });
    let parried: ReturnType<typeof parriedOf>;
    let riposteTarget: EntityId | undefined;
    let riposteMove: string | undefined;
    for (let i = 0; i < 100; i++) {
      // The chop telegraphs on tick 0 and is active from tick 24; the 10-tick parry from 16 covers it.
      if (i === 16) requestMove(w, knight, 'shield-parry');
      // Once the parry has recovered, the knight presses attack while the skeleton is still
      // Parried in reach: the riposte starts instead of the light attack.
      if (i === 60) requestMove(w, knight, 'sword-light-1');
      world.step([]);
      if (i === 24) {
        parried = parriedOf(w, skeleton);
        riposteTarget = riposteTargetOf(w, knight);
      }
      if (i === 60) riposteMove = actionOf(w, knight)?.move;
    }

    expect(telegraphs).toEqual([[0, 'forgotten-overhead-chop', true]]);
    expect(parries).toEqual([[24, knight, skeleton]]);
    expect(ends).toEqual([[24, 'forgotten-overhead-chop', 'parried']]);
    // Parried: stunned from the parry, its timeline locked, and the knight has it as riposte target.
    expect(must(parried).startedAt - start).toBe(24);
    expect(must(parried).endsAt - must(parried).startedAt).toBeGreaterThan(30);
    expect(w.get(skeleton, ActionTimelineComponent)?.lockTicks).toBeGreaterThan(0);
    expect(riposteTarget).toBe(skeleton);
    // The riposte is the move the attack button started.
    expect(riposteMove).toBe(KNIGHT_RIPOSTE);
    // The riposte is the only hit it takes: a critical at ×3 (slash, which it does not resist).
    expect(onSkeleton.map((e) => [e.tick - start, e.total, e.tags])).toEqual([
      [68, 60, ['critical', 'parryable', 'riposte']],
    ]);
  });

  describe('its resistance table', () => {
    function setup() {
      const world = registerWorldProperties(new World<never>({ seed: 1 }));
      registerCreatureComponents(world);
      const factions = buildFactionTable(content.all('faction').map(factionSpecFromDef));
      installFactions(world);
      const creatures: CreatureTable = compileCreatures(content.all('creature'), content);
      const spawned = spawnCreature(
        world,
        { creatures, factions },
        { creature: ID, at: { x: 0, y: 0, z: 0 } },
      );
      if (!spawned.ok) throw new Error('the skeleton did not spawn');
      world.step();
      const played: string[] = [];
      const bridge = new AudioCueBridge({
        sheets: [content.get('cue-sheet', 'combat')],
        player: { play: (cue) => played.push(cue) },
        now: () => world.tick * 1000,
        warn: (message) => {
          throw new Error(message);
        },
        lookups: worldCueLookups(world, content.all('material'), { moves: content.all('move') }),
      });
      bridge.attach(world.events);
      const model = new DamageModel();
      const hit = (amounts: Record<string, number>) => {
        const result = model.apply(world, spawned.entity, { amounts, instigator: null });
        world.step();
        return result;
      };
      return { hit, played };
    }

    it('AC-3: a 30-blunt hit deals 45 (blunt ×1.5)', ({ task }) => {
      markExercised(task, 'creature', ID);
      const { hit } = setup();
      expect(hit({ blunt: 30 })).toMatchObject({
        total: 45,
        immune: false,
        healthBefore: 100,
        healthAfter: 55,
      });
      expect(hit({ pierce: 30 })).toMatchObject({ total: 15, immune: false }); // pierce ×0.5
    });

    it('AC-3: edge: a 30-poison hit deals 0 and is flagged immune, which plays the glance', ({
      task,
    }) => {
      markExercised(task, 'creature', ID);
      const { hit, played } = setup();
      expect(hit({ poison: 30 })).toMatchObject({
        total: 0,
        immune: true,
        healthBefore: 100,
        healthAfter: 100,
      });
      expect(played).toEqual(['sfx-combat-glance']); // the combat sheet's "no effect" feedback
    });
  });

  it('AC-4: spawned in the lit arena it ticks 600 frames, perceives the player 10 m away and enters Combat', ({
    task,
  }) => {
    markExercised(task, 'creature', ID);
    markExercised(task, 'behaviour', 'forgotten');
    const scenario = aiScenario(
      { name: 'forgotten-arena', layout: forgottenArena, duration: 10 },
      {
        creatures: compileCreatures(content.all('creature'), content),
        factions: buildFactionTable(content.all('faction').map(factionSpecFromDef)),
        behaviours: compileBehaviours(content.all('behaviour')),
        controller: controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)),
      },
    );
    expect(scenario.ticks).toBe(600);
    scenario.at(0).expect('skeleton').state('Unaware');
    scenario.during(0, 10).expect('skeleton').enters('Suspicious', 'Unaware');
    scenario.during(0, 10).expect('skeleton').enters('Combat');
    scenario.at(10).expect('skeleton').state('Combat');
    const result = scenario.check();

    const seen = result.timeline.find(
      (e) => e.kind === 'sight' && e.agent === 'skeleton' && e.seen,
    );
    if (seen?.kind !== 'sight') throw new Error(result.report);
    expect(seen.distance).toBeCloseTo(10, 0);
    expect(seen.light).toBeGreaterThan(0.4); // the torchlight, not the arena's ambient
    const combat = result.timeline.find((e) => e.kind === 'state' && e.to === 'combat');
    expect(combat?.time).toBeLessThan(10);
  });
});
