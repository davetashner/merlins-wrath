// The player's death (mw-e01.8): everything between the damage model's Died and the death screen.
// When the player's Died arrives (e04-damage-model), the death is resolved against the respawn rules
// (rules.ts) for the region the player is in, the winning rule's facts are written, the player gets a
// PlayerDeath and exactly one `player.died` event goes out with where the player fell and who killed
// it. From the next tick the player's ActionFrames are ignored (an input filter on the world), so the
// body lies still while the world goes on. The death beat lasts `beatSeconds` of sim time, counted in
// ticks; when it is over `player.death-beat-ended` hands off to the death screen (e30-death-reload,
// src/game/save/death), which owns the reload. `player.respawned` is announced once the player is
// back in play (after a reload, by the game once the save has loaded). The camera pull-back and fade
// over the beat are presentation (src/game/player/death-beat.ts); they read PlayerDeath.

import { Died } from '../combat/damage/events';
import { CharacterController } from '../character/system';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { isActionFrame } from '../input/action-frame';
import type { Vec3 } from '../stimulus/shapes';
import type { RespawnDestination, RespawnMode, RespawnRules } from './rules';

/** The death beat's length (the bead's 1.5 s) when content does not say. */
export const DEFAULT_DEATH_BEAT_SECONDS = 1.5;

/** A dead player: present from the end of the tick it died in until the world is rebuilt. */
export interface PlayerDeathState {
  /** The tick Died was emitted. */
  readonly tick: number;
  readonly killer: EntityId | null;
  /** Feet position when it died; null when the player has no character controller. */
  readonly position: Vec3 | null;
  /** The respawn rule that applies (null: the fallback). */
  readonly rule: string | null;
  readonly mode: RespawnMode;
  readonly destination: RespawnDestination | null;
  /** The tick the death beat ends and the death screen takes over. */
  readonly handoffTick: number;
  /** The beat has ended (player.death-beat-ended was emitted). */
  readonly handedOff: boolean;
}

export const PlayerDeath = defineComponent<PlayerDeathState>('player.death');

/** Payload of `player.died` (telemetry-ready: plain data). */
export interface PlayerDied {
  readonly tick: number;
  readonly player: EntityId;
  readonly killer: EntityId | null;
  readonly source: EntityId | null;
  /** The killing hit's tags (e.g. `environment`, `debug`). */
  readonly tags: readonly string[];
  readonly position: Vec3 | null;
  readonly region: string;
  readonly rule: string | null;
  readonly mode: RespawnMode;
  /** The tick the death beat ends (player.death-beat-ended). */
  readonly handoffTick: number;
}

/** The player died; emitted exactly once per death, in the tick of its Died. */
export const playerDied = defineEvent<PlayerDied>('player.died');

/** Payload of `player.death-beat-ended`. */
export interface PlayerDeathBeatEnded {
  readonly tick: number;
  readonly player: EntityId;
  readonly rule: string | null;
  readonly mode: RespawnMode;
  readonly destination: RespawnDestination | null;
}

/** The death beat is over: the death screen (or a wake-in-place) takes over. */
export const playerDeathBeatEnded = defineEvent<PlayerDeathBeatEnded>('player.death-beat-ended');

/** Payload of `player.respawned` (telemetry-ready: plain data). */
export interface PlayerRespawned {
  readonly tick: number;
  readonly player: EntityId;
  readonly mode: RespawnMode;
  /** The rule that sent the player back; null for the fallback or when unknown. */
  readonly rule: string | null;
  /** The save slot a reload loaded; null when none. */
  readonly slot: string | null;
}

/** The player is back in play after a death. */
export const playerRespawned = defineEvent<PlayerRespawned>('player.respawned');

export interface PlayerDeathOptions {
  readonly player: EntityId;
  /** The region (scene id) the player is in. */
  readonly region: string;
  readonly rules: RespawnRules;
  /** Sim seconds from Died to the hand-off; defaults to DEFAULT_DEATH_BEAT_SECONDS. */
  readonly beatSeconds?: number;
  /** Hears content warnings (no rule for the region). */
  readonly warn?: (message: string) => void;
}

