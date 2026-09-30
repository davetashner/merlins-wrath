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
import {
  AUDIO_DIR,
  assetPath,
  buildPack,
  checkPack,
  creditProblems,
  creditRows,
  CREDITS_PATH,
  loadRepoContent,
  main,
  MANIFEST_PATH,
  manifestEntry,
  matchesGlob,
  PACK_BUDGET_BYTES,
  packBytes,
  readManifest,
  sameWav,
  variantIds,
  wavsOnDisk,
  type ManifestEntry,
} from './gen-placeholders.ts';
import { placeholderSpecs } from './placeholder-specs.ts';

const cwd = process.cwd();
const committed = readManifest(cwd);
const pack = buildPack(committed);
const content = loadRepoContent(cwd);

describe('placeholder pack, as committed (mw-e28.2)', () => {
  it('is up to date (run pnpm audio:placeholders if this fails)', () => {
    expect(checkPack(cwd, pack, content)).toEqual([]);
  });

  it('AC-2: the placeholder set totals at most 2 MB on disk', () => {
    const bytes = packBytes(cwd, pack);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(PACK_BUDGET_BYTES);
    expect(PACK_BUDGET_BYTES).toBe(2 * 1024 * 1024);
  });

  it('every manifest entry is flagged placeholder: true, keyed by final ids with -NN variants', () => {
    expect(committed.length).toBe(placeholderSpecs().length);
    for (const entry of committed) {
      expect(entry.placeholder).toBe(true);
      entry.variants.forEach((variant, i) => {
        expect(variant).toBe(`${entry.id}-${String(i + 1).padStart(2, '0')}`);
      });
    }
  });

  it('files are mono 16-bit PCM WAVs at the placeholder rate; loops carry a sidecar', () => {
    const wav = pack.files.get(assetPath('sfx-impact-wood-01', 'wav'));
    const view = new DataView((wav ?? new Uint8Array(44)).buffer);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(24, true)).toBe(16_000);
    const sidecar = pack.files.get(assetPath('sfx-bow-draw-creak-loop-01', 'json'));
    expect(JSON.parse(new TextDecoder().decode(sidecar))).toEqual({
      bpm: 60,
      beatsPerBar: 1,
      loopStartSample: 0,
      loopEndSample: 48_000,
    });
  });

  it('AC-3: every placeholder asset has a provenance row with an allowed licence in CREDITS.md', () => {
    const ids = pack.specs.flatMap((spec) => variantIds(spec.id, spec.variants));
    expect(creditProblems(readFileSync(join(cwd, CREDITS_PATH), 'utf8'), ids)).toEqual([]);
  });
});

describe('placeholder pack helpers', () => {
  it('variant ids, asset paths and manifest entries follow audio bible §6', () => {
    expect(variantIds('sfx-a', 2)).toEqual(['sfx-a-01', 'sfx-a-02']);
    expect(assetPath('sfx-a-01', 'wav')).toBe(`${AUDIO_DIR}/sfx/sfx-a-01.wav`);
    const [spec] = placeholderSpecs().filter((s) => s.loop === true);
    if (spec === undefined) throw new Error('the set has loops');
    expect(manifestEntry(spec)).toMatchObject({ loop: true, placeholder: true });
    expect(manifestEntry({ ...spec, loop: false })).not.toHaveProperty('loop');
  });

  it('sameWav tolerates ±1 LSB sample differences but not header or length changes', () => {
    const wav = (samples: number[]) => {
      const bytes = new Uint8Array(44 + samples.length * 2);
      const view = new DataView(bytes.buffer);
      samples.forEach((s, i) => {
        view.setInt16(44 + i * 2, s, true);
      });
      return bytes;
    };
    expect(sameWav(wav([10, 20]), wav([11, 19]))).toBe(true);
    expect(sameWav(wav([10, 20]), wav([12, 20]))).toBe(false);
    expect(sameWav(wav([10]), wav([10, 20]))).toBe(false);
    expect(sameWav(new Uint8Array(4), new Uint8Array(4))).toBe(false);
    const header = wav([10]);
    header[0] = 1;
    expect(sameWav(header, wav([10]))).toBe(false);
  });

  it('reads CREDITS rows (backticked globs or plain ids) and matches globs', () => {
    const markdown = [
      '| Asset id | Type | Source | Tier | Date | Licence | Terms | Author | Prompt | Placeholder |',
      '| `sfx-*` pack | sfx | original | n/a | d | ORIGINAL | n/a | us | n/a | yes |',
      '| sfx-clip-01 | sfx | library | n/a | d | CC0-1.0 | url | them | n/a | yes |',
      '| sfx-final-01 | sfx | generated | n/a | d | GEN-OWNED | url | us | p | no |',
      '| too | few |',
    ].join('\n');
    expect(creditRows(markdown).slice(1)).toEqual([
      { glob: 'sfx-*', licence: 'ORIGINAL', placeholder: true },
      { glob: 'sfx-clip-01', licence: 'CC0-1.0', placeholder: true },
      { glob: 'sfx-final-01', licence: 'GEN-OWNED', placeholder: false },
    ]);
    expect(matchesGlob('sfx-*', 'sfx-a-01')).toBe(true);
    expect(matchesGlob('sfx-a.b', 'sfx-aXb')).toBe(false);
    expect(matchesGlob('amb-*', 'sfx-a-01')).toBe(false);
    const clipOnly = markdown.split('\n').slice(2, 3).join('\n');
    expect(creditProblems(clipOnly, ['sfx-clip-01', 'sfx-other-01'])).toEqual([
      `sfx-other-01 has no placeholder row with an allowed licence in ${CREDITS_PATH}`,
    ]);
    const noLicence = '| sfx-x-01 | sfx | library | n/a | d | CC-BY-NC | url | them | n/a | yes |';
    expect(creditProblems(noLicence, ['sfx-x-01'])).toHaveLength(1);
  });

  it('readManifest and wavsOnDisk are empty for a checkout without them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'placeholders-empty-'));
    expect(readManifest(dir)).toEqual([]);
    expect(wavsOnDisk(dir)).toEqual([]);
    expect(packBytes(dir, pack)).toBe(0);
    rmSync(dir, { recursive: true });
  });
});

