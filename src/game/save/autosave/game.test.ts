// The running game's autosave (mw-e01.7): checkpoints and milestone facts request autosaves, vetoes
// hold them, every attempt is published, and a second failure warns.
import {
  addSignalGraph,
  restCompleted,
  installSignals,
  installStimuli,
  placeEntity,
  registerWorldProperties,
  signalSystem,
  tagEntity,
  World,
  type SignalGraphDef,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from '../sections';
import { SaveSlots } from '../slots/index';
import { MemorySaveStore, type SaveStore } from '../storage/index';
import { autosaveReadout, GameAutosave } from './game';
import type { AutosaveEvent } from './scheduler';

const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };

/** A player-filtered checkpoint volume around the origin and a plain one at x = 5. */
const graph: SignalGraphDef = {
  id: 'route',
  nodes: [
    {
      id: 'cp',
      kind: 'volume',
      shape: { kind: 'box', center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } },
      filter: [{ test: 'tag', tag: 'player' }],
    },
    {
      id: 'plain',
      kind: 'volume',
      shape: { kind: 'box', center: { x: 5, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } },
      filter: [{ test: 'tag', tag: 'player' }],
    },
  ],
  wires: [],
};

function setup(store: SaveStore = new MemorySaveStore()) {
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 5 }))),
  );
  world.addSystem(signalSystem());
  addSignalGraph(world, graph);
  const hero = world.spawn();
  tagEntity(world, hero, 'player');
  placeEntity(world, hero, { x: 0, y: 0, z: 10 });
  const slots = new SaveSlots({
    store,
    registry: createGameSaveRegistry(),
    build,
    now: () => 1_790_000_000_000,
  });
  const fighting = { now: false };
  const events: AutosaveEvent[] = [];
  const warnings: string[] = [];
  const autosave = new GameAutosave({
    world,
    slots,
    describe: () => ({ characterName: 'Knight', classId: 'knight', areaId: 'route' }),
    isCheckpoint: (crossing) => crossing.node === 'cp',
    milestones: ['route.done'],
    vetoes: { combat: () => (fighting.now ? 'fighting' : null) },
    timing: { minGapSeconds: 0 },
    publish: (event) => events.push(event),
    warn: (message) => warnings.push(message),
  });
  const moveTo = (x: number, z: number): void => {
    placeEntity(world, hero, { x, y: 0, z });
    world.step();
  };
  return { world, slots, autosave, fighting, events, warnings, moveTo };
}

describe('the game autosave (mw-e01.7)', () => {
  it('a checkpoint volume requests an autosave; other volumes do not', async () => {
    const t = setup();
    t.moveTo(5, 0);
    expect(await t.autosave.afterStep()).toBeNull();
    t.moveTo(0, 0);
    const saved = await t.autosave.afterStep();
    expect(saved).toMatchObject({
      type: 'saved',
      trigger: { kind: 'checkpoint', source: 'route/cp' },
    });
    expect(t.events.map(autosaveReadout)).toEqual([
      { type: 'saving', kind: 'checkpoint', source: 'route/cp', slot: 'auto-1' },
      { type: 'saved', kind: 'checkpoint', source: 'route/cp', slot: 'auto-1' },
    ]);
  });

  it('a milestone fact turning true requests a quest autosave; other facts and false do not', async () => {
    const t = setup();
    t.world.facts.set('route.other', true);
    t.world.facts.set('route.done', false);
    t.world.step();
    expect(await t.autosave.afterStep()).toBeNull();
    t.world.facts.set('route.done', true);
    t.world.step();
    expect(await t.autosave.afterStep()).toMatchObject({
      type: 'saved',
      trigger: { kind: 'quest', source: 'route.done' },
    });
  });

  it('finishing a rest requests one rest autosave, whatever else is going on (mw-ju8.6)', async () => {
    const t = setup();
    const actor = t.world.spawn();
    const rested = { tick: 0, actor, kind: 'inn', hours: 9, point: 'sleeping-ox' } as const;
    t.world.events.emit(restCompleted, { ...rested, wakes: { day: 2, minute: 360 } });
    t.world.step();
    expect(await t.autosave.afterStep()).toMatchObject({
      type: 'saved',
      trigger: { kind: 'rest', source: 'sleeping-ox' },
    });
    expect(await t.autosave.afterStep()).toBeNull();
  });

  it('a veto holds the request until it clears; reset forgets it', async () => {
    const t = setup();
    t.fighting.now = true;
    t.moveTo(0, 0);
    expect(await t.autosave.afterStep()).toBeNull();
    expect(t.autosave.scheduler.pending).toMatchObject({ kind: 'checkpoint' });
    t.fighting.now = false;
    expect(await t.autosave.afterStep()).toMatchObject({ type: 'saved' });

    t.moveTo(0, 10);
    t.moveTo(0, 0);
    t.autosave.reset();
    expect(t.autosave.scheduler.pending).toBeNull();
    expect(await t.autosave.afterStep()).toBeNull();
  });

  it('warns once a write has failed twice', async () => {
    const store = new MemorySaveStore();
    store.write = () => Promise.reject(new Error('disk on fire'));
    const t = setup(store);
    t.moveTo(0, 0);
    expect(await t.autosave.afterStep()).toMatchObject({ type: 'failed', retrying: true });
    expect(t.warnings).toEqual([]);
    expect(await t.autosave.afterStep()).toMatchObject({ type: 'failed', retrying: false });
    expect(t.warnings).toEqual(['autosave (checkpoint) failed: Error: disk on fire']);
  });

  it('stop removes the listeners and the vetoes', async () => {
    const t = setup();
    t.fighting.now = true;
    t.autosave.stop();
    expect(t.autosave.scheduler.vetoes.isSafe()).toBe(true);
    t.moveTo(0, 0);
    t.world.facts.set('route.done', true);
    t.world.step();
    expect(await t.autosave.afterStep()).toBeNull();
    expect(t.events).toEqual([]);
  });

  it('reads a trigger without a source as null', () => {
    expect(
      autosaveReadout({
        type: 'failed',
        trigger: { kind: 'timed' },
        slot: null,
        error: new Error('no ring'),
        retrying: true,
      }),
    ).toEqual({ type: 'failed', kind: 'timed', source: null, slot: null });
  });

  it('wires nothing it is not given', async () => {
    const world = new World<never>({ seed: 1 });
    const autosave = new GameAutosave({
      world,
      slots: new SaveSlots({
        store: new MemorySaveStore(),
        registry: createGameSaveRegistry(),
        build,
        now: () => 0,
      }),
      describe: () => ({ characterName: '', classId: 'none', areaId: '' }),
    });
    world.facts.set('route.done', true);
    world.step();
    expect(await autosave.afterStep()).toBeNull();
    expect(autosave.scheduler.vetoes.active()).toEqual([]);
  });
});
