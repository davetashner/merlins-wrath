// The deterministic game rules (backlog contract §2). No DOM, renderer, wall clock or Math.random.
export const layer = 'sim' as const;

export { DEFAULT_TICK_RATE_HZ, SimClock, type ClockState, type ReadonlyClock } from './clock';
export {
  defineComponent,
  type ComponentOptions,
  type ComponentType,
  type EntityId,
} from './core/component';
export {
  DEFAULT_MAX_EVENTS_PER_FLUSH,
  defineEvent,
  EventBus,
  EventCycleError,
  type EventHandler,
  type EventType,
} from './core/events';
export { Query, type ComponentList, type ComponentValues } from './core/query';
export {
  World,
  type System,
  type TickContext,
  type WorldOptions,
  type WorldSnapshot,
} from './core/world';
export * as simMath from './math';
export { EmptyChoiceError, Rng, type RngState, type Weighted } from './rng';
