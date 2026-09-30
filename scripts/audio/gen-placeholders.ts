// Writes (or with --check, verifies) the placeholder sound pack (mw-e28.2): a WAV per variant under
// its final asset id in public/assets/audio/<category>/, a whole-file loop sidecar for loops, and the
// placeholder entries of the sound manifest (src/audio/data/sound-manifest.json), flagged
// `placeholder: true`. Final entries already in the manifest (placeholder false) are kept and their
// ids are no longer generated, so replacing a placeholder is: drop in the final files, flip the flag.
// --check also fails when a cue sheet can play a sound id the manifest lacks (AC-1) or the pack
// outgrows its 2 MB budget (AC-2). Run through gen-placeholders-cli.ts (`pnpm audio:placeholders`).

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { encodeWav } from '../../src/audio/wav.ts';
import { readContentSources } from '../../src/content/fs-sources.ts';
import { loadContent } from '../../src/content/loader.ts';
import { contentChecks, contentTypes, type GameContent } from '../../src/content/registry.ts';
import { cueSoundIds, factDomains } from './cue-sounds.ts';
import { placeholderSpecs, type PlaceholderSpec } from './placeholder-specs.ts';
import { hashSeed, PLACEHOLDER_RATE, prng, render, vary } from './synth.ts';

/** Repo-relative path of the sound manifest the game imports. */
export const MANIFEST_PATH = 'src/audio/data/sound-manifest.json';
/** Repo-relative root of runtime audio (served at /assets/audio; audio bible §6). */
export const AUDIO_DIR = 'public/assets/audio';
/** AC-2: the whole placeholder pack stays under this many bytes. */
export const PACK_BUDGET_BYTES = 2 * 1024 * 1024;
/** Sidecar loop points are in 48 kHz samples whatever the file's rate (audio bible §5.3). */
const SIDECAR_RATE = 48_000;

/** A manifest entry as written to disk (the engine's SoundDefInput; see src/audio/manifest.ts). */
export interface ManifestEntry {
  readonly id: string;
  readonly variants: readonly string[];
  readonly bus: string;
  readonly spatial?: boolean;
  readonly loop?: boolean;
  readonly priority?: number;
  readonly gainDb?: number;
  readonly placeholder?: boolean;
}