describe('gen-placeholders main', () => {
  const argv = process.argv;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'placeholders-'));
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

  it('writes the pack and manifest, then --check passes', () => {
    expect(main([], dir)).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/^wrote \d+ placeholder sounds/),
    );
    expect(readFileSync(join(dir, MANIFEST_PATH), 'utf8')).toBe(pack.manifest);
    expect(main(['--check'], dir)).toBe(0);
  }, 30_000);

  it('keeps final entries, skips their ids and removes their stale placeholder WAVs', () => {
    expect(main([], dir)).toBe(0);
    const final: ManifestEntry = {
      id: 'sfx-impact-wood',
      variants: ['sfx-impact-wood-01'],
      bus: 'sfx',
      spatial: true,
    };
    const manifest = readManifest(dir).map((e) => (e.id === final.id ? final : e));
    writeFileSync(join(dir, MANIFEST_PATH), JSON.stringify(manifest));
    expect(main([], dir)).toBe(0);
    const written = readManifest(dir);
    expect(written.find((e) => e.id === final.id)).toEqual(final);
    expect(existsSync(join(dir, assetPath('sfx-impact-wood-01', 'wav')))).toBe(false);
    expect(existsSync(join(dir, assetPath('sfx-impact-bone-01', 'wav')))).toBe(true);
  }, 30_000);

  it('--check lists a stale manifest, missing, stale and orphaned files, and an oversized pack', () => {
    expect(main([], dir)).toBe(0);
    writeFileSync(join(dir, MANIFEST_PATH), '[]\n');
    rmSync(join(dir, assetPath('sfx-impact-bone-01', 'wav')));
    writeFileSync(
      join(dir, assetPath('sfx-impact-bone-02', 'wav')),
      new Uint8Array(PACK_BUDGET_BYTES),
    );
    writeFileSync(join(dir, assetPath('sfx-bow-draw-creak-loop-01', 'json')), '{}\n');
    writeFileSync(join(dir, assetPath('sfx-old-01', 'wav')), 'x');
    const problems = checkPack(dir, buildPack([]), content);
    expect(problems).toEqual(
      expect.arrayContaining([
        `${MANIFEST_PATH} is stale`,
        `${assetPath('sfx-impact-bone-01', 'wav')} is missing`,
        `${assetPath('sfx-impact-bone-02', 'wav')} is stale`,
        `${assetPath('sfx-bow-draw-creak-loop-01', 'json')} is stale`,
        `${assetPath('sfx-old-01', 'wav')} is not a placeholder any more`,
        'cue sheets can play "sfx-impact-stone", which has no manifest entry',
        expect.stringMatching(/^placeholder pack is \d+ bytes, over 2097152$/) as string,
      ]),
    );
    expect(main(['--check'], dir)).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      `::error title=Placeholder sounds::${MANIFEST_PATH} is stale; run pnpm audio:placeholders.`,
    );
  }, 30_000);

  it('--check names templated cue facts it cannot enumerate and missing credits', () => {
    expect(main([], dir)).toBe(0);
    writeFileSync(join(dir, CREDITS_PATH), '# no rows\n');
    const sheets = [{ rules: [{ cue: 'sfx-telegraph-{mystery}' }] }];
    const stub = {
      all: (type: string) => (type === 'cue-sheet' ? sheets : content.all(type as never)),
    };
    const problems = checkPack(dir, pack, stub as never);
    expect(problems).toContain(
      'cue sheets use {mystery}, which has no known set of values to check',
    );
    expect(problems).toContain(
      `sfx-impact-wood-01 has no placeholder row with an allowed licence in ${CREDITS_PATH}`,
    );
  }, 30_000);

  it('the CLI sets the process exit code from main', async () => {
    process.chdir(dir);
    process.argv = ['node', 'gen-placeholders-cli.ts', '--check'];
    await import('./gen-placeholders-cli.ts');
    expect(process.exitCode).toBe(1);
  }, 30_000);
});
