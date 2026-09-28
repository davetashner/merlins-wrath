// Tests for the frozen creature fixtures (mw-e12.3). These pin the traits AI and stealth tests rely
// on; changing a fixture value requires updating the scenario tests that depend on it.

import { describe, expect, it } from 'vitest';
import { readContentSources } from './fs-sources.ts';
import { GAME_CONTENT_ROOT, gameContentSources, loadGameContent } from './game-content.ts';
import { loadContent } from './loader.ts';
import { contentTypes } from './registry.ts';
import {
  FIXTURE_CONTENT_ROOT,
  FIXTURE_CREATURE_IDS,
  fixtureContentSources,
  loadFixtureContent,
} from './test-fixtures.ts';
import { creatureSchema } from './types/creature.ts';
import {
  canEnterArea,
  canTraverseLink,
  deriveNavAgent,
  resolveLocomotion,
} from './types/locomotion.ts';
import { resolveSenses } from './types/sense.ts';

const content = loadFixtureContent();
const creature = (id: string) => content.get('creature', id);
const senses = (id: string) => resolveSenses(creature(id).senses, content);
const nav = (id: string) => deriveNavAgent(resolveLocomotion(creature(id).locomotion, content));

describe('creature fixtures', () => {
  it('reads the fixture files from their own root, one per fixture id', () => {
    const sources = [...fixtureContentSources()].sort((a, b) => (a.path < b.path ? -1 : 1));
    expect(sources).toEqual(readContentSources(FIXTURE_CONTENT_ROOT));
    expect(sources.map((s) => s.path)).toEqual(
      FIXTURE_CREATURE_IDS.map((id) => `${FIXTURE_CONTENT_ROOT}/creature/${id}.json`),
    );
  });

  it('AC-1: the three fixture files validate against CreatureDef', () => {
    for (const source of fixtureContentSources()) {
      const json = JSON.parse(source.text) as Record<string, unknown>;
      delete json['$schema'];
      expect(creatureSchema.safeParse(json).error).toBeUndefined();
    }
    // …and load with their profile refs resolved against the game's content.
    expect(content.all('creature').map((c) => c.id)).toEqual(
      expect.arrayContaining([...FIXTURE_CREATURE_IDS]),
    );
  });

  it('AC-1: every fixture is tagged test-fixture, capsule-only and has no attacks', () => {
    const fixtures = FIXTURE_CREATURE_IDS.map(creature);
    expect(fixtures.map((c) => c.tags.includes('test-fixture'))).toEqual([true, true, true]);
    expect(fixtures.map((c) => c.presentation.mesh)).toEqual(Array(3).fill('placeholder-capsule'));
    expect(fixtures.map((c) => c.attacks)).toEqual([[], [], []]);
  });

  it('AC-1: senses and locomotion resolve to complete profiles', () => {
    for (const id of FIXTURE_CREATURE_IDS) {
      expect(() => senses(id)).not.toThrow();
      expect(nav(id).mask).toBeGreaterThan(0);
    }
  });

  it('AC-2: the production content build contains no fixture creature', () => {
    const manifest = gameContentSources();
    expect(manifest.every((s) => s.path.startsWith(`${GAME_CONTENT_ROOT}/`))).toBe(true);
    const shipped = loadGameContent()
      .all('creature')
      .map((c) => c.id);
    expect(shipped.filter((id) => id.startsWith('fixture-'))).toEqual([]);
    const mentions = manifest.filter((s) => FIXTURE_CREATURE_IDS.some((id) => s.text.includes(id)));
    expect(mentions.map((s) => s.path)).toEqual([]);
  });

  it('AC-2: the fixtures are exactly what loadFixtureContent adds to the game content', () => {
    const game = loadContent(contentTypes, gameContentSources());
    const added = content
      .all('creature')
      .map((c) => c.id)
      .filter((id) => !game.has('creature', id));
    expect(added).toEqual([...FIXTURE_CREATURE_IDS]);
  });

  it('AC-3: fixture-sentinel has dark vision 1.0 and declares the life-sense channel', () => {
    const resolved = senses('fixture-sentinel');
    expect(resolved.sight?.darkVision).toBe(1);
    expect(Object.keys(resolved.special ?? {})).toContain('life-sense');
    expect(resolved.special?.['life-sense']?.range).toBe(3);
  });

  it('fixture-sentinel never sleeps and fixture-guard patrols, communicates and sleeps', () => {
    expect(creature('fixture-sentinel').needs).toEqual({});
    expect(creature('fixture-sentinel').tags).toContain('never-sleeps');
    expect(creature('fixture-guard').tags).toEqual(
      expect.arrayContaining(['patrols', 'communicates']),
    );
    expect(Object.keys(creature('fixture-guard').needs)).toEqual(['sleep']);
  });

  it('fixture-guard is sight-dominant: long sight, no smell, needs light', () => {
    const guard = senses('fixture-guard');
    const hound = senses('fixture-hound');
    expect(guard.sight?.farRange).toBeGreaterThan(hound.sight?.farRange ?? Infinity);
    expect(guard.smell).toBeUndefined();
    expect(guard.sight?.darkVision).toBeLessThan(0.5);
  });

  it('fixture-hound is hearing and smell dominant and the fastest fixture', () => {
    const hound = senses('fixture-hound');
    const guard = senses('fixture-guard');
    expect(hound.hearing?.thresholdDb).toBeLessThan(guard.hearing?.thresholdDb ?? 0);
    expect(hound.smell).toMatchObject({ tracksScentTrails: true });
    const run = (id: string) =>
      resolveLocomotion(creature(id).locomotion, content).modes.walk?.speeds.run ?? 0;
    expect(run('fixture-hound')).toBeGreaterThan(run('fixture-guard'));
    expect(run('fixture-guard')).toBeGreaterThan(run('fixture-sentinel'));
  });

  it('nav capabilities: only the guard climbs, the hound opens no doors, the sentinel never jumps', () => {
    const agents = FIXTURE_CREATURE_IDS.map(nav);
    const climb = { kind: 'climb', grade: 1 } as const;
    const door = { kind: 'door' } as const;
    const jump = { kind: 'jump', rise: 0.5 } as const;
    expect(agents.map((a) => canTraverseLink(a, climb))).toEqual([true, false, false]);
    expect(agents.map((a) => canTraverseLink(a, door))).toEqual([true, false, true]);
    expect(agents.map((a) => canTraverseLink(a, jump))).toEqual([true, true, false]);
    expect(agents.map((a) => canEnterArea(a, 'water-deep'))).toEqual([true, false, false]);
  });
});
