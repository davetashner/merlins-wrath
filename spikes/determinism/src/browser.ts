// Browser entry: runs every engine on the committed script and publishes results on window.__determinism.
import RDet from '@dimforge/rapier3d-deterministic-compat';
import RStd from '@dimforge/rapier3d-compat';
import HavokPhysics from '@babylonjs/havok';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import scriptJson from '../input-script.json';
import { HAVOK_VERSION } from './engines.ts';
import { runHavok } from './run-havok.ts';
import { runRapier } from './run-rapier.ts';
import type { InputScript, RunResult } from './script.ts';

const state: Window['__determinism'] = { done: false, results: [], errors: [], userAgent: navigator.userAgent };
window.__determinism = state;
const script = scriptJson as unknown as InputScript;

async function main(): Promise<void> {
  const tasks: [string, () => Promise<RunResult>][] = [
    ['rapier-deterministic', () => runRapier(RDet, 'rapier-deterministic', script)],
    ['rapier-standard', () => runRapier(RStd as unknown as typeof RDet, 'rapier-standard', script)],
    ['havok', async () => runHavok(await HavokPhysics({ locateFile: () => havokWasmUrl }), HAVOK_VERSION, script)],
  ];
  for (const [name, task] of tasks) {
    try {
      state.results.push(await task());
    } catch (e) {
      state.errors.push(`${name}: ${String(e)}`);
    }
  }
  document.getElementById('out')!.textContent = JSON.stringify(state, null, 2);
  state.done = true;
  // Browsers the harness cannot drive (stock Firefox, Safari) are opened with ?report and post back.
  if (new URLSearchParams(location.search).has('report')) {
    await fetch('/__report', { method: 'POST', body: JSON.stringify(state) });
    document.title = 'done — you can close this window';
  }
}

void main();