/** Two-digit variant asset ids of a cue (audio bible §6). */
export function variantIds(id: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${id}-${String(i + 1).padStart(2, '0')}`);
}

/** Repo-relative path of an asset file (`<category>` is the id's first segment). */
export function assetPath(assetId: string, ext: string): string {
  return `${AUDIO_DIR}/${assetId.slice(0, assetId.indexOf('-'))}/${assetId}.${ext}`;
}

/** The manifest entry of a placeholder spec. */
export function manifestEntry(spec: PlaceholderSpec): ManifestEntry {
  return {
    id: spec.id,
    variants: variantIds(spec.id, spec.variants),
    bus: spec.bus,
    spatial: spec.spatial,
    ...(spec.loop === true ? { loop: true } : {}),
    placeholder: true,
  };
}

/** Synthesises one spec's files: repo-relative path → bytes. */
export function renderSpec(spec: PlaceholderSpec): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  variantIds(spec.id, spec.variants).forEach((assetId, i) => {
    const seed = hashSeed(assetId);
    const recipe = i === 0 ? spec.recipe : vary(spec.recipe, prng(seed), spec.spread ?? 0.08);
    const wav = encodeWav(render(recipe, seed), PLACEHOLDER_RATE);
    files.set(assetPath(assetId, 'wav'), new Uint8Array(wav));
    if (spec.loop === true) {
      const sidecar = {
        bpm: 60,
        beatsPerBar: 1,
        loopStartSample: 0,
        loopEndSample: Math.round(spec.recipe.duration * SIDECAR_RATE),
      };
      files.set(
        assetPath(assetId, 'json'),
        new TextEncoder().encode(`${JSON.stringify(sidecar)}\n`),
      );
    }
  });
  return files;
}

/** The manifest text: final entries kept, placeholders regenerated, sorted by id. */
export function manifestText(finals: readonly ManifestEntry[], specs: readonly PlaceholderSpec[]) {
  const entries = [...finals, ...specs.map(manifestEntry)].sort((a, b) => (a.id < b.id ? -1 : 1));
  return `${JSON.stringify(entries, null, 2)}\n`;
}

/** Reads the committed manifest; empty when there is none yet. */
export function readManifest(root: string): ManifestEntry[] {
  try {
    return JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8')) as ManifestEntry[];
  } catch {
    return [];
  }
}

/** Everything the generator owns: files by repo-relative path, plus the manifest text. */
export interface Pack {
  readonly files: Map<string, Uint8Array>;
  readonly manifest: string;
  /** Placeholder specs generated (ids with a final entry are skipped). */
  readonly specs: readonly PlaceholderSpec[];
}

/** Builds the pack for the given committed manifest. */
export function buildPack(committed: readonly ManifestEntry[]): Pack {
  const finals = committed.filter((entry) => entry.placeholder !== true);
  const finalIds = new Set(finals.map((entry) => entry.id));
  const specs = placeholderSpecs().filter((spec) => !finalIds.has(spec.id));
  const files = new Map<string, Uint8Array>();
  for (const spec of specs) for (const [path, bytes] of renderSpec(spec)) files.set(path, bytes);
  return { files, manifest: manifestText(finals, specs), specs };
}

/** Placeholder WAVs on disk (repo-relative), in every category folder. */
export function wavsOnDisk(root: string): string[] {
  const base = join(root, AUDIO_DIR);
  let categories: string[];
  try {
    categories = readdirSync(base);
  } catch {
    return [];
  }
  return categories.flatMap((category) =>
    readdirSync(join(base, category))
      .filter((name) => name.endsWith('.wav'))
      .map((name) => `${AUDIO_DIR}/${category}/${name}`),
  );
}

/**
 * Whether two WAV files match: identical headers and every 16-bit sample within ±1 LSB, so a
 * last-bit rounding difference in Math between Node builds doesn't read as drift.
 */
export function sameWav(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length || a.length < 44) return false;
  for (let i = 0; i < 44; i++) if (a[i] !== b[i]) return false;
  const va = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const vb = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 44; i + 1 < a.length; i += 2) {
    if (Math.abs(va.getInt16(i, true) - vb.getInt16(i, true)) > 1) return false;
  }
  return true;
}

const sameBytes = (path: string, a: Uint8Array, b: Uint8Array): boolean =>
  path.endsWith('.wav') ? sameWav(a, b) : Buffer.from(a).equals(Buffer.from(b));

function readBytes(path: string): Uint8Array | undefined {
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return undefined;
  }
}

/** Loads the game content from src/content/data (throws a ContentLoadError on bad content). */
export function loadRepoContent(root: string): GameContent {
  const dir = 'src/content/data';
  return loadContent(contentTypes, readContentSources(resolve(root, dir), dir), contentChecks);
}

/** Repo-relative path of the credits and provenance table (audio bible §9). */
export const CREDITS_PATH = 'assets/CREDITS.md';
/** Licence ids assets/CREDITS.md allows. */
const LICENCES = new Set([
  'CC0-1.0',
  'CC-BY-4.0',
  'OFL-1.1',
  'MIT',
  'Apache-2.0',
  'GEN-OWNED',
  'ORIGINAL',
]);

/** A credits row: its asset id or glob, licence and placeholder flag. */
export interface CreditRow {
  readonly glob: string;
  readonly licence: string;
  readonly placeholder: boolean;
}

/** The asset rows of CREDITS.md tables (10 columns; the asset id may be a backticked glob). */
export function creditRows(markdown: string): CreditRow[] {
  return markdown.split('\n').flatMap((line) => {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 10) return [];
    type Row = [string, string, string, string, string, string, string, string, string, string];
    const [id, , , , , licence, , , , placeholder] = cells as Row;
    const glob = /`([^`]+)`/.exec(id)?.[1] ?? id;
    return [{ glob, licence, placeholder: placeholder === 'yes' }];
  });
}

