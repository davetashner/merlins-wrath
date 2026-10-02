import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vfxTextureManifestSchema, type VfxTextureEntry } from '../../src/game/vfx/textures.ts';
import { CREDITS_PATH, loadRepoContent } from '../audio/gen-placeholders.ts';
import {
  buildSet,
  checkSet,
  DEFAULT_TEXTURE_SEED,
  main,
  MANIFEST_PATH,
  manifestEntry,
  pngsOnDisk,
  readManifest,
  renderSpec,
  seedArg,
  SET_BUDGET_BYTES,
  setBytes,
  TEXTURE_DIR,
  texturePath,
} from './gen-placeholders.ts';
import { placeholderTextureSpecs } from './placeholder-specs.ts';
import { decodePng } from './png.ts';

const cwd = process.cwd();
const committed = readManifest(cwd);
const set = buildSet(committed);
const content = loadRepoContent(cwd);

describe('placeholder VFX textures, as committed (mw-e29.2)', () => {
  it('are up to date (run pnpm vfx:placeholders if this fails)', () => {
    expect(checkSet(cwd, set, content)).toEqual([]);
  });

  it('AC-1: every texture an effect definition references resolves to a manifest entry', () => {
    const effects = content.all('vfx-effect');
    const ids = new Set(committed.map((entry) => entry.id));
    const referenced = effects.flatMap((effect) => effect.emitters.map((e) => e.texture));
    expect(referenced.length).toBeGreaterThan(0);
    for (const texture of referenced) expect(ids).toContain(texture);
    expect(vfxTextureManifestSchema.parse(committed)).toEqual(committed);
  });

  it('AC-3: the placeholder set totals at most 1.5 MB on disk', () => {
    const bytes = setBytes(cwd, set);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(SET_BUDGET_BYTES);
    expect(SET_BUDGET_BYTES).toBe(1.5 * 1024 * 1024);
  });

  it('every entry is a placeholder under a final asset id, sized to its sheet', () => {
    const specs = placeholderTextureSpecs();
    expect(committed).toHaveLength(16);
    for (const entry of committed) {
      expect(entry.placeholder).toBe(true);
      const spec = specs.find((s) => s.id === entry.id);
      expect(spec).toBeDefined();
      const image = decodePng(new Uint8Array(readFileSync(join(cwd, texturePath(entry.id)))));
      expect([image.width, image.height]).toEqual([entry.width, entry.height]);
    }
    expect(manifestEntry({ id: 'vfx-x-01', kind: 'flame', cell: 32, cols: 8, rows: 4 })).toEqual({
      id: 'vfx-x-01',
      width: 256,
      height: 128,
      cols: 8,
      rows: 4,
      placeholder: true,
    });
  });
});

describe('placeholder VFX texture generator', () => {
  it('AC-2: with a fixed seed, two runs produce byte-identical outputs', () => {
    const again = buildSet(committed, DEFAULT_TEXTURE_SEED);
    expect([...again.files.keys()]).toEqual([...set.files.keys()]);
    for (const [path, bytes] of set.files) {
      expect(Buffer.from(again.files.get(path) ?? []).equals(Buffer.from(bytes))).toBe(true);
    }
    expect(again.manifest).toBe(set.manifest);
    // A different seed changes the noise-driven textures but not the pure shapes.
    const smoke = placeholderTextureSpecs().find((s) => s.kind === 'smoke-noise');
    const ring = placeholderTextureSpecs().find((s) => s.kind === 'ring');
    if (smoke === undefined || ring === undefined) throw new Error('missing specs');
    expect(Buffer.from(renderSpec(smoke, 7)).equals(Buffer.from(renderSpec(smoke, 8)))).toBe(false);
    expect(Buffer.from(renderSpec(ring, 7)).equals(Buffer.from(renderSpec(ring, 8)))).toBe(true);
  });

  it('reads --seed, rejecting anything but a whole number', () => {
    expect(seedArg([])).toBe(DEFAULT_TEXTURE_SEED);
    expect(seedArg(['--seed', '42'])).toBe(42);
    expect(() => seedArg(['--seed', 'x'])).toThrow(/whole number/);
    expect(() => seedArg(['--seed', '-1'])).toThrow(/whole number/);
  });

  it('readManifest and pngsOnDisk are empty for a checkout without them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vfx-textures-empty-'));
    expect(readManifest(dir)).toEqual([]);
    expect(pngsOnDisk(dir)).toEqual([]);
    expect(setBytes(dir, set)).toBe(0);
    rmSync(dir, { recursive: true });
  });
});

