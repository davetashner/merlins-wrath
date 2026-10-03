// The death beat in the game (mw-e01.8): the presentation of the sim's player death
// (src/sim/respawn). Each drawn frame it reads how far through the beat the player is (sim ticks,
// interpolated by the frame's alpha, so the timing is the sim's and never the wall clock's) and pulls
// the orbit camera back and fades the screen to match. When the sim ends the beat it hands off: a
// `reload` rule opens the death screen (e30-death-reload, src/game/save/death). `wake-in-place` is
// e01-contextual-respawn (mw-e01.12); until then such a rule warns and reloads instead. It also turns
// the respawn-rules content into the sim's rule table and publishes what the e2e reads.

import type { RespawnRulesEntry } from '@content/index';
import {
  deathBeatProgress,
  PlayerDeath,
  playerDeathBeatEnded,
  playerDied,
  type EntityId,
  type PlayerDeathBeatEnded,
  type RespawnMode,
  type RespawnRule,
  type Vec3,
  type World,
} from '@sim/index';

/** The sim's rule table from the respawn-rules content (refs resolved to ids). */
export function respawnRulesFrom(entry: RespawnRulesEntry): RespawnRule[] {
  return entry.rules.map((rule) => ({
    id: rule.id,
    region: rule.region.id,
    priority: rule.priority,
    conditions: rule.conditions,
    destination: { scene: rule.destination.scene.id, spawn: rule.destination.spawn },
    mode: rule.mode,
    factsToSet: rule.factsToSet,
  }));
}

/** What the beat moves on screen. */
export interface DeathBeatView {
  /** 0 (alive) to 1 (end of the beat). */
  pullBack(fraction: number): void;
  /** The beat's progress, or null while the player is alive. */
  fade(progress: number | null): void;
}

/** What the e2e reads (#app[data-player-death]). */
export interface DeathBeatReadout {
  /** The tick the player died (player.died). */
  readonly tick: number;
  readonly killer: EntityId | null;
  readonly position: Vec3 | null;
  readonly rule: string | null;
  readonly mode: RespawnMode;
  /** The tick the sim will end the beat. */
  readonly handoffTick: number;
  /** The tick the beat ended (player.death-beat-ended), or null while it runs. */
  readonly endedAt: number | null;
}

export interface DeathBeatOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly view: DeathBeatView;
  /** The beat is over: open the death screen. */
  readonly onReload: (end: PlayerDeathBeatEnded) => void;
  readonly publish?: (readout: DeathBeatReadout) => void;
  readonly warn?: (message: string) => void;
}

/** Drives the death beat's camera and fade, and hands off when the sim ends it. */
export class DeathBeat {
  private readonly unsubscribe: (() => void)[];
  private readout: DeathBeatReadout | undefined;
  private shown = false;

  constructor(private readonly options: DeathBeatOptions) {
    const { world, player } = options;
    this.unsubscribe = [
      world.events.on(playerDied, (death) => {
        if (death.player !== player) return;
        this.publish({
          tick: death.tick,
          killer: death.killer,
          position: death.position,
          rule: death.rule,
          mode: death.mode,
          handoffTick: death.handoffTick,
          endedAt: null,
        });
      }),
      world.events.on(playerDeathBeatEnded, (end) => {
        if (end.player !== player) return;
        if (this.readout !== undefined) this.publish({ ...this.readout, endedAt: end.tick });
        if (end.mode === 'wake-in-place') {
          options.warn?.(
            `respawn rule ${String(end.rule)}: wake-in-place is not supported yet (mw-e01.12); reloading`,
          );
        }
        options.onReload(end);
      }),
    ];
  }

  /**
   * Each drawn frame, after the sim steps: places the camera pull-back and the fade for the beat's
   * progress at the drawn moment (`alpha` of the way from the last tick to the next).
   */
  frame(alpha = 1): void {
    const { world, player, view } = this.options;
    // After N steps the latest tick simulated is N − 1; render sync draws `alpha` of the way from
    // the one before it to that one.
    // Once the beat has ended it stays at its end, however the frame's alpha falls.
    const progress = world.get(player, PlayerDeath)?.handedOff
      ? 1
      : deathBeatProgress(world, player, world.tick - 2 + alpha);
    if (progress === undefined) {
      if (!this.shown) return;
      this.shown = false;
      view.pullBack(0);
      view.fade(null);
      return;
    }
    this.shown = true;
    view.pullBack(progress);
    view.fade(progress);
  }

  /** Stops listening to the sim. */
  dispose(): void {
    for (const off of this.unsubscribe) off();
  }

  private publish(readout: DeathBeatReadout): void {
    this.readout = readout;
    this.options.publish?.(readout);
  }
}
