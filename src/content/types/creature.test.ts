import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readContentSources } from '../fs-sources.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { ContentRef, contentId, serializeContent } from '../schema.ts';
import { creatureSchema, type CreatureDefInput } from './creature.ts';

const minimal = {
  id: 'fixture-walker',
  family: 'human',
  stats: { health: 100, poise: 40, mass: 80, size: 'medium' },
  senses: { sight: { range: 20, halfAngle: 60 } },
  locomotion: [{ mode: 'walk', speed: 1.5 }],
} satisfies CreatureDefInput;

const source = (path: string, json: unknown): ContentSource => ({
  path,
  text: JSON.stringify(json),
});

const loadIssues = (sources: readonly ContentSource[], schemas = contentTypes) => {
  try {
    loadContent(schemas, sources);
  } catch (error) {
    if (error instanceof ContentLoadError) return error;
  }
  throw new Error('expected loading to fail');
};

/** The game registry plus stub `attack` and `sense` types, until e12.5 and e12.2 register theirs. */
const withTargets = {
  ...contentTypes,
  attack: z.strictObject({ id: contentId }),
  sense: z.strictObject({ id: contentId }),
};

describe('creature schema', () => {
  it('AC-1: a file with only id, family, stats, senses and locomotion passes with every default filled', () => {
    const content = loadContent(
      contentTypes,
      readContentSources('src/content/fixtures/creature-valid'),
    );
    expect(content.get('creature', 'minimal-walker')).toEqual({
      id: 'minimal-walker',
      schemaVersion: 1,
      family: 'human',
      tags: [],
      stats: { health: 100, poise: 40, mass: 80, size: 'medium' },
      senses: {
        sight: { range: 20, halfAngle: 60 },
        hearing: { thresholdDb: 30, range: 25 },
      },
      locomotion: [{ mode: 'walk', speed: 1.5 }],
      attacks: [],
      properties: [],
      resistances: {},
      faction: 'unaligned',
      disposition: { towardPlayer: 'hostile' },
      fears: [],
      personality: {
        bravery: 0.5,
        curiosity: 0.5,
        aggression: 0.5,
        diligence: 0.5,
        sociability: 0.5,
        greed: 0.5,
      },
      needs: {},
      behaviour: { profile: 'default', tuning: {} },
      interactions: [],
      presentation: { mesh: 'placeholder-capsule', sfx: 'placeholder' },
    });
  });

  it('AC-1: defaults are fresh per entry, so freezing one entry never freezes another', () => {
    const a = creatureSchema.parse(minimal);
    const b = creatureSchema.parse({ ...minimal, id: 'other' });
    expect(a.tags).not.toBe(b.tags);
    expect(a.behaviour.tuning).not.toBe(b.behaviour.tuning);
  });

  it('AC-2: a file missing stats.health fails naming the file and stats.health', () => {
    const file = 'src/content/fixtures/creature-invalid/creature/missing-health.json';
    const error = loadIssues(readContentSources('src/content/fixtures/creature-invalid'));
    expect(error.issues).toEqual([
      {
        file,
        pointer: '/stats/health',
        message: expect.stringContaining('stats.health') as string,
      },
    ]);
    expect(error.message).toContain(file);
    expect(error.message).toContain('stats.health');
  });

  it('AC-3: every unresolved ref is listed, not just the first', () => {
    const error = loadIssues([
      source('data/creature/a.json', {
        ...minimal,
        id: 'a',
        senses: 'no-such-profile',
        attacks: ['does-not-exist', 'also-missing'],
      }),
      source('data/creature/b.json', { ...minimal, id: 'b', attacks: ['does-not-exist'] }),
    ]);
    expect(error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`)).toEqual([
      'data/creature/a.json#/senses: creature:a references missing sense:no-such-profile',
      'data/creature/a.json#/attacks/0: creature:a references missing attack:does-not-exist',
      'data/creature/a.json#/attacks/1: creature:a references missing attack:also-missing',
      'data/creature/b.json#/attacks/0: creature:b references missing attack:does-not-exist',
    ]);
  });

  it('AC-3: refs to existing attacks and sense profiles resolve to their entries', () => {
    const content = loadContent(withTargets, [
      source('data/attack/overhead-chop.json', { id: 'overhead-chop' }),
      source('data/sense/undead.json', { id: 'undead' }),
      source('data/creature/a.json', {
        ...minimal,
        id: 'a',
        senses: 'undead',
        attacks: ['overhead-chop'],
      }),
    ]);
    const creature = content.get('creature', 'a');
    expect(creature.senses).toEqual(new ContentRef('sense', 'undead'));
    expect(creature.attacks.map((attack) => content.resolve(attack))).toEqual([
      { id: 'overhead-chop' },
    ]);
  });

  it('AC-4: two files with the same id fail with a duplicate-id error naming both files', () => {
    const error = loadIssues([
      source('data/creature/walker.json', minimal),
      source('data/creature/walker-copy.json', minimal),
    ]);
    expect(error.issues).toEqual([
      {
        file: 'data/creature/walker.json',
        pointer: '/id',
        message:
          'duplicate id creature:fixture-walker: already defined in data/creature/walker-copy.json',
      },
    ]);
  });

  it('AC-5: a full creature round-trips through serialize → parse unchanged', () => {
    const full = creatureSchema.parse({
      ...minimal,
      schemaVersion: 1,
      family: 'forgotten',
      tags: ['undead', 'miner'],
      senses: 'undead',
      locomotion: [
        { mode: 'walk', speed: 1.2 },
        { mode: 'climb', speed: 0.5 },
      ],
      attacks: ['overhead-chop', 'lunging-thrust'],
      properties: ['brittle'],
      resistances: { blunt: 1.5, pierce: 0.5, poison: 0 },
      faction: 'forgotten',
      disposition: { towardPlayer: 'wary' },
      fears: [{ kind: 'property', stimulus: 'burning', intensity: 30 }],
      personality: { diligence: 0.9, curiosity: 0.1 },
      needs: { sleep: { ratePerMinute: 2, threshold: 80 } },
      behaviour: { profile: 'habit-keeper', tuning: { searchSeconds: 20 } },
      interactions: ['hum-hymn'],
      loot: 'miner-scraps',
      presentation: { mesh: 'forgotten-miner', sfx: 'forgotten' },
    } satisfies CreatureDefInput);
    const text = serializeContent(full);
    expect(JSON.parse(text)).toMatchObject({
      senses: 'undead',
      attacks: ['overhead-chop', 'lunging-thrust'],
    });
    expect(creatureSchema.parse(JSON.parse(text))).toEqual(full);
  });

  it('rejects out-of-range and repeated values with their JSON paths', () => {
    const result = creatureSchema.safeParse({
      ...minimal,
      stats: { ...minimal.stats, health: 0 },
      locomotion: [
        { mode: 'walk', speed: 1 },
        { mode: 'walk', speed: 2 },
      ],
      resistances: { blunt: 3.5, holy: 1 },
      fears: [{ kind: 'property', stimulus: 'burning', intensity: 101 }],
      personality: { greed: 2 },
    });
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'stats.health',
      'locomotion',
      'resistances.blunt',
      'resistances', // unknown damage type "holy"
      'fears.0.intensity',
      'personality.greed',
    ]);
  });

  it('requires at least one locomotion mode (stationary creatures say so)', () => {
    expect(creatureSchema.safeParse({ ...minimal, locomotion: [] }).success).toBe(false);
    const still = { ...minimal, locomotion: [{ mode: 'stationary', speed: 0 }] };
    expect(creatureSchema.safeParse(still).success).toBe(true);
  });
});
