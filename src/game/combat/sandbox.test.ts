// @vitest-environment happy-dom
import { loadGameContent } from '@content/index';
import {
  actionTimelineSystem,
  ActionTimelineComponent,
  applyHitStop,
  CombatFacingComponent,
  DAMAGE_COMPONENTS,
  DamageModel,
  giveCombatant,
  HIT_VOLUME_COMPONENTS,
  HitReactionComponent,
  installDebugCommands,
  NO_SPAWN_PARAMS,
  placeEntity,
  spawnAttackerDummy,
  spawnCommand,
  attackerFromTuning,
  dummySpecFrom,
  World,
  type EntityId,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { FakeFrames } from '../loop/fake-frames';
import { createFrameLoop } from '../loop/fixed-step';
import { RenderSync } from '../loop/render-sync';
import { DamageMeter, frameDataView, sandboxFrameData, type SandboxFrameData } from './frame-data';
import {
  bindSandboxDummies,
  createSandboxHud,
  readSandboxDummyTransform,
  SLOW_MOTION_SCALE,
} from './sandbox-view';
import { installSandboxRules, prepareTestbedCombat, startTestbedCombat } from './testbed-combat';

const content = loadGameContent();
const combat = prepareTestbedCombat(content);
const { tuning } = combat.sandbox;

/** A sandbox world as src/main.ts wires it, minus physics and the player's controller. */
function sandbox() {
  const world = new World<unknown>({ seed: 1 });
  installDebugCommands(world, { spawners: combat.spawners, damage: new DamageModel() });
  installSandboxRules(world, combat);
  world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
  startTestbedCombat(world, combat, []); // registers the timeline, melee and placement components
  world.addSystem(actionTimelineSystem({ moves: combat.moves }));
  const attacker = spawnAttackerDummy(
    world,
    { x: 0, y: 0, z: 0 },
    dummySpecFrom(tuning.dummy, NO_SPAWN_PARAMS),
    attackerFromTuning(tuning.attacker),
    { tuning },
  );
  return { world, attacker };
}

const w = (world: World): World<never> => world;

describe('combat sandbox frame data (mw-e04.9)', () => {
  it('reads each fighter’s move, phase and tick, i-frames, reaction, health and poise', () => {
    const { world, attacker } = sandbox();
    const knight = world.spawn();
    giveCombatant(w(world), knight, { health: 100, poise: 30, player: true });
    placeEntity(w(world), knight, { x: 0, y: 0, z: 5 }, 0.35);
    world.step([spawnCommand('dummy', 1, { x: 3, y: 0, z: 0 })]);
    for (let i = 0; i < 19; i++) world.step([]); // the swing's tick 19: active (18–21)
    const data = sandboxFrameData(w(world), { moves: combat.moves, player: knight });
    expect(data.tick).toBe(20);
    expect(data.hz).toBe(60);
    expect(data.speed).toBe(1);
    const [player, swinger, dummy] = data.fighters;
    expect(player).toMatchObject({
      entity: knight,
      role: 'player',
      move: null,
      phase: 'idle',
      health: { current: 100, max: 100 },
      dps: null,
    });
    expect(swinger).toMatchObject({
      entity: attacker,
      role: 'attacker',
      move: 'training-dummy-swing',
      phase: 'active',
      moveTick: 19,
      totalTicks: 42,
      iframes: false,
      hyperarmor: false,
      reaction: null,
      health: { current: 1000, max: 1000 },
      poise: { current: 40, max: 40 },
    });
    expect(dummy).toMatchObject({ role: 'dummy', phase: 'idle', moveTick: null });
    const view = frameDataView(data);
    expect(view.header).toBe('tick 20 · 60 Hz · 1× (F4: slow motion) · F3 hides');
    expect(view.rows.map((r) => [r.label, r.move, r.phase, r.frame])).toEqual([
      ['Knight', '—', 'idle', ''],
      [`Attacker #${String(attacker)}`, 'training-dummy-swing', 'active', '19/42'],
      [`Dummy #${String(dummy?.entity)}`, '—', 'idle', ''],
    ]);
    expect(view.rows[1]).toMatchObject({ health: '1000/1000', poise: '40/40', dps: '' });
  });

  it('shows a reaction and its ticks left, a lock, hyperarmor, i-frames and damage per second', () => {
    const { world, attacker } = sandbox();
    const meter = new DamageMeter(w(world));
    world.step([]);
    combat.damage.apply(w(world), attacker, { amounts: { slash: 30.5 }, poiseDamage: 50 });
    world.step([]); // the stagger interrupts the swing and locks the timeline
    const data = sandboxFrameData(w(world), { moves: combat.moves, meter, speed: 0.25 });
    const [swinger] = data.fighters;
    expect(swinger).toMatchObject({ phase: 'locked', move: null });
    expect(swinger?.reaction?.kind).toBe('stagger');
    expect(swinger?.reaction?.ticksLeft).toBe(45);
    expect(swinger?.dps).toBeCloseTo(30.5 / 5);
    const row = frameDataView(data).rows[0];
    expect(row).toMatchObject({ reaction: 'stagger 45', health: '969.5/1000', dps: '6.1' });
    expect(frameDataView(data).header).toContain('0.25× slow motion (F4)');
    // The window forgets hits older than 5 s.
    for (let i = 0; i < 300; i++) world.step([]);
    expect(meter.dps(attacker, world.tick, 60)).toBe(0);
    meter.dispose();
    // Hyperarmor and i-frames come from the move table and the shared invulnerability rule.
    const heavy = combat.moves.get('sword-heavy');
    const armor = heavy?.hyperarmor;
    expect(armor).not.toBeNull();
    const at = armor?.from ?? 0;
    const table = new Map(combat.moves);
    world.set(attacker, ActionTimelineComponent, {
      ...(world.get(attacker, ActionTimelineComponent) ?? expect.fail('no timeline')),
      current: { move: 'sword-heavy', tick: at, startedAt: world.tick - at },
      lockTicks: 0,
    });
    expect(sandboxFrameData(w(world), { moves: table }).fighters[0]?.hyperarmor).toBe(true);
    const roll = combat.moves.get('dodge-roll')?.iframes;
    world.set(attacker, ActionTimelineComponent, {
      ...(world.get(attacker, ActionTimelineComponent) ?? expect.fail('no timeline')),
      current: { move: 'dodge-roll', tick: roll?.from ?? 0, startedAt: 0 },
    });
    expect(sandboxFrameData(w(world), { moves: table }).fighters[0]).toMatchObject({
      iframes: true,
      hyperarmor: false,
    });
  });

  it('shows the hit-stop freezing a fighter and its frozen ticks left (mw-e04.11)', () => {
    const { world, attacker } = sandbox();
    world.step([]);
    expect(
      frameDataView(sandboxFrameData(w(world), { moves: combat.moves })).rows[0]?.hitStop,
    ).toBe('');
    // As a hit does: during the tick, after the action timeline has run.
    const at = world.tick;
    world.addSystem({
      name: 'hit',
      run: ({ tick }) => {
        if (tick === at) applyHitStop(w(world), attacker, 'heavy', combat.hitStop.heavy);
      },
    });
    world.step([]);
    const data = sandboxFrameData(w(world), { moves: combat.moves });
    expect(data.fighters[0]?.hitStop).toEqual({ tier: 'heavy', ticksLeft: 5 });
    expect(frameDataView(data).rows[0]?.hitStop).toBe('heavy 5');
    for (let i = 0; i < 5; i++) world.step([]);
    expect(sandboxFrameData(w(world), { moves: combat.moves }).fighters[0]?.hitStop).toBeNull();
  });

  it('skips a player that is gone, and reads a world without timelines or sandbox dummies', () => {
    const world = new World<unknown>({ seed: 1 }).register(...DAMAGE_COMPONENTS);
    const gone = world.spawn();
    world.destroy(gone);
    world.step();
    const post = world.spawn();
    giveCombatant(w(world), post, { health: 5 });
    world.step();
    expect(sandboxFrameData(w(world), { moves: combat.moves, player: gone }).fighters).toEqual([]);
    const ghost = world.spawn();
    world.step();
    expect(
      sandboxFrameData(w(world), { moves: combat.moves, player: ghost }).fighters[0],
    ).toMatchObject({ health: null, poise: null });
    const data = sandboxFrameData(w(world), { moves: combat.moves, player: post });
    expect(data.fighters[0]).toMatchObject({ phase: 'idle', reaction: null, poise: null });
    world.register(HitReactionComponent);
    expect(
      frameDataView(sandboxFrameData(w(world), { moves: combat.moves, player: post })).rows[0],
    ).toMatchObject({ health: '5/5', poise: '' });
  });
});

describe('combat sandbox on the page', () => {
  function page(visible = true) {
    document.body.innerHTML = '';
    const { world, attacker } = sandbox();
    const root = document.createElement('div');
    const hud = document.createElement('div');
    document.body.append(root, hud);
    const loop = { timeScale: 1 };
    const hitboxes = { enabled: false };
    let keys = true;
    const sandboxHud = createSandboxHud({
      world: w(world),
      root,
      hud,
      keys: window,
      loop,
      moves: combat.moves,
      player: () => undefined,
      hitboxes,
      visible,
      keysEnabled: () => keys,
    });
    const press = (code: string, repeat = false) => {
      const event = new KeyboardEvent('keydown', { code, repeat, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      world,
      attacker,
      root,
      hud,
      loop,
      hitboxes,
      sandboxHud,
      press,
      setKeys: (on: boolean) => (keys = on),
    };
  }

  it('AC-3: F3 toggles the overlay and the hitboxes; it shows the move, phase and tick the sim has', () => {
    const p = page();
    expect(p.hud.querySelector('[data-testid="frame-data"]')).not.toBeNull();
    expect(p.root.dataset['frameOverlay']).toBe('on');
    expect(p.hitboxes.enabled).toBe(true);
    for (let i = 0; i < 25; i++) p.world.step([]);
    p.sandboxHud.frame();
    const data = JSON.parse(p.root.dataset['frameData'] ?? 'null') as SandboxFrameData;
    const attacker = data.fighters.find((f) => f.role === 'attacker');
    expect(attacker).toMatchObject({
      move: 'training-dummy-swing',
      phase: 'recovery',
      moveTick: 24,
    });
    const row = p.hud.querySelector(`tr[data-key="${String(p.attacker)}"]`);
    expect(row?.querySelector('[data-col="move"]')?.textContent).toBe('training-dummy-swing');
    expect(row?.querySelector('[data-col="phase"]')?.textContent).toBe('recovery');
    expect(row?.querySelector('[data-col="frame"]')?.textContent).toBe('24/42');
    expect(p.press('F3')).toBe(true);
    expect(p.sandboxHud.panel.visible).toBe(false);
    expect(p.hitboxes.enabled).toBe(false);
    expect(p.root.dataset['frameOverlay']).toBe('off');
    p.world.step([]);
    p.sandboxHud.frame(); // hidden: the data is still published, the table not redrawn
    expect(row?.querySelector('[data-col="frame"]')?.textContent).toBe('24/42');
    expect((JSON.parse(p.root.dataset['frameData'] ?? '{}') as SandboxFrameData).tick).toBe(26);
    p.sandboxHud.frame(); // same tick: nothing to publish
    p.press('F3');
    p.sandboxHud.frame();
    expect(row?.querySelector('[data-col="frame"]')?.textContent).toBe('25/42');
  });

  it('F4 toggles 0.25× slow motion; keys are ignored while the console has them or on repeat', () => {
    const p = page(false);
    expect(p.sandboxHud.panel.visible).toBe(false);
    expect(p.press('F4')).toBe(true);
    expect(p.loop.timeScale).toBe(SLOW_MOTION_SCALE);
    p.sandboxHud.frame();
    expect(p.root.dataset['timeScale']).toBe('0.25');
    p.press('F4', true);
    expect(p.loop.timeScale).toBe(SLOW_MOTION_SCALE);
    p.setKeys(false);
    p.press('F4');
    p.press('F3');
    expect(p.loop.timeScale).toBe(SLOW_MOTION_SCALE);
    expect(p.sandboxHud.panel.visible).toBe(false);
    p.setKeys(true);
    expect(p.press('KeyW')).toBe(false);
    p.sandboxHud.toggleSlowMotion();
    expect(p.loop.timeScale).toBe(1);
    p.sandboxHud.dispose();
    p.press('F4');
    expect(p.loop.timeScale).toBe(1);
    expect(p.hud.querySelector('[data-testid="frame-data"]')).toBeNull();
    const bare = createSandboxHud({
      world: w(p.world),
      root: p.root,
      hud: p.hud,
      keys: window,
      loop: p.loop,
      moves: combat.moves,
      player: () => p.attacker,
      visible: true,
    });
    bare.toggleOverlay(); // no hitboxes to toggle
    bare.frame();
    expect(p.press('F3')).toBe(true);
    bare.dispose();
  });

  it('AC-4: at 0.25×, 4 s of wall time run exactly 60 ticks with the same frame data as 1×', () => {
    const run = (scale: number, wallSeconds: number): string[] => {
      const { world } = sandbox();
      const frames = new FakeFrames();
      const seen: string[] = [];
      const loop = createFrameLoop<unknown>({
        sim: world,
        hz: 60,
        now: frames.now,
        scheduler: frames,
        visibility: frames,
        onStep: () => {
          const data = sandboxFrameData(w(world), { moves: combat.moves });
          seen.push(JSON.stringify(data.fighters));
        },
      });
      loop.timeScale = scale;
      loop.start();
      for (let i = 0; i < wallSeconds * 60; i++) frames.frame(1000 / 60);
      loop.stop();
      expect(world.tick).toBe(60);
      return seen;
    };
    const slow = run(SLOW_MOTION_SCALE, 4);
    const normal = run(1, 1);
    expect(slow).toHaveLength(60);
    expect(slow).toEqual(normal);
  });

  it('binds a turned render object to every sandbox dummy once', () => {
    const { world, attacker } = sandbox();
    world.step([spawnCommand('dummy', 1, { x: 0, y: 0, z: 4 })]);
    const sync = new RenderSync(world);
    const bound: EntityId[] = [];
    const create = (entity: EntityId) => {
      bound.push(entity);
      return {
        object: {},
        read: readSandboxDummyTransform,
        apply: () => undefined,
        dispose: () => undefined,
      };
    };
    bindSandboxDummies(w(world), sync, create);
    bindSandboxDummies(w(world), sync, create);
    expect(bound).toHaveLength(2);
    expect(bound).toContain(attacker);
    const transform = readSandboxDummyTransform(world, attacker);
    expect(transform?.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(transform?.rotation.w).toBeCloseTo(1);
    world.set(attacker, CombatFacingComponent, { facing: { x: 1, y: 0, z: 0 } });
    const turned = readSandboxDummyTransform(world, attacker)?.rotation;
    expect(turned?.y).toBeCloseTo(Math.SQRT1_2);
    expect(readSandboxDummyTransform(world, world.spawn())).toBeUndefined();
    const post = world.spawn();
    placeEntity(w(world), post, { x: 1, y: 0, z: 1 }, 0.1);
    world.step([]);
    expect(readSandboxDummyTransform(world, post)?.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    bindSandboxDummies(w(new World<unknown>({ seed: 1 })), sync, create);
    expect(bound).toHaveLength(2);
  });
});
