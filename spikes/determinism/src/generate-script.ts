// Regenerates input-script.json (committed). Deterministic: integer LCG, values rounded to 1e-3 so the
// JSON round-trips exactly. Run: node src/generate-script.ts
import { writeFileSync } from 'node:fs';
import { BODY_COUNT, PHYSICS_DT, PILLAR_HALF, PILLARS, ROOM, bodySpawns } from '../../shared/scene-config.ts';
import type { InputScript, ScriptImpulse } from './script.ts';

let seed = 20260928;
const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

const impulses: ScriptImpulse[] = [];
for (let step = 0; step < 600; step++) {
  // Bursts every 45 steps plus sparse single kicks, so contacts, stacking and sleeping/waking all happen.
  const count = step % 45 === 0 && step > 0 ? 12 : next() < 0.15 ? 1 : 0;
  for (let k = 0; k < count; k++) {
    impulses.push({
      step,
      body: Math.floor(next() * BODY_COUNT),
      impulse: [r3((next() - 0.5) * 8), r3(3 + next() * 7), r3((next() - 0.5) * 8)],
      torque: [r3((next() - 0.5) * 2), r3((next() - 0.5) * 2), r3((next() - 0.5) * 2)],
    });
  }
}

const t = ROOM.wallThickness / 2;
const h = ROOM.wallHeight / 2;
const script: InputScript = {
  version: 1,
  description:
    'mw-e00.13 AC-2: 200 dynamic bodies (boxes + cylinders) in the benchmark room, 600 fixed steps of 1/60 s, scripted impulses and torque impulses; snapshot at step 300.',
  steps: 600,
  dt: PHYSICS_DT,
  gravity: [0, -9.81, 0],
  snapshotAt: 300,
  checkpointEvery: 60,
  statics: [
    { half: [ROOM.halfX, 0.5, ROOM.halfZ], at: [0, -0.5, 0] },
    { half: [ROOM.halfX, h, t], at: [0, h, -ROOM.halfZ - t] },
    { half: [ROOM.halfX, h, t], at: [0, h, ROOM.halfZ + t] },
    { half: [t, h, ROOM.halfZ], at: [-ROOM.halfX - t, h, 0] },
    { half: [t, h, ROOM.halfZ], at: [ROOM.halfX + t, h, 0] },
    ...PILLARS.map(([x, z]) => ({ half: [PILLAR_HALF.x, PILLAR_HALF.y, PILLAR_HALF.z] as [number, number, number], at: [x, PILLAR_HALF.y, z] as [number, number, number] })),
  ],
  bodies: bodySpawns(),
  impulses,
};
writeFileSync(new URL('../input-script.json', import.meta.url), JSON.stringify(script, null, 1) + '\n');
console.log(`wrote input-script.json: ${String(script.steps)} steps, ${String(impulses.length)} impulses`);
