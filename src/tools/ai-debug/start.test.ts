// @vitest-environment happy-dom
import { compileCreatures } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import {
  buildFactionTable,
  compileBehaviours,
  factionSpecFromDef,
  installAi,
  installFactions,
  registerCreatureComponents,
  registerSceneComponents,
  spawnCreature,
  World,
  type EntityId,
} from '@sim/index';
import { PerspectiveCamera, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ConsoleHost } from '../console/builtins';
import { createGameHost } from '../console/host';
import { CommandRegistry } from '../console/registry';
import { cameraRay, startAiDebug } from './start';

const content = loadFixtureContent();
const creatures = compileCreatures(content.all('creature'), content);
const factions = buildFactionTable(content.all('faction').map(factionSpecFromDef));

function setup() {
  const world = installFactions(
    registerCreatureComponents(registerSceneComponents(new World<never>({ seed: 2 }))),
  );
  installAi(world, { behaviours: compileBehaviours(content.all('behaviour')) });
  const guards: EntityId[] = [];
  for (const x of [-2, 0, 2]) {
    const result = spawnCreature(
      world,
      { creatures, factions },
      { creature: 'fixture-guard', at: { x, y: 0, z: -8 }, facing: { x: 0, y: 0, z: 1 } },
    );
    if (result.ok) guards.push(result.entity);
  }
  world.step();
  const registry = new CommandRegistry<ConsoleHost>(
    createGameHost({
      world,
      submit: () => undefined,
      player: () => undefined,
      spawnables: [],
      bookmarks: () => new Map(),
      scenes: [],
      loadScene: () => undefined,
      loop: { timeScale: 1 },
    }),
  );
  const root = document.createElement('div');
  document.body.append(root);
  Object.defineProperty(root, 'clientWidth', { value: 800 });
  Object.defineProperty(root, 'clientHeight', { value: 600 });
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 200);
  camera.position.set(0, 1.2, 0);
  camera.lookAt(0, 1.2, -1);
  const loop = { stepOnce: vi.fn() };
  let locked = false;
  const publish = vi.fn();
  const session = startAiDebug({
    world,
    loop,
    registry,
    scene,
    camera,
    root,
    pointerLocked: () => locked,
    light: { levelAt: () => 0.5 },
    cursorPoint: () => ({ x: 0, y: 0, z: -4 }),
    publish,
  });
  return {
    world,
    guards,
    registry,
    root,
    scene,
    camera,
    loop,
    session,
    publish,
    lock: (on: boolean) => (locked = on),
  };
}

const readout = (publish: ReturnType<typeof vi.fn>): Record<string, unknown> =>
  JSON.parse(String(publish.mock.lastCall?.[0])) as Record<string, unknown>;

describe('AI debug overlay start (mw-e11.17)', () => {
  it('adds the overlay to the scene, off; ai.debug on draws every agent with a label', () => {
    const s = setup();
    expect(s.scene.children).toContain(s.session.overlay.object);
    s.session.frame();
    expect(readout(s.publish)).toEqual({
      on: false,
      frozen: false,
      selected: null,
      tick: null,
      agents: 0,
      cones: 0,
      labels: 0,
      noises: 0,
    });
    expect(s.registry.execute('ai.debug on').ok).toBe(true);
    s.session.frame();
    expect(readout(s.publish)).toMatchObject({ on: true, agents: 3, cones: 3, labels: 3 });
    const labels = s.root.querySelectorAll('[data-testid="ai-debug-label"]');
    expect(labels).toHaveLength(3);
    expect(labels[0]?.textContent).toContain('fixture-guard');
    expect(s.root.querySelector('[data-testid="ai-debug-status"]')?.textContent).toContain(
      'light 0.50',
    );
    // The same readout is not published twice.
    const calls = s.publish.mock.calls.length;
    s.session.frame();
    expect(s.publish.mock.calls.length).toBe(calls);
  });

  it('a click selects the agent under it while the pointer is free, never while it is locked', () => {
    const s = setup();
    const click = () => {
      s.root.dispatchEvent(new MouseEvent('click', { clientX: 400, clientY: 300, bubbles: true }));
    };
    click(); // overlay off: ignored
    expect(s.session.debug.selected).toBeUndefined();
    s.registry.execute('ai.debug on');
    s.session.frame();
    s.lock(true);
    click();
    expect(s.session.debug.selected).toBeUndefined();
    s.lock(false);
    click();
    expect(s.session.debug.selected).toBe(s.guards[1]);
    s.root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    s.session.debug.selected = undefined;
    click();
    expect(s.session.debug.selected).toBeUndefined();
  });

  it('ai.debug select with no id picks the agent under the crosshair; ai.step asks the loop for one step', () => {
    const s = setup();
    expect(s.registry.execute('ai.debug select').ok).toBe(true);
    expect(s.session.debug.selected).toBe(s.guards[1]);
    expect(s.registry.execute(`ai.debug select ${String(s.guards[2])}`).ok).toBe(true);
    expect(s.session.debug.selected).toBe(s.guards[2]);
    expect(s.registry.execute('ai.debug select 9999').ok).toBe(false);
    s.registry.execute('ai.step');
    expect(s.session.held()).toBe(true);
    expect(s.loop.stepOnce).toHaveBeenCalledTimes(1);
  });

  it('the camera ray runs from the camera through the view point', () => {
    const s = setup();
    const ray = cameraRay(s.camera, 0, 0);
    expect(ray.origin).toEqual({ x: 0, y: 1.2, z: 0 });
    expect(ray.direction.z).toBeCloseTo(-1, 6);
  });

  it('dispose removes the labels, the overlay and the click handler', () => {
    const s = setup();
    s.registry.execute('ai.debug on');
    s.session.frame();
    s.session.dispose();
    expect(s.root.querySelector('[data-testid="ai-debug-layer"]')).toBeNull();
    expect(s.scene.children).not.toContain(s.session.overlay.object);
    expect(s.session.debug.enabled).toBe(false);
  });
});
