// mw-e04.8 AC-5: the attacker dummy swings once at a knight who rolls through it. Pressed on time,
// the roll's last i-frame (move tick 14) meets the swing's first sweep and it is dodged; pressed one
// tick early, the i-frames end the tick before and the swing lands. Both are goldens (a state hash
// on every tick), and each replays 100 times to identical hashes.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ActionStarted,
  DamageApplied,
  DodgeComponent,
  DodgedHit,
  healthOf,
  HitboxHit,
  playReplay,
  type ActionStartInfo,
  type DamageResult,
  type HitboxHitInfo,
} from '@sim/index';
import {
  createDodgeTimingWorld,
  DODGE_PRESS,
  dodgeEarlyScenario,
  dodgeOnTimeScenario,
  dodgeTimingLog,
  FIRST_SWEEP_TICK,
} from '@tools/replay/dodge-timing-scenario';
import { currentContentHash, GOLDEN_REPLAY_DIR, readReplay } from '@tools/replay/files';

/** Runs a variant live and records what the knight went through. */
function outcome(pressTick: number) {
  const world = createDodgeTimingWorld({ seed: 1, hz: 60 });
  const [knight] = world.query(DodgeComponent).ids();
  if (knight === undefined) throw new Error('no knight');
  const started: ActionStartInfo[] = [];
  const hits: HitboxHitInfo[] = [];
  const dodged: HitboxHitInfo[] = [];
  const damage: DamageResult[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  world.events.on(HitboxHit, (e) => hits.push(e));
  world.events.on(DodgedHit, (e) => dodged.push(e));
  world.events.on(DamageApplied, (e) => damage.push(e));
  for (const frame of dodgeTimingLog(pressTick)) world.step([frame]);
  return { world, knight, started, hits, dodged, damage };
}

/** 100 replays take ~3 s alone but far longer on a loaded runner: allow a minute. */
const REPLAY_TIMEOUT_MS = 60_000;

const variants = [
  { file: 'dodge-on-time.json', scenario: dodgeOnTimeScenario },
  { file: 'dodge-early.json', scenario: dodgeEarlyScenario },
] as const;

describe('dodge timing replays (mw-e04.8)', () => {
  it('AC-5: on time the roll dodges the swing; one tick early the swing lands', () => {
    const onTime = outcome(DODGE_PRESS.onTime);
    expect(onTime.started.map((e) => [e.tick, e.move])).toEqual([
      [30, 'training-dummy-swing'],
      [DODGE_PRESS.onTime, 'dodge-roll'],
    ]);
    expect(onTime.dodged.map((h) => [h.tick, h.target])).toEqual([
      [FIRST_SWEEP_TICK, onTime.knight],
    ]);
    expect(onTime.hits).toEqual([]);
    expect(onTime.damage).toEqual([]);
    expect(healthOf(onTime.world, onTime.knight)?.current).toBe(100);

    const early = outcome(DODGE_PRESS.early);
    expect(early.dodged).toEqual([]);
    expect(early.hits.map((h) => [h.tick, h.target])).toEqual([[FIRST_SWEEP_TICK, early.knight]]);
    expect(early.damage.map((d) => [d.tick, d.total, d.poiseDamage])).toEqual([
      [FIRST_SWEEP_TICK, 15, 15],
    ]);
    expect(healthOf(early.world, early.knight)?.current).toBe(85);
  });

  it.each(variants)(
    'AC-5: $file is recorded on every tick and replays 100 times to identical hashes',
    ({ file, scenario }) => {
      const replay = readReplay(join(GOLDEN_REPLAY_DIR, file));
      expect(replay.scenario).toBe(scenario.name);
      expect(replay.checkpointInterval).toBe(1);
      expect(replay.checkpoints).toHaveLength(replay.ticks + 1);
      const contentHash = currentContentHash();
      const finals = new Set<string>();
      for (let run = 0; run < 100; run++) {
        const result = playReplay(replay, scenario, { contentHash });
        expect(result.status).toBe('passed');
        if (result.status === 'passed') finals.add(result.finalHash);
      }
      expect(finals.size).toBe(1);
    },
    REPLAY_TIMEOUT_MS,
  );

  it('AC-5: the two goldens diverge exactly where the outcomes do', () => {
    const [onTime, early] = variants.map(({ file }) => readReplay(join(GOLDEN_REPLAY_DIR, file)));
    if (onTime === undefined || early === undefined) throw new Error('missing golden');
    const differ = onTime.checkpoints.findIndex(
      (checkpoint, i) => checkpoint.hash !== early.checkpoints[i]?.hash,
    );
    // They differ from the early press on, and are identical before it.
    expect(differ).toBeGreaterThan(0);
    expect(onTime.checkpoints[differ]?.tick).toBe(DODGE_PRESS.early + 1);
  });
});