describe('gen-placeholders main (VFX)', () => {
  const argv = process.argv;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vfx-textures-'));
    mkdirSync(join(dir, 'src/content'), { recursive: true });
    mkdirSync(join(dir, 'assets'), { recursive: true });
    symlinkSync(join(cwd, 'src/content/data'), join(dir, 'src/content/data'));
    copyFileSync(join(cwd, CREDITS_PATH), join(dir, CREDITS_PATH));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(cwd);
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true });
  });

  it('AC-2: writes the set and manifest byte-identically on every run, then --check passes', () => {
    expect(main([], dir, loadRepoContent)).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/^wrote 16 placeholder VFX textures \(\d+ KB\)$/),
    );
    const first = pngsOnDisk(dir).map((path) => readFileSync(join(dir, path)));
    expect(main([], dir, loadRepoContent)).toBe(0);
    const second = pngsOnDisk(dir).map((path) => readFileSync(join(dir, path)));
    expect(second).toHaveLength(16);
    second.forEach((bytes, i) => {
      expect(bytes.equals(first[i] ?? Buffer.alloc(0))).toBe(true);
    });
    expect(readFileSync(join(dir, MANIFEST_PATH), 'utf8')).toBe(set.manifest);
    expect(main(['--check'], dir, loadRepoContent)).toBe(0);
  }, 30_000);

  it('keeps final entries, skips their ids and removes their stale placeholder PNGs', () => {
    expect(main([], dir, loadRepoContent)).toBe(0);
    const final: VfxTextureEntry = {
      id: 'vfx-base-ring-01',
      width: 512,
      height: 512,
      cols: 1,
      rows: 1,
      placeholder: false,
    };
    const manifest = readManifest(dir).map((e) => (e.id === final.id ? final : e));
    writeFileSync(join(dir, MANIFEST_PATH), JSON.stringify(manifest));
    expect(main([], dir, loadRepoContent)).toBe(0);
    expect(readManifest(dir).find((e) => e.id === final.id)).toEqual(final);
    expect(existsSync(join(dir, texturePath('vfx-base-ring-01')))).toBe(false);
    expect(existsSync(join(dir, texturePath('vfx-base-shard-01')))).toBe(true);
  }, 30_000);

  it('--check lists a stale manifest, missing, stale and orphaned files, unresolved textures and an oversized set', () => {
    expect(main([], dir, loadRepoContent)).toBe(0);
    writeFileSync(join(dir, MANIFEST_PATH), '[]\n');
    rmSync(join(dir, texturePath('vfx-base-ring-01')));
    writeFileSync(join(dir, texturePath('vfx-base-shard-01')), new Uint8Array(SET_BUDGET_BYTES));
    writeFileSync(join(dir, `${TEXTURE_DIR}/vfx-old-01.png`), 'x');
    const problems = checkSet(dir, buildSet([]), content);
    expect(problems).toEqual(
      expect.arrayContaining([
        `${MANIFEST_PATH} is stale`,
        `${texturePath('vfx-base-ring-01')} is missing`,
        `${texturePath('vfx-base-shard-01')} is stale`,
        `${TEXTURE_DIR}/vfx-old-01.png is not a placeholder any more`,
        'effect "vfx-test-sparks" emitter "sparks" names texture "vfx-base-soft-circle-01", which has no manifest entry',
        expect.stringMatching(/^placeholder textures are \d+ bytes, over 1572864$/) as string,
      ]),
    );
    expect(main(['--check'], dir, loadRepoContent)).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      `::error title=Placeholder VFX textures::${MANIFEST_PATH} is stale; run pnpm vfx:placeholders.`,
    );
    rmSync(join(dir, MANIFEST_PATH));
    expect(checkSet(dir, set, content)).toContain(`${MANIFEST_PATH} is missing`);
  }, 30_000);

  it('--check names textures without a credits row', () => {
    expect(main([], dir, loadRepoContent)).toBe(0);
    writeFileSync(join(dir, CREDITS_PATH), '# no rows\n');
    expect(checkSet(dir, set, content)).toContain(
      `vfx-base-ring-01 has no placeholder row with an allowed licence in ${CREDITS_PATH}`,
    );
  }, 30_000);

  it('the CLI sets the process exit code from main', async () => {
    process.chdir(dir);
    process.argv = ['node', 'gen-placeholders-cli.ts', '--check'];
    await import('./gen-placeholders-cli.ts');
    expect(process.exitCode).toBe(1);
  }, 30_000);
});
