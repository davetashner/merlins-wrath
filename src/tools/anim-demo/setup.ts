// Puts the animation demo into the greybox testbed (mw-e02.20 AC-6): the grey-box humanoid and the
// four-legged beast in the arena, each looping idle → move → attack → hit-react through sim state
// (demo.ts), animated by the shared runtime from their content graphs and followed by render sync.
// The caller steps `driver.capture()` after every sim step and `driver.frame()` every drawn frame.

import { compileMoves, type GameContent } from '@content/index';
import type { Object3D } from 'three';
import { AnimationDriver, simAnimReader } from '@game/animation/index';
import type { RenderSync, SceneBinding, SimView, Transform } from '@game/loop/render-sync';
import {
  AnimationController,
  compileGraph,
  createGreyboxRig,
  type AnimProbe,
} from '@render/animation/index';
import {
  ACTION_TIMELINE_COMPONENTS,
  actionTimelineSystem,
  StaminaComponent,
  type EntityId,
  type World,
} from '@sim/index';
import {
  AnimDemoComponent,
  animDemoLocomotion,
  animDemoSystem,
  animDemoTransform,
  spawnAnimDemo,
  type AnimDemoSpawn,
} from './demo';

/** One demo character: which rig, where, its attack and its tint. */
export interface AnimDemoCharacter extends AnimDemoSpawn {
  readonly rig: string;
  readonly colour: number;
}

/** The testbed's demo characters: in the arena, clear of its pillars, crates and plank. */
export const TESTBED_ANIM_DEMO: readonly AnimDemoCharacter[] = Object.freeze([
  {
    rig: 'greybox-humanoid',
    at: { x: -2.5, y: 0, z: 20.5 },
    yaw: Math.PI,
    attack: 'sword-light-1',
    colour: 0xc9b99a,
  },
  {
    rig: 'greybox-beast',
    at: { x: 2.5, y: 0, z: 25 },
    yaw: Math.PI,
    attack: 'training-dummy-swing',
    colour: 0x8a6f5a,
  },
]);

export interface AnimDemoOptions {
  readonly world: World<never>;
  readonly sync: RenderSync;
  readonly content: GameContent;
  /** Binds a rig's root object to its entity (object3DBinding for Three.js); adds it to the scene. */
  readonly binding: (
    object: Object3D,
    read: (view: SimView, entity: EntityId) => Transform | undefined,
  ) => SceneBinding<Object3D>;
  readonly characters?: readonly AnimDemoCharacter[];
  /**
   * The world already runs the action timeline (the player's combat, mw-e04.8, installs it with the
   * same shipped moves): the demo neither registers it nor adds a second one. Its requests are then
   * taken on the timeline's next run.
   */
  readonly sharedTimeline?: boolean;
}

export interface AnimDemo {
  readonly driver: AnimationDriver;
  readonly entities: readonly EntityId[];
}

/**
 * Registers the demo and action timeline with `world` (call once, before stepping; see
 * `sharedTimeline`), spawns the demo characters and binds their grey-box rigs.
 */
export function setupAnimationDemo(options: AnimDemoOptions): AnimDemo {
  const { world, sync, content } = options;
  const moves = compileMoves(content.all('move'));
  if (options.sharedTimeline === true) {
    world.register(AnimDemoComponent).addSystem(animDemoSystem());
  } else {
    world.register(AnimDemoComponent, ...ACTION_TIMELINE_COMPONENTS, StaminaComponent);
    world.addSystem(animDemoSystem()).addSystem(actionTimelineSystem({ moves }));
  }
  const clips = content.all('anim-clip');
  const read = simAnimReader({ moves, locomotion: animDemoLocomotion });
  const driver = new AnimationDriver(world);
  const entities = (options.characters ?? TESTBED_ANIM_DEMO).map((character) => {
    const graph = compileGraph(content.get('anim-graph', character.rig), clips);
    const view = createGreyboxRig(graph.rig, character.colour);
    const entity = spawnAnimDemo(world, character);
    sync.bind(entity, options.binding(view.root, animDemoTransform));
    driver.add(entity, {
      name: character.rig,
      controller: new AnimationController(graph),
      read,
      apply: (pose) => {
        view.apply(pose);
      },
      locate: () => view.root.position,
    });
    return entity;
  });
  return { driver, entities };
}

/** The probe as the page publishes it: per character, each layer's state and the states entered. */
export function compactProbe(
  probe: Readonly<Record<string, AnimProbe & { readonly history: readonly string[] }>>,
): Record<string, { layers: Record<string, string>; history: readonly string[] }> {
  const out: Record<string, { layers: Record<string, string>; history: readonly string[] }> = {};
  for (const [name, character] of Object.entries(probe)) {
    out[name] = {
      layers: Object.fromEntries(character.layers.map((l) => [l.id, l.state])),
      history: character.history,
    };
  }
  return out;
}

/** One character's probe as the page publishes it, with its clips (the player's, mw-e02.6). */
export interface PublishedCharacterProbe {
  /** Each layer's state. */
  readonly layers: Record<string, string>;
  /** Each layer's clip (null for a none state). */
  readonly clips: Record<string, string | null>;
  readonly history: readonly string[];
  readonly clipHistory: readonly string[];
}

/** A character's probe with its clips, as the page publishes it on `data-player-animation`. */
export function playerAnimationProbe(
  probe: AnimProbe & {
    readonly history: readonly string[];
    readonly clipHistory: readonly string[];
  },
): PublishedCharacterProbe {
  return {
    layers: Object.fromEntries(probe.layers.map((l) => [l.id, l.state])),
    clips: Object.fromEntries(probe.layers.map((l) => [l.id, l.clip])),
    history: probe.history,
    clipHistory: probe.clipHistory,
  };
}
