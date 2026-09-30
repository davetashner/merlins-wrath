import { describe, expect, it } from 'vitest';
import { gameSoundRegistry, SOUND_MANIFEST } from './sounds.ts';

describe('game sound manifest (mw-e28.2)', () => {
  it('validates and registers every entry, placeholders flagged', () => {
    const registry = gameSoundRegistry();
    expect(registry.ids()).toHaveLength(SOUND_MANIFEST.length);
    expect(registry.get('sfx-impact-wood')).toMatchObject({ bus: 'sfx', placeholder: true });
    expect(registry.isPlaceholderAsset('sfx-impact-wood-04')).toBe(true);
  });
});
