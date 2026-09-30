import { describe, expect, it } from 'vitest';
import { cueSoundIds, expandTemplate, factDomains } from './cue-sounds.ts';
import { loadRepoContent, readManifest } from './gen-placeholders.ts';

const domains = new Map([
  ['target', ['bone', 'wood']],
  ['weapon', ['metal']],
]);

describe('cue sheet sound ids (mw-e28.2)', () => {
  it('expands templates over every value of their facts', () => {
    expect(expandTemplate('sfx-combat-glance', domains)).toEqual(['sfx-combat-glance']);
    expect(expandTemplate('sfx-impact-{target}', domains)).toEqual([
      'sfx-impact-bone',
      'sfx-impact-wood',
    ]);
    expect(expandTemplate('sfx-{weapon}-on-{target}', domains)).toEqual([
      'sfx-metal-on-bone',
      'sfx-metal-on-wood',
    ]);
    expect(expandTemplate('sfx-telegraph-{telegraph}', domains)).toEqual([]);
  });

  it('collects ids across sheets, sorted and de-duplicated, and names facts with no value set', () => {
    const sheets = [
      { rules: [{ cue: 'sfx-impact-{target}' }, { cue: 'sfx-b' }] },
      { rules: [{ cue: 'sfx-impact-bone' }, { cue: 'sfx-telegraph-{telegraph}' }] },
    ];
    expect(cueSoundIds(sheets, domains)).toEqual({
      ids: ['sfx-b', 'sfx-impact-bone', 'sfx-impact-wood'],
      unknownFacts: ['telegraph'],
    });
  });

  it('reads fact values from content: impact classes, material ids, attack telegraphs', () => {
    const content = {
      all: ((type: string) =>
        type === 'material'
          ? [
              { id: 'iron', impactSound: 'sfx-impact-metal' },
              { id: 'copper', impactSound: 'sfx-impact-metal' },
            ]
          : [{ telegraph: 'glint' }, { telegraph: 'glint' }]) as never,
    };
    const facts = factDomains(content);
    expect(facts.get('target')).toEqual(['metal']);
    expect(facts.get('other')).toEqual(['metal']);
    expect(facts.get('weaponMaterial')).toEqual(['iron', 'copper']);
    expect(facts.get('material')).toEqual(['iron', 'copper']);
    expect(facts.get('telegraph')).toEqual(['glint']);
  });

  it('AC-1: every sound id the committed cue sheets can play resolves to a manifest entry', () => {
    const content = loadRepoContent(process.cwd());
    const { ids, unknownFacts } = cueSoundIds(content.all('cue-sheet'), factDomains(content));
    expect(unknownFacts).toEqual([]);
    expect(ids).toContain('sfx-impact-stone');
    expect(ids).toContain('sfx-combat-death-flesh');
    const manifest = new Set(readManifest(process.cwd()).map((entry) => entry.id));
    expect(ids.filter((id) => !manifest.has(id))).toEqual([]);
  });
});
