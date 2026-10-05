// The minimum world day clock (mw-ju8.6). THIN SLICE, flagged: the real in-game clock (mw-e27.12:
// tick-derived time, phases, schedules, pause rules, `advanceTime(duration, reason)`) does not exist
// yet, but resting at an inn has to pass time "to morning". So the day and the minute of the day are
// two world facts (`time.day`, `time.minute`; declared in src/content/data/fact/time.json), which
// makes them deterministic, snapshot-hashed and saved with the world-facts section for free.
//
// What this is NOT: it never advances with sim ticks, has no phases, no events and no schedules.
// Time moves only through `advanceClock`, which today only resting calls. mw-e27.12 replaces the
// facts' writer with the real clock and keeps these keys (or migrates them with `renamedFrom`).

import type { FactSpec, FactStore } from '../facts/store';

/** Minutes in a day. */
export const MINUTES_PER_DAY = 24 * 60;
/** The minute of the day a rested player wakes: 06:00. */
export const MORNING_MINUTE = 6 * 60;
/** The minute of the day a new world starts: 08:00. */
export const START_MINUTE = 8 * 60;

/** Fact key of the day number (1 on the first day). */
export const DAY_FACT = 'time.day';
/** Fact key of the minute of the day, 0-1439. */
export const MINUTE_FACT = 'time.minute';

/** The facts the clock keeps, as the fact registry declares them (src/content/data/fact/time.json). */
export const DAY_CLOCK_FACTS: Readonly<Record<string, FactSpec>> = Object.freeze({
  [DAY_FACT]: { type: 'int', default: 1 },
  [MINUTE_FACT]: { type: 'int', default: START_MINUTE },
});

/** A moment: the day number and the minute of that day. */
export interface TimeOfDay {
  readonly day: number;
  readonly minute: number;
}

/** Where rest reads and writes the time. */
export interface DayClock {
  now(): TimeOfDay;
  set(time: TimeOfDay): void;
}

/** The day clock kept in a world's facts (the declarations must be on the store). */
export function factDayClock(facts: FactStore): DayClock {
  return {
    now: () => ({
      day: Number(facts.get(DAY_FACT) ?? 1),
      minute: Number(facts.get(MINUTE_FACT) ?? START_MINUTE),
    }),
    set: (time) => {
      facts.set(DAY_FACT, time.day);
      facts.set(MINUTE_FACT, time.minute);
    },
  };
}

/** `time` moved on by a whole number of `minutes` (day rolls over at midnight). */
export function addMinutes(time: TimeOfDay, minutes: number): TimeOfDay {
  const total = time.minute + minutes;
  return {
    day: time.day + Math.floor(total / MINUTES_PER_DAY),
    minute: total % MINUTES_PER_DAY,
  };
}

/**
 * Minutes from `time` to the next morning (06:00). Before 06:00 it is this day's morning; at or after
 * it, tomorrow's, so it is always between 1 and 1440.
 */
export function minutesUntilMorning(time: TimeOfDay): number {
  const wait = (MORNING_MINUTE - time.minute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return wait === 0 ? MINUTES_PER_DAY : wait;
}

/** "07:05": a time of day for display. */
export function clockText(time: TimeOfDay): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(Math.floor(time.minute / 60))}:${two(time.minute % 60)}`;
}
