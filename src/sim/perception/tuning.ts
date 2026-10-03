// Perception tuning (mw-e11.5): the numbers that turn what a sense picks up into a percept's strength
// and certainty, and how often and how cheaply agents perceive. Per-creature acuity (cone angles,
// ranges, dark vision, hearing threshold, special-sense reach) is the creature's sense profile
// (content `sense`, mw-e12.2); visibility weights (light, stance, motion, distance) are the stealth
// tuning (mw-e09.2). PLACEHOLDER values, to tune in play; moving them into content is mw-e11.16.

/** Every perception number (see the file header). */
export interface PerceptionTuning {
  /** Evaluations per second per agent; agents are staggered by entity id. */
  readonly rateHz: number;
  readonly sight: {
    /** Strength multiplier for a target in the peripheral cone (the primary cone is 1). */
    readonly peripheralWeight: number;
    /** Certainty of a sighting in the peripheral cone (the primary cone is 1). */
    readonly peripheralCertainty: number;
    /** The agent's eye height as a fraction of its nav agent height. */
    readonly eyeHeight: number;
    /** Eye height above the feet, metres, for an agent without a nav agent. */
    readonly defaultEyeHeight: number;
    /** The point of a target the cone test aims at, as a fraction of its height (chest). */
    readonly aimHeight: number;
    /** Metres behind the target, along the agent's sight line, where background light is read. */
    readonly backgroundDistance: number;
  };
  readonly hearing: {
    /** Strength of a sound heard exactly at the threshold. */
    readonly thresholdStrength: number;
    /** dB above the threshold at which a sound's strength reaches 1. */
    readonly fullAboveDb: number;
    /** Certainty of a sound that came through a doorway (where it came from is the doorway). */
    readonly portalCertainty: number;
    /** Certainty of a sound muffled by walls or floors on a straight route. */
    readonly muffledCertainty: number;
  };
  readonly special: {
    /** Horizontal speed, m/s, at or above which a target counts as moving. */
    readonly movingSpeed: number;
  };
  readonly touch: {
    /**
     * Metres beyond the agent's own radius within which a target's feet count as touching it, on the
     * ground plane (about a character capsule's radius plus a little skin).
     */
    readonly reach: number;
    /** Most metres between the agent's and the target's feet, vertically, for a touch. */
    readonly height: number;
  };
}

/** The shipped perception tuning (PLACEHOLDER). */
export const DEFAULT_PERCEPTION_TUNING: PerceptionTuning = Object.freeze({
  rateHz: 10,
  sight: Object.freeze({
    peripheralWeight: 0.5,
    peripheralCertainty: 0.5,
    eyeHeight: 0.9,
    defaultEyeHeight: 1.6,
    aimHeight: 2 / 3,
    backgroundDistance: 1.5,
  }),
  hearing: Object.freeze({
    thresholdStrength: 0.1,
    fullAboveDb: 30,
    portalCertainty: 0.6,
    muffledCertainty: 0.4,
  }),
  special: Object.freeze({ movingSpeed: 0.2 }),
  touch: Object.freeze({ reach: 0.5, height: 1 }),
});