/** Whether an asset id matches a credits glob (`*` = any run of characters). */
export function matchesGlob(glob: string, assetId: string): boolean {
  const pattern = glob.split('*').map((part) => part.replace(/[.+?^${}()[\]\\|]/g, '\\$&'));
  return new RegExp(`^${pattern.join('.*')}$`).test(assetId);
}

/**
 * AC-3: every placeholder asset has a provenance line in CREDITS.md with an allowed licence,
 * flagged as a placeholder (a CC0 clip would need its own; synthesised ones share the pack's row).
 */
export function creditProblems(markdown: string, assetIds: readonly string[]): string[] {
  const rows = creditRows(markdown).filter((row) => row.placeholder && LICENCES.has(row.licence));
  return assetIds
    .filter((id) => !rows.some((row) => matchesGlob(row.glob, id)))
    .map((id) => `${id} has no placeholder row with an allowed licence in ${CREDITS_PATH}`);
}

/** Problems --check reports: stale or missing files, unresolved cue ids, an oversized pack. */
export function checkPack(root: string, pack: Pack, content: GameContent): string[] {
  const problems: string[] = [];
  const manifest = readBytes(join(root, MANIFEST_PATH));
  if (manifest === undefined) problems.push(`${MANIFEST_PATH} is missing`);
  else if (new TextDecoder().decode(manifest) !== pack.manifest) {
    problems.push(`${MANIFEST_PATH} is stale`);
  }
  for (const [path, bytes] of pack.files) {
    const disk = readBytes(join(root, path));
    if (disk === undefined) problems.push(`${path} is missing`);
    else if (!sameBytes(path, disk, bytes)) problems.push(`${path} is stale`);
  }
  for (const path of wavsOnDisk(root)) {
    if (!pack.files.has(path)) problems.push(`${path} is not a placeholder any more`);
  }
  const ids = new Set(readManifest(root).map((entry) => entry.id));
  const { ids: cueIds, unknownFacts } = cueSoundIds(content.all('cue-sheet'), factDomains(content));
  for (const fact of unknownFacts) {
    problems.push(`cue sheets use {${fact}}, which has no known set of values to check`);
  }
  for (const id of cueIds) {
    if (!ids.has(id)) problems.push(`cue sheets can play "${id}", which has no manifest entry`);
  }
  const assetIds = pack.specs.flatMap((spec) => variantIds(spec.id, spec.variants));
  problems.push(...creditProblems(readFileSync(join(root, CREDITS_PATH), 'utf8'), assetIds));
  const bytes = packBytes(root, pack);
  if (bytes > PACK_BUDGET_BYTES) {
    problems.push(`placeholder pack is ${String(bytes)} bytes, over ${String(PACK_BUDGET_BYTES)}`);
  }
  return problems;
}

/** AC-2: bytes of the pack's files on disk. */
export function packBytes(root: string, pack: Pack): number {
  let total = 0;
  for (const path of pack.files.keys()) {
    try {
      total += statSync(join(root, path)).size;
    } catch {
      // Missing files are reported by checkPack.
    }
  }
  return total;
}

function write(root: string, path: string, bytes: Uint8Array | string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
}

/** Writes the pack, or with `--check` returns 1 listing problems. Returns the exit code. */
export function main(argv: readonly string[], root: string = process.cwd()): number {
  const pack = buildPack(readManifest(root));
  if (argv.includes('--check')) {
    const problems = checkPack(root, pack, loadRepoContent(root));
    for (const problem of problems) {
      console.log(`::error title=Placeholder sounds::${problem}; run pnpm audio:placeholders.`);
    }
    return problems.length === 0 ? 0 : 1;
  }
  for (const path of wavsOnDisk(root)) if (!pack.files.has(path)) rmSync(join(root, path));
  for (const [path, bytes] of pack.files) write(root, path, bytes);
  write(root, MANIFEST_PATH, pack.manifest);
  const kb = Math.round(packBytes(root, pack) / 1024);
  console.log(
    `wrote ${String(pack.specs.length)} placeholder sounds (${String(pack.files.size)} files, ${String(kb)} KB)`,
  );
  return 0;
}
