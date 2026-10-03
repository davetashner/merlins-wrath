// Special senses (mw-e11.5): one handler per special-sense channel, looked up by the channel names a
// sense profile uses (content SPECIAL_SENSE_CHANNELS: tremor, life-sense, magic-sense). A creature's
// profile says how far each of its channels reaches, how weak a signal it registers, and whether
// walls block it or it only senses movement; the handler turns that into percepts. A new channel is a
// new handler registered here and an entry in content; neither the profile shape nor the perception
// system changes.
//
// The default registry has the presence handler for `life-sense` (the undead feel the warmth of the
// living) and `tremor` (feeling footsteps through the ground): every target within range, moving when
// the profile requires movement, with clear sight when the profile requires line of sight, at
// strength 1 − distance / range (× the sight line's visibility when required), reported when that is
// at least the profile's minStrength, as a `sensed-life` percept at the target's feet with certainty
// equal to its strength. `magic-sense` has no handler until magic sources exist (mw-e11.24); a
// channel without a handler senses nothing.

import type { Frozen, SenseProfile } from '@content/index';
import type { Vec3 } from '../stimulus/shapes';
import { percept, type Percept, type PerceptKind, type PerceptSource } from './percept';
import { pointDistance } from './sight';
import type { PerceptionTuning } from './tuning';

/** One special-sense channel of a sense profile. */
export type SpecialSense = Frozen<NonNullable<SenseProfile['special']>[string]>;

/** What a special sense may know about a target (already sampled; never the entity). */
export interface SenseTarget {
  readonly source: PerceptSource;
  readonly feet: Vec3;
  /** The point sight lines aim at (its chest). */
  readonly centre: Vec3;
  /** Horizontal speed, m/s. */
  readonly speed: number;
}

/** What a special-sense handler is given for one agent and one channel. */
export interface SpecialSenseContext {
  readonly channel: string;
  /** The agent's settings for this channel. */
  readonly sense: SpecialSense;
  /** The agent's eye. */
  readonly eye: Vec3;
  /** The targets perception considers, in a fixed order. */
  readonly targets: readonly SenseTarget[];
  /** Visibility of the sight line `from`→`to`, 0–1; each call costs one work unit. */
  readonly lineOfSight: (from: Vec3, to: Vec3) => number;
  readonly tuning: PerceptionTuning;
}

/** Turns one channel's reach into percepts. Must be deterministic and must not read the world. */
export type SpecialSenseHandler = (context: SpecialSenseContext) => readonly Percept[];

/** Special-sense handlers by channel name. */
export class SenseChannelRegistry {
  private readonly handlers = new Map<string, SpecialSenseHandler>();

  /**
   * Registers `handler` for `channel`.
   * @throws Error when the channel already has a handler.
   */
  register(channel: string, handler: SpecialSenseHandler): this {
    if (this.handlers.has(channel)) {
      throw new Error(`special sense channel "${channel}" already has a handler`);
    }
    this.handlers.set(channel, handler);
    return this;
  }

  /** The handler of `channel`, or undefined when none is registered. */
  handler(channel: string): SpecialSenseHandler | undefined {
    return this.handlers.get(channel);
  }

  /** Channels with a handler, in registration order. */
  get channels(): readonly string[] {
    return [...this.handlers.keys()];
  }
}

/** The presence handler (see the file header), producing percepts of `kind`. */
export function presenceSense(kind: PerceptKind = 'sensed-life'): SpecialSenseHandler {
  return ({ channel, sense, eye, targets, lineOfSight, tuning }) => {
    const found: Percept[] = [];
    for (const target of targets) {
      const distance = pointDistance(eye, target.centre);
      if (distance > sense.range) continue;
      if (sense.requiresMovement && target.speed < tuning.special.movingSpeed) continue;
      let strength = sense.range > 0 ? 1 - distance / sense.range : 1;
      if (sense.requiresLineOfSight) strength *= lineOfSight(eye, target.centre);
      if (!(strength > 0) || strength < sense.minStrength) continue;
      found.push(
        percept({
          source: target.source,
          kind,
          sense: channel,
          position: target.feet,
          strength,
          certainty: strength,
        }),
      );
    }
    return found;
  };
}

/** A registry with the shipped handlers: presence for `life-sense` and `tremor`. */
export function defaultSenseChannels(): SenseChannelRegistry {
  return new SenseChannelRegistry()
    .register('life-sense', presenceSense())
    .register('tremor', presenceSense());
}
