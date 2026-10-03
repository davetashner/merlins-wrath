import { describe, expect, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { describeContent } from '../testing.ts';
import { RESPAWN_RULES_ID, respawnRulesSchema, type RespawnRulesInput } from './respawn-rules.ts';

const RULES_FILE = 'src/content/data/respawn-rules/respawn-rules.json';

type RuleInput = RespawnRulesInput['rules'][number];

const rule = (over: Partial<RuleInput> = {}): RuleInput => ({
  id: 'slice-reload',
  region: 'slice',
  destination: { scene: 'slice', spawn: 'player-start' },
  mode: 'reload',
  ...over,
});

const table = (rules: RuleInput[]): RespawnRulesInput => ({
  id: RESPAWN_RULES_ID,
  notes: 'Test.',
  deathBeatSeconds: 1.5,
  rules,
});

/** Issues from loading the game's content with the rules file replaced by `json`. */
function loadIssues(json: unknown): string[] {
  const sources: ContentSource[] = [
    ...gameContentSources().filter((s) => s.path !== RULES_FILE),
    { path: RULES_FILE, text: JSON.stringify(json) },
  ];
  try {
    loadContent(contentTypes, sources, contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describe('respawn rules (mw-e01.8)', () => {
  describeContent(
    'respawn-rules',
    'AC-5: every destination references an existing scene spawn point',
    (entry, content) => {
      expect(entry.id).toBe(RESPAWN_RULES_ID);
      expect(entry.deathBeatSeconds).toBe(1.5);
      expect(entry.rules.length).toBeGreaterThan(0);
      for (const { destination } of entry.rules) {
        const scene = content.get('scene', destination.scene.id);
        expect(scene.spawns.map(({ id }) => id)).toContain(destination.spawn);
      }
    },
  );

  it('m1: a death in the slice reloads the last save', () => {
    const content = loadContent(contentTypes, gameContentSources(), contentChecks);
    const slice = content
      .get('respawn-rules', RESPAWN_RULES_ID)
      .rules.filter(({ region }) => region.id === 'slice');
    expect(slice.map(({ id, mode }) => ({ id, mode }))).toEqual([
      { id: 'slice-reload', mode: 'reload' },
    ]);
  });

  it('AC-5: a destination spawn its scene does not place fails validation naming it', () => {
    expect(
      loadIssues(table([rule({ destination: { scene: 'slice', spawn: 'nowhere' } })])),
    ).toEqual([
      `${RULES_FILE}#/rules/0/destination/spawn: respawn rule "slice-reload" sends the player to spawn "nowhere", which scene "slice" (src/content/data/scene/slice.json) does not place`,
    ]);
  });

  it('AC-5: a destination or region naming no scene fails the reference check', () => {
    expect(
      loadIssues(
        table([
          rule({ region: 'atlantis', destination: { scene: 'atlantis', spawn: 'player-start' } }),
        ]),
      ),
    ).toEqual([
      `${RULES_FILE}#/rules/0/region: respawn-rules:respawn-rules references missing scene:atlantis`,
      `${RULES_FILE}#/rules/0/destination/scene: respawn-rules:respawn-rules references missing scene:atlantis`,
    ]);
  });

  it('checks conditions and written facts against the fact registry', () => {
    expect(
      loadIssues(
        table([
          rule({
            conditions: { fact: 'slice.nope' },
            factsToSet: [{ fact: 'slice.complete', value: 3 }],
          }),
        ]),
      ),
    ).toEqual([
      `${RULES_FILE}#/rules/0/conditions/fact: respawn-rules:respawn-rules names undeclared fact "slice.nope": declare it in src/content/data/fact/`,
      expect.stringMatching(
        /^src\/content\/data\/respawn-rules\/respawn-rules\.json#\/rules\/0\/factsToSet\/0\/fact: respawn-rules:respawn-rules .*slice\.complete/,
      ),
    ]);
    expect(
      loadIssues(table([rule({ factsToSet: [{ fact: 'slice.complete', value: false }] })])),
    ).toEqual([]);
  });

  it('rejects duplicate rule ids, a negative beat and any id but "respawn-rules"', () => {
    const twice = respawnRulesSchema.safeParse(table([rule(), rule({ region: 'testbed' })]));
    expect(twice.error?.issues.map(({ message, path }) => ({ message, path }))).toEqual([
      { message: '"slice-reload" is defined twice', path: ['rules', 1, 'id'] },
    ]);
    expect(respawnRulesSchema.safeParse({ ...table([]), deathBeatSeconds: -1 }).success).toBe(
      false,
    );
    expect(respawnRulesSchema.safeParse({ ...table([]), id: 'other' }).success).toBe(false);
    const parsed = respawnRulesSchema.parse(table([rule()]));
    expect(parsed.rules[0]).toMatchObject({ priority: 0, factsToSet: [] });
  });
});
