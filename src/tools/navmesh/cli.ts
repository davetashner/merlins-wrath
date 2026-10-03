// pnpm nav:bake / pnpm nav:check (mw-e11.4), run through scripts/nav-bake-cli.ts.
//
// nav:bake [scene…] bakes the named scenes (default: every scene that already has a navmesh) and
// writes the files that changed. nav:check re-bakes every committed navmesh and fails naming each
// one that is stale (its scene, kit, materials, doors or the bake changed since it was written).

import { bakedScenes, bakeScenes, type BakeOutcome } from './bake';

export interface CliIo {
  /** Repo root: content paths resolve against it. */
  readonly cwd: string;
  log(line: string): void;
  error(line: string): void;
  /** Milliseconds, for the bake time report (tools may read the clock; the sim never does). */
  now(): number;
}

export const defaultIo = (cwd: string): CliIo => ({
  cwd,
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
  now: () => performance.now(),
});

export const USAGE = `Usage:
  pnpm nav:bake [scene…]  Bake navmeshes into src/content/data/navmesh/<scene>.json
                          (default: every scene that already has one).
  pnpm nav:check          Fail when a committed navmesh is not what a bake gives now.`;

const summary = ({ path, data }: BakeOutcome): string =>
  `${path}: ${String(data.polys.length)} polygons, ${String(data.portals.length)} portals, ${String(data.links.length)} links`;

function bake(io: CliIo, scenes: readonly string[]): number {
  const ids = scenes.length > 0 ? scenes : bakedScenes(io.cwd);
  if (ids.length === 0) {
    io.error('No scenes to bake: name one, e.g. pnpm nav:bake testbed');
    return 1;
  }
  const start = io.now();
  const outcomes = bakeScenes(io.cwd, ids, true);
  const ms = io.now() - start;
  for (const outcome of outcomes) {
    io.log(`${outcome.current ? 'unchanged' : 'wrote'} ${summary(outcome)}`);
  }
  io.log(`baked ${String(outcomes.length)} navmesh(es) in ${ms.toFixed(0)} ms`);
  return 0;
}

function check(io: CliIo): number {
  const stale = bakeScenes(io.cwd, bakedScenes(io.cwd), false).filter((o) => !o.current);
  for (const { path } of stale) io.error(`${path} is stale: run pnpm nav:bake and commit it`);
  if (stale.length > 0) return 1;
  io.log('navmeshes are up to date');
  return 0;
}

/** Runs `bake` or `check`; returns the process exit code. */
export function main(args: readonly string[], io: CliIo = defaultIo(process.cwd())): number {
  const [command, ...rest] = args;
  if (command === 'bake') return bake(io, rest);
  if (command === 'check' && rest.length === 0) return check(io);
  if (command === '--help' || command === '-h') {
    io.log(USAGE);
    return 0;
  }
  io.error(USAGE);
  return 2;
}
