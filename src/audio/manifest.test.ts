import { describe, expect, it } from 'vitest';
import {
  assetCategory,
  assetUrl,
  DEFAULT_PRIORITY,
  loopSeconds,
  loopSidecarSchema,
  OPUS_MIME,
  pickFormat,
  PLACEHOLDER_FORMAT,
  registryAssetUrl,
  soundDefSchema,
  soundManifestSchema,
  SoundRegistry,
} from './manifest.ts';

describe('sound manifest', () => {
  it('fills defaults for a minimal entry', () => {
    expect(
      soundDefSchema.parse({ id: 'sfx-ui-click', variants: ['sfx-ui-click-01'], bus: 'ui' }),
    ).toEqual({
      id: 'sfx-ui-click',
      variants: ['sfx-ui-click-01'],
      bus: 'ui',
      spatial: false,
      loop: false,
      priority: DEFAULT_PRIORITY,
      gainDb: 0,
      placeholder: false,
    });
  });

  it.each([
    ['no variants', { variants: [] }],
    ['the master bus', { bus: 'master' }],
    ['a non-kebab id', { id: 'Sfx_Click' }],
    ['priority over 100', { priority: 101 }],
    ['an unknown key', { url: 'x.ogg' }],
  ])('rejects %s', (_label, patch) => {
    const entry = { id: 'sfx-ui-click', variants: ['sfx-ui-click-01'], bus: 'ui', ...patch };
    expect(soundDefSchema.safeParse(entry).success).toBe(false);
  });

  it('rejects duplicate ids within a manifest, naming the index', () => {
    const entry = { id: 'sfx-ui-click', variants: ['sfx-ui-click-01'], bus: 'ui' };
    const result = soundManifestSchema.safeParse([entry, entry]);
    expect(result.error?.issues[0]?.path).toEqual([1, 'id']);
  });

  it('the registry looks ids up and refuses an id registered twice', () => {
    const registry = new SoundRegistry().register([
      { id: 'sfx-ui-click', variants: ['sfx-ui-click-01'], bus: 'ui' },
    ]);
    expect(registry.get('sfx-ui-click')?.bus).toBe('ui');
    expect(registry.get('sfx-nope')).toBeUndefined();
    expect(registry.ids()).toEqual(['sfx-ui-click']);
    expect(() =>
      registry.register([
        { id: 'sfx-ui-other', variants: ['sfx-ui-other-01'], bus: 'ui' },
        { id: 'sfx-ui-click', variants: ['sfx-ui-click-01'], bus: 'ui' },
      ]),
    ).toThrow(/"sfx-ui-click" is already registered/);
    expect(registry.ids()).toEqual(['sfx-ui-click']); // all-or-nothing
  });
});

describe('formats and paths (audio bible §5.2, §6)', () => {
  it('prefers Opus in Ogg and falls back to AAC when canPlayType is empty', () => {
    const probed: string[] = [];
    expect(pickFormat((mime) => (probed.push(mime), 'probably'))).toBe('ogg');
    expect(pickFormat(() => 'maybe')).toBe('ogg');
    expect(pickFormat(() => '')).toBe('m4a');
    expect(probed).toEqual([OPUS_MIME]);
  });

  it('builds <base>/<category>/<asset-id>.<ext>', () => {
    expect(assetCategory('amb-deepworks-drips-01')).toBe('amb');
    expect(assetUrl('/assets/audio', 'sfx-foot-stone-walk-03', 'ogg')).toBe(
      '/assets/audio/sfx/sfx-foot-stone-walk-03.ogg',
    );
    expect(assetUrl('/assets/audio', 'music-knot-combat', 'json')).toBe(
      '/assets/audio/music/music-knot-combat.json',
    );
  });

  it('serves placeholder assets (mw-e28.2) as the pack WAVs and final ones in the session format', () => {
    const registry = new SoundRegistry().register([
      {
        id: 'sfx-foot-stone-walk',
        variants: ['sfx-foot-stone-walk-01'],
        bus: 'footsteps',
        placeholder: true,
      },
      { id: 'sfx-ui-page-turn', variants: ['sfx-ui-page-turn-01'], bus: 'ui', loop: true },
    ]);
    expect(registry.isPlaceholderAsset('sfx-foot-stone-walk-01')).toBe(true);
    expect(registry.isPlaceholderAsset('sfx-ui-page-turn-01')).toBe(false);
    const url = registryAssetUrl(registry, '/a');
    expect(PLACEHOLDER_FORMAT).toBe('wav');
    expect(url('sfx-foot-stone-walk-01', 'ogg')).toBe('/a/sfx/sfx-foot-stone-walk-01.wav');
    expect(url('sfx-foot-stone-walk-01', 'json')).toBe('/a/sfx/sfx-foot-stone-walk-01.json');
    expect(url('sfx-ui-page-turn-01', 'm4a')).toBe('/a/sfx/sfx-ui-page-turn-01.m4a');
  });
});

describe('loop sidecar (audio bible §5.3)', () => {
  it('converts 48 kHz sample loop points to seconds', () => {
    const sidecar = loopSidecarSchema.parse({
      bpm: 88,
      beatsPerBar: 6,
      loopStartSample: 24_000,
      loopEndSample: 480_000,
      key: 'D dorian',
    });
    expect(loopSeconds(sidecar)).toEqual({ start: 0.5, end: 10 });
  });

  it('rejects an end before the start', () => {
    const result = loopSidecarSchema.safeParse({
      bpm: 88,
      beatsPerBar: 6,
      loopStartSample: 10,
      loopEndSample: 10,
    });
    expect(result.error?.issues[0]?.path).toEqual(['loopEndSample']);
  });
});
