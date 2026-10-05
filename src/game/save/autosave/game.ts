// The running game's autosave (mw-e01.7): the scheduler (mw-e30.5) wired to a world. Built once per
// world, after the scene, with what that scene asks for:
//
// - checkpoints: entering a trigger volume the scene marks as a checkpoint requests a `checkpoint`
//   autosave (the slice's CP-1 and CP-2, via `sceneCheckpoints`);
// - milestones: a fact turning true requests a `quest` autosave (the slice's `slice.complete`, so
//   finishing the slice is saved);
// - rests: finishing a rest (`rest.completed`, mw-ju8.6) requests a `rest` autosave, once;
// - vetoes: systems' "not safe now" checks (the creatures' combat veto), so a request made mid-fight
//   waits until the fight is over.
//
// The game loop calls `afterStep` after every sim step; the scheduler decides whether this is the
// moment (a request waiting, every veto quiet, the minimum gap passed) and writes into the autosave
// ring in the background. `reset` after loading a save forgets requests made before it. Every attempt
// is published (the e2e reads #app[data-autosave]); a write that failed twice is a warning, never a
// blocking error.

import { factChanged, restCompleted, type VolumeCrossing, type World } from '@sim/index';
import type { SaveSlots } from '../slots/index';
import { autosaveAtCheckpoints } from './checkpoints';
import {
  AutosaveScheduler,
  type AutosaveEvent,
  type AutosaveInput,
  type AutosaveSchedulerOptions,
} from './scheduler';
import type { SafetyVeto } from './vetoes';

/** What the game's autosave is wired to. */
export interface GameAutosaveOptions {
  readonly world: World<never>;
  readonly slots: SaveSlots;
  /** Describes the save being made (character, class, area, thumbnail capture). */
  readonly describe: () => AutosaveInput;
  /** Which entered volumes are checkpoints; none when omitted. */
  readonly isCheckpoint?: (crossing: VolumeCrossing) => boolean;
  /** Facts whose turning true requests an autosave, e.g. `slice.complete`. */
  readonly milestones?: readonly string[];
  /** Safety vetoes by id, e.g. `{ combat: combatVeto(world) }`. */
  readonly vetoes?: Readonly<Record<string, SafetyVeto>>;
  /** Scheduler timings in place of the defaults (tests). */
  readonly timing?: Pick<AutosaveSchedulerOptions, 'intervalSeconds' | 'minGapSeconds'>;
  /** Hears every attempt (the HUD and the e2e readout). */
  readonly publish?: (event: AutosaveEvent) => void;
  readonly warn?: (message: string) => void;
}

/** What #app[data-autosave] carries for an autosave event. */
export interface AutosaveReadout {
  readonly type: AutosaveEvent['type'];
  readonly kind: string;
  readonly source: string | null;
  readonly slot: string | null;
}

/** The readout of `event`. */
export function autosaveReadout(event: AutosaveEvent): AutosaveReadout {
  return {
    type: event.type,
    kind: event.trigger.kind,
    source: event.trigger.source ?? null,
    slot: event.slot,
  };
}

/** The game's autosave over one world (see the file header). */
export class GameAutosave {
  readonly scheduler: AutosaveScheduler;
  private readonly stops: (() => void)[] = [];

  constructor(private readonly options: GameAutosaveOptions) {
    const { world, slots, describe, isCheckpoint, milestones = [], vetoes = {} } = options;
    this.scheduler = new AutosaveScheduler({ slots, describe, ...options.timing });
    for (const [id, veto] of Object.entries(vetoes)) {
      this.stops.push(this.scheduler.vetoes.register(id, veto));
    }
    if (isCheckpoint !== undefined) {
      this.stops.push(autosaveAtCheckpoints(world.events, this.scheduler, isCheckpoint));
    }
    if (milestones.length > 0) {
      this.stops.push(
        world.events.on(factChanged, (change) => {
          if (change.new === true && milestones.includes(change.key)) {
            this.scheduler.request({ kind: 'quest', source: change.key });
          }
        }),
      );
    }
    this.stops.push(
      world.events.on(restCompleted, ({ point }) => {
        this.scheduler.request({ kind: 'rest', source: point });
      }),
    );
    this.stops.push(
      this.scheduler.subscribe((event) => {
        options.publish?.(event);
        if (event.type === 'failed' && !event.retrying) {
          options.warn?.(`autosave (${event.trigger.kind}) failed: ${String(event.error)}`);
        }
      }),
    );
  }

  /** Called after every sim step: writes an autosave if one is due and it is safe. */
  afterStep(): Promise<AutosaveEvent | null> {
    return this.scheduler.update(this.options.world);
  }

  /** Forgets waiting requests (call after loading a save into the world). */
  reset(): void {
    this.scheduler.reset(this.options.world);
  }

  /** Stops listening to the world and removes the vetoes. */
  stop(): void {
    for (const stop of this.stops.splice(0)) stop();
  }
}
