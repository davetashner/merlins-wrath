// Writes (or with --check, verifies) the placeholder VFX textures (mw-e29.2): a PNG per texture under
// its final asset id in public/assets/vfx/, and the placeholder entries of the texture manifest
// (src/game/vfx/data/texture-manifest.json), flagged `placeholder: true`. Final entries already in
// the manifest (placeholder false) are kept and their ids are no longer generated, so replacing a
// placeholder is: drop in the final file, flip the flag. --check also fails when an effect names a
// texture the manifest lacks (AC-1) or the set outgrows its 1.5 MB budget (AC-3). `--seed <n>`
// changes the noise seed (the default is fixed, so runs are byte-identical: AC-2). Run through
// gen-placeholders-cli.ts (`pnpm vfx:placeholders`).

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { textureProblems, type VfxTextureEntry } from '../../src/game/vfx/textures.ts';
import type { GameContent } from '../../src/content/registry.ts';
import { creditProblems, CREDITS_PATH } from '../audio/gen-placeholders.ts';
import { hashSeed } from '../audio/synth.ts';
import { placeholderTextureSpecs } from './placeholder-specs.ts';
import { encodePng, samePng } from './png.ts';
import { renderTexture, type TextureSpec } from './recipes.ts';

/** Repo-relative path of the texture manifest the game imports. */
export const MANIFEST_PATH = 'src/game/vfx/data/texture-manifest.json';
/** Repo-relative root of runtime VFX textures (served at /assets/vfx; style bible §15.2). */
export const TEXTURE_DIR = 'public/assets/vfx';
/** AC-3: the whole placeholder set stays under this many bytes. */
export const SET_BUDGET_BYTES = 1.5 * 1024 * 1024;
/** The fixed default noise seed. */
export const DEFAULT_TEXTURE_SEED = 0x2902;

/** Repo-relative path of a texture file. */
export function texturePath(assetId: string): string {
  return `${TEXTURE_DIR}/${assetId}.png`;
}

/** The manifest entry of a placeholder spec. */
export function manifestEntry(spec: TextureSpec): VfxTextureEntry {
  return {
    id: spec.id,
    width: spec.cell * spec.cols,
    height: spec.cell * spec.rows,
    cols: spec.cols,
    rows: spec.rows,
    placeholder: true,
  };
}

/** One spec's PNG bytes for a seed (each texture's noise is seeded by its id too). */
export function renderSpec(spec: TextureSpec, seed: number): Uint8Array {
  const { width, height } = manifestEntry(spec);
  return encodePng({
    width,
    height,
    pixels: renderTexture(spec, (hashSeed(spec.id) ^ seed) >>> 0),
  });
}

/** The manifest text: final entries kept, placeholders regenerated, sorted by id. */
export function manifestText(
  finals: readonly VfxTextureEntry[],
  specs: readonly TextureSpec[],
): string {
  const entries = [...finals, ...specs.map(manifestEntry)].sort((a, b) => (a.id < b.id ? -1 : 1));
  return `${JSON.stringify(entries, null, 2)}\n`;
}

/** Reads the committed manifest; empty when there is none yet. */
export function readManifest(root: string): VfxTextureEntry[] {
  try {
    return JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8')) as VfxTextureEntry[];
  } catch {
    return [];
  }
}

/** Everything the generator owns: files by repo-relative path, plus the manifest text. */
export interface TextureSet {
  readonly files: Map<string, Uint8Array>;
  readonly manifest: string;
  /** Placeholder specs generated (ids with a final entry are skipped). */
  readonly specs: readonly TextureSpec[];
}

