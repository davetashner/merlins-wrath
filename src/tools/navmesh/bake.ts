// The content-build side of the navmesh bake (mw-e11.4, ADR-0006): load the content, lay out a
// scene, turn it into the sim's bake input (solid parts with their climb grades, door leaves) and
// write the baked navmesh as `src/content/data/navmesh/<scene>.json`, or check that the committed
// file is what a bake gives now. The bake itself is the sim's (src/sim/nav/bake.ts).
//
// Files are written one polygon, portal or link per line (and skipped by Prettier, see
// .prettierignore), so a re-bake's diff shows what moved without reformatting noise.

import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkNavmeshes, loadContent, materialPresets, type GameContent } from '@content/index';
import { readContentSources } from '@content/fs-sources';
import { contentChecks, contentTypes } from '@content/registry';
import { doorProfiles } from '@game/mechanisms/index';
import {
  bakeNavMesh,
  DEFAULT_NAV_BAKE_SETTINGS,
  layoutScene,
  sceneNavBakeInput,
  type NavBakeSettings,
  type NavMeshData,
} from '@sim/index';

/** Where content lives, relative to the repo root. */
export const CONTENT_DIR = 'src/content/data';
/** Where baked navmeshes live, relative to the repo root. */
export const NAVMESH_DIR = `${CONTENT_DIR}/navmesh`;

/** The repo-relative path of scene `id`'s navmesh. */
export const navmeshPath = (id: string): string => `${NAVMESH_DIR}/${id}.json`;

/**
 * Loads and validates the content under `cwd` that a bake reads: everything but the navmeshes
 * themselves, so a stale or outdated navmesh never stops its own re-bake.
 */
export function loadBakeContent(cwd: string): GameContent {
  const sources = readContentSources(join(cwd, CONTENT_DIR), CONTENT_DIR).filter(
    (source) => !source.path.startsWith(`${NAVMESH_DIR}/`),
  );
  return loadContent(
    contentTypes,
    sources,
    contentChecks.filter((check) => check !== checkNavmeshes),
  );
}

const row = (values: readonly number[]): string =>
  `[${values.map((v) => JSON.stringify(v)).join(', ')}]`;

const rows = (name: string, list: readonly (readonly number[])[]): string =>
  list.length === 0
    ? `  "${name}": []`
    : `  "${name}": [\n${list.map((r) => `    ${row(r)}`).join(',\n')}\n  ]`;

/** A navmesh as its data file: fixed key order, one row per line. */
export function serializeNavMesh(data: NavMeshData): string {
  const settings = Object.entries(data.settings)
    .map(([key, value]) => `"${key}": ${JSON.stringify(value)}`)
    .join(', ');
  return [
    '{',
    '  "$schema": "../navmesh.schema.json",',
    `  "id": ${JSON.stringify(data.id)},`,
    `  "version": ${String(data.version)},`,
    `  "source": ${JSON.stringify(data.source)},`,
    `  "settings": { ${settings} },`,
    `  "origin": ${row(data.origin)},`,
    `${rows('polys', data.polys)},`,
    `${rows('portals', data.portals)},`,
    `${rows('links', data.links)},`,
    `  "doors": [${data.doors.map((d) => JSON.stringify(d)).join(', ')}]`,
    '}',
    '',
  ].join('\n');
}

/**
 * The settings scene `id` is baked with: those its navmesh file under `cwd` records, else the
 * humanoid defaults (also for a file that is not JSON).
 */
export function bakeSettings(cwd: string, id: string): NavBakeSettings {
  const file = join(cwd, navmeshPath(id));
  if (!existsSync(file)) return DEFAULT_NAV_BAKE_SETTINGS;
  try {
    const { settings } = JSON.parse(readFileSync(file, 'utf8')) as { settings?: NavBakeSettings };
    return { ...DEFAULT_NAV_BAKE_SETTINGS, ...settings };
  } catch {
    return DEFAULT_NAV_BAKE_SETTINGS;
  }
}

/** Bakes scene `id` of `content` with `settings`. */
export function bakeScene(
  content: GameContent,
  id: string,
  settings: NavBakeSettings = DEFAULT_NAV_BAKE_SETTINGS,
): NavMeshData {
  // Content validation guarantees every piece a scene names exists.
  const layout = layoutScene(content.get('scene', id), (piece) => content.get('kit', piece));
  const input = sceneNavBakeInput(layout, {
    doors: doorProfiles(content),
    materials: materialPresets(content.all('material')),
  });
  return bakeNavMesh(input, settings);
}

/** One scene's bake outcome. */
export interface BakeOutcome {
  readonly id: string;
  readonly path: string;
  readonly data: NavMeshData;
  /** Whether the file on disk already held exactly this. */
  readonly current: boolean;
}

/** Bakes each scene of `ids` and compares it with its file under `cwd`; writes when `write`. */
export function bakeScenes(cwd: string, ids: readonly string[], write: boolean): BakeOutcome[] {
  const content = loadBakeContent(cwd);
  return ids.map((id) => {
    if (!content.has('scene', id)) throw new RangeError(`no scene "${id}" to bake`);
    const data = bakeScene(content, id, bakeSettings(cwd, id));
    const path = navmeshPath(id);
    const file = join(cwd, path);
    const text = serializeNavMesh(data);
    const current = existsSync(file) && readFileSync(file, 'utf8') === text;
    if (write && !current) {
      mkdirSync(join(cwd, NAVMESH_DIR), { recursive: true });
      writeFileSync(file, text);
    }
    return { id, path, data, current };
  });
}

/** The scenes that have a navmesh file under `cwd`, by id, sorted. */
export function bakedScenes(cwd: string): string[] {
  return globSync('*.json', { cwd: join(cwd, NAVMESH_DIR) })
    .map((file) => file.slice(0, -'.json'.length))
    .sort();
}
