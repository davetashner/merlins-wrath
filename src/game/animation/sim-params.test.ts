import {
  ACTION_TIMELINE_COMPONENTS,
  applyHitReaction,
  giveHitReactions,
  HitReactionComponent,
  interruptAction,
  requestMove,
  setTimeScale,
  World,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { simAnimReader } from './sim-params';
import { timelineWorld } from './testing';

describe('simAnimReader', () => {
  it('reads an idle entity without a timeline or locomotion as standing still at normal speed', () => {
    const world = new World({ seed: 1 }).register(...ACTION_TIMELINE_COMPONENTS);
    const entity = world.spawn();
    const read = simAnimReader({ moves: new Map() });
    expect(read(world, entity)).toEqual({
      values: {
        speed: 0,
        turnRate: 0,
        grounded: true,
        acting: false,
        actionPhase: 'none',
        actionVerb: 'none',
        hitReact: false,
        hitReaction: 'none',
        hitDirection: 'none',
      },
      timeScale: 1,
      action: null,
    });
    world.destroy(entity);
    expect(read(world, entity)).toBeUndefined();
  });

  it('reads locomotion, the running move, its phase and the time scale from the sim', () => {
    const { world, entity, moves } = timelineWorld();
    const read = simAnimReader({
      moves,
      locomotion: () => ({ speed: 2, turnRate: -1, grounded: false }),
    });
    requestMove(world, entity, 'swing');
    for (let i = 0; i < 13; i++) world.step();
    setTimeScale(world, entity, 0);
    expect(read(world, entity)).toEqual({
      values: {
        speed: 2,
        turnRate: -1,
        grounded: false,
        acting: true,
        actionPhase: 'active',
        actionVerb: 'attack',
        hitReact: false,
        hitReaction: 'none',
        hitDirection: 'none',
      },
      timeScale: 0,
      action: {
        move: 'swing',
        clip: 'anim-swing',
        key: 0,
        tick: 12,
        activeFrom: 12,
        totalTicks: 34,
        phase: 'active',
        verb: 'attack',
      },
    });
  });

  it('reads an interrupt lock as a hit reaction, and a move it cannot look up as none', () => {
    const { world, entity, moves } = timelineWorld();
    const read = simAnimReader({ moves });
    requestMove(world, entity, 'swing');
    world.step();
    expect(simAnimReader({ moves: new Map() })(world, entity)?.action).toBeNull();
    interruptAction(world, entity, 10);
    expect(read(world, entity)?.values).toMatchObject({ hitReact: true, acting: false });
  });

  it('mw-e04.7: reads the sim-chosen hit reaction and its side when asked to', () => {
    const { world, entity, moves } = timelineWorld();
    world.register(HitReactionComponent);
    giveHitReactions(world, entity);
    const read = simAnimReader({ moves, reactions: true });
    expect(read(world, entity)?.values).toMatchObject({
      hitReaction: 'none',
      hitDirection: 'none',
    });
    applyHitReaction(world, entity, { kind: 'stagger', direction: 'back' }, { moves });
    expect(read(world, entity)?.values).toMatchObject({
      hitReact: true,
      hitReaction: 'stagger',
      hitDirection: 'back',
    });
    expect(simAnimReader({ moves })(world, entity)?.values).toMatchObject({
      hitReaction: 'none',
      hitDirection: 'none',
    });
  });
});