/** Builds the set for the given committed manifest and seed. */
export function buildSet(
  committed: readonly VfxTextureEntry[],
  seed: number = DEFAULT_TEXTURE_SEED,
): TextureSet {
  const finals = committed.filter((entry) => !entry.placeholder);
  const finalIds = new Set(finals.map((entry) => entry.id));
  const specs = placeholderTextureSpecs().filter((spec) => !finalIds.has(spec.id));
  const files = new Map(specs.map((spec) => [texturePath(spec.id), renderSpec(spec, seed)]));
  return { files, manifest: manifestText(finals, specs), specs };
}

/** PNGs on disk (repo-relative). */
export function pngsOnDisk(root: string): string[] {
  try {
    return readdirSync(join(root, TEXTURE_DIR))
      .filter((name) => name.endsWith('.png'))
      .map((name) => `${TEXTURE_DIR}/${name}`);
  } catch {
    return [];
  }
}

function readBytes(path: string): Uint8Array | undefined {
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return undefined;
  }
}

/** AC-3: bytes of the set's files on disk. */
export function setBytes(root: string, set: TextureSet): number {
  let total = 0;
  for (const path of set.files.keys()) {
    try {
      total += statSync(join(root, path)).size;
    } catch {
      // Missing files are reported by checkSet.
    }
  }
  return total;
}

/** Problems --check reports: stale or missing files, unresolved textures, an oversized set. */
export function checkSet(root: string, set: TextureSet, content: GameContent): string[] {
  const problems: string[] = [];
  const manifest = readBytes(join(root, MANIFEST_PATH));
  if (manifest === undefined) problems.push(`${MANIFEST_PATH} is missing`);
  else if (new TextDecoder().decode(manifest) !== set.manifest) {
    problems.push(`${MANIFEST_PATH} is stale`);
  }
  for (const [path, bytes] of set.files) {
    const disk = readBytes(join(root, path));
    if (disk === undefined) problems.push(`${path} is missing`);
    else if (!samePng(disk, bytes)) problems.push(`${path} is stale`);
  }
  for (const path of pngsOnDisk(root)) {
    if (!set.files.has(path)) problems.push(`${path} is not a placeholder any more`);
  }
  problems.push(...textureProblems(content.all('vfx-effect'), readManifest(root)));
  const ids = set.specs.map((spec) => spec.id);
  problems.push(...creditProblems(readFileSync(join(root, CREDITS_PATH), 'utf8'), ids));
  const bytes = setBytes(root, set);
  if (bytes > SET_BUDGET_BYTES) {
    problems.push(
      `placeholder textures are ${String(bytes)} bytes, over ${String(SET_BUDGET_BYTES)}`,
    );
  }
  return problems;
}

function write(root: string, path: string, bytes: Uint8Array | string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
}

/** The `--seed <n>` argument, else the default seed. */
export function seedArg(argv: readonly string[]): number {
  const index = argv.indexOf('--seed');
  if (index < 0) return DEFAULT_TEXTURE_SEED;
  const seed = Number(argv[index + 1]);
  if (!Number.isInteger(seed) || seed < 0) throw new RangeError('--seed needs a whole number ≥ 0');
  return seed;
}

/** Writes the set, or with `--check` returns 1 listing problems. Returns the exit code. */
export function main(
  argv: readonly string[],
  root: string,
  loadContent: (root: string) => GameContent,
): number {
  const set = buildSet(readManifest(root), seedArg(argv));
  if (argv.includes('--check')) {
    const problems = checkSet(root, set, loadContent(root));
    for (const problem of problems) {
      console.log(`::error title=Placeholder VFX textures::${problem}; run pnpm vfx:placeholders.`);
    }
    return problems.length === 0 ? 0 : 1;
  }
  for (const path of pngsOnDisk(root)) if (!set.files.has(path)) rmSync(join(root, path));
  for (const [path, bytes] of set.files) write(root, path, bytes);
  write(root, MANIFEST_PATH, set.manifest);
  const kb = Math.round(setBytes(root, set) / 1024);
  console.log(`wrote ${String(set.specs.length)} placeholder VFX textures (${String(kb)} KB)`);
  return 0;
}
