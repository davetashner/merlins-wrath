// The deterministic game rules (backlog contract §2). No DOM, renderer, wall clock or Math.random.
export const layer = 'sim' as const;

export { DEFAULT_TICK_RATE_HZ, SimClock, type ClockState, type ReadonlyClock } from './clock';
export { EmptyChoiceError, Rng, type RngState, type Weighted } from './rng';
