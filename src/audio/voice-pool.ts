// Voice budget (mw-e28.1): browsers and the hardware baseline cap concurrent sources (48 on High,
// 24 on Low), so when the pool is full a new sound must either steal a less important voice or be
// rejected. Pure logic, kept apart from the Web Audio plumbing so the rule is easy to test.

/** Maximum simultaneous voices per quality tier. */
export const MAX_VOICES = { high: 48, low: 24 } as const;

/** What the pool needs to know about a playing voice or a new request. */
export interface VoiceRank {
  /** 0–100, higher is more important. */
  readonly priority: number;
  /** Metres from the listener (0 for 2D sounds). */
  readonly distance: number;
  /** Start order; older voices lose ties. */
  readonly seq: number;
}

/**
 * The voice to steal for `incoming` when the pool is full, or `undefined` to reject it.
 *
 * The candidate is the lowest-priority voice, the farthest among those, the oldest among those. It
 * is stolen when the request outranks it: higher priority, or equal priority and strictly closer.
 */
export function pickVictim<V extends VoiceRank>(
  voices: Iterable<V>,
  incoming: Omit<VoiceRank, 'seq'>,
): V | undefined {
  let victim: V | undefined;
  for (const voice of voices) {
    if (!victim || weaker(voice, victim)) victim = voice;
  }
  if (!victim) return undefined;
  const outranks =
    incoming.priority > victim.priority ||
    (incoming.priority === victim.priority && incoming.distance < victim.distance);
  return outranks ? victim : undefined;
}

function weaker(a: VoiceRank, b: VoiceRank): boolean {
  if (a.priority !== b.priority) return a.priority < b.priority;
  if (a.distance !== b.distance) return a.distance > b.distance;
  return a.seq < b.seq;
}