/** Whole ticks the beat lasts at `hz` (rounded to the nearest tick). */
export function deathBeatTicks(beatSeconds: number, hz: number): number {
  if (!Number.isFinite(beatSeconds) || beatSeconds < 0) {
    throw new RangeError(`the death beat must be 0 s or longer, got ${String(beatSeconds)}`);
  }
  return Math.round(beatSeconds * hz);
}

/** How far through its death beat the player is at `tick` (0–1); undefined while alive. */
export function deathBeatProgress<TInput>(
  world: World<TInput>,
  player: EntityId,
  tick: number = world.tick,
): number | undefined {
  if (!world.isRegistered(PlayerDeath)) return undefined;
  const state = world.get(player, PlayerDeath);
  if (state === undefined) return undefined;
  const length = state.handoffTick - state.tick;
  if (length <= 0) return 1;
  return Math.min(1, Math.max(0, (tick - state.tick) / length));
}

/** True while the player is dead (from the tick after its Died). */
export function isPlayerDead<TInput>(world: World<TInput>, player: EntityId): boolean {
  return world.isRegistered(PlayerDeath) && world.has(player, PlayerDeath);
}

/**
 * Wires the player's death into `world` (see the file header): registers PlayerDeath, listens for
 * the player's Died, ignores its ActionFrames while it is dead and adds the death-beat system. Once
 * per world, between steps.
 * @throws RangeError for a negative or non-finite beat.
 */
export function installPlayerDeath<TInput>(
  world: World<TInput>,
  options: PlayerDeathOptions,
): void {
  const { player, region, rules, warn } = options;
  const beat = deathBeatTicks(options.beatSeconds ?? DEFAULT_DEATH_BEAT_SECONDS, world.clock.hz);
  world.register(PlayerDeath);
  world.events.on(Died, (death) => {
    if (death.target !== player || world.has(player, PlayerDeath)) return;
    const resolution = rules.resolve({ region, facts: world.facts }, warn);
    for (const { fact, value } of resolution.factsToSet) world.facts.set(fact, value);
    const position = world.isRegistered(CharacterController)
      ? (world.get(player, CharacterController)?.position ?? null)
      : null;
    world.add(player, PlayerDeath, {
      tick: death.tick,
      killer: death.killer,
      position,
      rule: resolution.rule,
      mode: resolution.mode,
      destination: resolution.destination,
      handoffTick: death.tick + beat,
      handedOff: false,
    });
    world.events.emit(playerDied, {
      tick: death.tick,
      player,
      killer: death.killer,
      source: death.source,
      tags: death.tags,
      position,
      region,
      rule: resolution.rule,
      mode: resolution.mode,
      handoffTick: death.tick + beat,
    });
  });
  // A dead player's input is ignored: its ActionFrames never reach the systems. Everything else
  // (debug commands, fact and difficulty commands) still does.
  world.addInputFilter({
    name: 'dead-player-input',
    keep: (input, w) => !isActionFrame(input) || !w.has(player, PlayerDeath),
  });
  world.addSystem({
    name: 'player-death-beat',
    run: ({ world: w, tick }) => {
      const state = w.get(player, PlayerDeath);
      if (state === undefined || state.handedOff || tick < state.handoffTick) return;
      w.set(player, PlayerDeath, { ...state, handedOff: true });
      w.events.emit(playerDeathBeatEnded, {
        tick,
        player,
        rule: state.rule,
        mode: state.mode,
        destination: state.destination,
      });
    },
  });
}

/**
 * Announces that the player is back in play after a death (`player.respawned`), delivered at the
 * next phase boundary. The game calls it once a death's reload has loaded its save.
 */
export function announceRespawn<TInput>(
  world: World<TInput>,
  respawn: Omit<PlayerRespawned, 'tick'>,
): void {
  world.events.emit(playerRespawned, { tick: world.tick, ...respawn });
}
