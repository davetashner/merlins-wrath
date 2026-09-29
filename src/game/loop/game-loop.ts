// Composes the frame loop with render sync (mw-e00.20): after every sim step the sync captures the
// new state; on every frame it disposes objects of destroyed entities, interpolates the rest by the
// loop's alpha, and then the caller draws. src/main.ts wires this to the browser and the renderer.
import type { World } from '@sim/index';
import type { BrowserFrameSources } from './browser';
import {
  createFrameLoop,
  type CommandSampler,
  type FrameInfo,
  type FrameLoop,
  type FrameLoopOptions,
} from './fixed-step';
import { RenderSync } from './render-sync';

export interface GameLoopOptions<TCommand> {
  readonly world: World<TCommand>;
  readonly sources: BrowserFrameSources;
  /** Draws the frame once render sync has updated the scene. */
  readonly draw: (frame: FrameInfo) => void;
  readonly sampleCommands?: CommandSampler<TCommand>;
  /** Called after every sim step, once render sync has captured it (e.g. animation, mw-e02.20). */
  readonly onStep?: (tick: number) => void;
  readonly maxStepsPerFrame?: number;
  /** Pauses sim stepping while true (see FrameLoopOptions.simPaused). */
  readonly simPaused?: () => boolean;
  /** Where dropped-time reports go; defaults to `droppedTimeLogger()` for this build. */
  readonly warn?: FrameLoopOptions<TCommand>['warn'];
}

/**
 * Dropped-time reporting per build. Dev builds warn in the console, so a hitch is visible while
 * working. Production logs at debug level: a slow machine would otherwise fill players' consoles
 * with warnings, and frame pacing analytics (e32) is where production hitches get measured.
 */
export function droppedTimeLogger(
  dev: boolean = import.meta.env.DEV,
  logger: Pick<Console, 'warn' | 'debug'> = console,
): (message: string) => void {
  return dev
    ? (message) => {
        logger.warn(message);
      }
    : (message) => {
        logger.debug(message);
      };
}

export interface GameLoop {
  readonly loop: FrameLoop;
  readonly sync: RenderSync;
}

export function createGameLoop<TCommand>(options: GameLoopOptions<TCommand>): GameLoop {
  const { world, sources, draw, sampleCommands, maxStepsPerFrame, simPaused } = options;
  const warn = options.warn ?? droppedTimeLogger();
  const sync = new RenderSync(world);
  const loop = createFrameLoop<TCommand>({
    sim: world,
    hz: world.clock.hz,
    ...sources,
    ...(sampleCommands && { sampleCommands }),
    ...(maxStepsPerFrame !== undefined && { maxStepsPerFrame }),
    ...(simPaused && { simPaused }),
    warn,
    onStep: (tick) => {
      sync.capture();
      options.onStep?.(tick);
    },
    render: (frame) => {
      sync.render(frame.alpha);
      draw(frame);
    },
  });
  return { loop, sync };
}
