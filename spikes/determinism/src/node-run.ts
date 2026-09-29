// Same script in Node (V8 outside a browser) as an extra reference point. Run: node src/node-run.ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import RDet from '@dimforge/rapier3d-deterministic-compat';
import RStd from '@dimforge/rapier3d-compat';
import HavokPhysics from '@babylonjs/havok';
import { Logger } from '@babylonjs/core/Misc/logger.js';
import { HAVOK_VERSION } from './engines.ts';
import { runHavok } from './run-havok.ts';
import { runRapier } from './run-rapier.ts';
import type { InputScript, RunResult } from './script.ts';

const script = JSON.parse(readFileSync(new URL('../input-script.json', import.meta.url), 'utf8')) as InputScript;
const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'));
Logger.LogLevels = Logger.NoneLogLevel; // keep stdout pure JSON
const results: RunResult[] = [
  await runRapier(RDet, 'rapier-deterministic', script),
  await runRapier(RStd as unknown as typeof RDet, 'rapier-standard', script),
  runHavok(await HavokPhysics({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer }), HAVOK_VERSION, script),
];
console.log(JSON.stringify({ runtime: `node ${process.version}`, results }, null, 2));
