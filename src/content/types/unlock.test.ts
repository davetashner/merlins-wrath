import { describe, expect, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { describeContent } from '../testing.ts';
import type { CapabilityGroupInput } from './capability.ts';
import { checkUnlocks, unlockSchema, type UnlockGroupInput } from './unlock.ts';

type UnlockInput = UnlockGroupInput['unlocks'][number];

const group = (id: string, unlocks: UnlockInput[]): UnlockGroupInput => ({
  id,
  name: 'Test',
  notes: 'Test.',
  unlocks,
});

const capabilities = (ids: readonly string[], supporting: readonly string[] = []) => ({
  path: 'src/content/data/capability/zz-test.json',
  text: JSON.stringify({
    id: 'zz-test',
    name: 'Test',
    notes: 'Test.',
    capabilities: ids.map((id) => ({
      id,
      name: id,
      description: 'Test.',
      ...(supporting.includes(id) && { supporting: true }),
    })),
  } satisfies CapabilityGroupInput),
});

const unlockFile = (name: string, unlocks: UnlockInput[]): ContentSource => ({
  path: `src/content/data/unlock/${name}.json`,
  text: JSON.stringify(group(name, unlocks)),
});

const problems = (value: unknown) =>
  (unlockSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

function loadIssues(extra: readonly ContentSource[]): string[] {
  try {
    loadContent(contentTypes, [...gameContentSources(), ...extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

const TEST_CAPS = ['spell.zz-a', 'spell.zz-b', 'spell.zz-c', 'spell.zz-plus'];

describe('unlock schema (mw-e19.3)', () => {
  it('takes a capability, prerequisites, requirements, channels, replaces and supporting', () => {
    const full: UnlockInput = {
      capability: 'spell.telekinesis',
      prerequisites: ['spell.mage-hand'],
      requirements: { fact: 'abbey.library-open' },
      channels: ['book', 'deed'],
      replaces: 'spell.mage-hand',
      supporting: false,
    };
    expect(problems(group('test', [full]))).toEqual([]);
    expect(
      unlockSchema.parse(group('test', [{ capability: 'spell.ember', channels: ['book'] }])),
    ).toMatchObject({ unlocks: [{ prerequisites: [] }] });
  });

  it('rejects self-references, repeats, missing channels and unknown channels', () => {
    const bad: UnlockInput[] = [
      {
        capability: 'spell.ember',
        prerequisites: ['spell.ember', 'spell.mage-hand', 'spell.mage-hand'],
        channels: ['book', 'book'],
        replaces: 'spell.ember',
      },
      { capability: 'spell.ember', channels: [] },
      { capability: 'spell.firebolt', channels: ['shop' as 'book'] },
    ];
    expect(problems(group('test', bad))).toEqual([
      'unlocks.0.prerequisites.0: an unlock cannot require itself',
      'unlocks.0.prerequisites.2: "spell.mage-hand" is listed twice',
      'unlocks.0.channels: a channel is listed twice',
      'unlocks.0.replaces: an unlock cannot replace itself',
      'unlocks.1.channels: Too small: expected array to have >=1 items',
      'unlocks.2.channels.0: Invalid option: expected one of "book"|"trainer"|"schematic"|"trick"|"deed"',
    ]);
    const twice: UnlockInput = { capability: 'spell.ember', channels: ['book'] };
    expect(problems(group('test', [twice, twice]))).toEqual([
      'unlocks.1.capability: "spell.ember" has two unlocks in this file',
    ]);
  });
});

describe('unlock content checks (mw-e19.3)', () => {
  it('AC-6: rejects a prerequisite cycle, naming the path', () => {
    const issues = loadIssues([
      capabilities(TEST_CAPS),
      unlockFile('zz-cycle', [
        { capability: 'spell.zz-a', prerequisites: ['spell.zz-c'], channels: ['book'] },
        { capability: 'spell.zz-b', prerequisites: ['spell.zz-a'], channels: ['book'] },
        { capability: 'spell.zz-c', channels: ['book'], replaces: 'spell.zz-b' },
      ]),
    ]);
    expect(issues).toEqual([
      'src/content/data/unlock/zz-cycle.json#/unlocks/1/prerequisites/0: prerequisite cycle: spell.zz-a → spell.zz-c → spell.zz-b → spell.zz-a',
    ]);
  });

  it('AC-6: rejects a self-replacing chain across files and reports each cycle once', () => {
    const issues = loadIssues([
      capabilities(TEST_CAPS),
      unlockFile('zz-one', [
        { capability: 'spell.zz-a', channels: ['book'], replaces: 'spell.zz-b' },
        { capability: 'spell.zz-c', prerequisites: ['spell.zz-a'], channels: ['book'] },
      ]),
      unlockFile('zz-two', [
        { capability: 'spell.zz-b', prerequisites: ['spell.zz-a'], channels: ['book'] },
      ]),
    ]);
    expect(issues).toEqual([
      'src/content/data/unlock/zz-two.json#/unlocks/0/prerequisites/0: prerequisite cycle: spell.zz-a → spell.zz-b → spell.zz-a',
    ]);
  });

  it('AC-6: rejects a pure numeric upgrade unless it is flagged supporting', () => {
    const plus = (supporting?: boolean): UnlockInput => ({
      capability: 'spell.zz-plus',
      prerequisites: ['spell.zz-a'],
      channels: ['book'],
      ...(supporting !== undefined && { supporting }),
    });
    const caps = capabilities(TEST_CAPS, ['spell.zz-plus']);
    const root: UnlockInput = { capability: 'spell.zz-a', channels: ['book'] };
    expect(loadIssues([caps, unlockFile('zz-numeric', [root, plus()])])).toEqual([
      'src/content/data/unlock/zz-numeric.json#/unlocks/1/capability: "spell.zz-plus" is a supporting (numeric) capability, so this unlock is a pure numeric upgrade: flag it "supporting": true or make it grant a new verb (ADR-0004 P1)',
    ]);
    expect(loadIssues([caps, unlockFile('zz-numeric', [root, plus(false)])])).toHaveLength(1);
    expect(loadIssues([caps, unlockFile('zz-numeric', [root, plus(true)])])).toEqual([]);
  });

  it('rejects undeclared capabilities and a second unlock for a capability', () => {
    const issues = loadIssues([
      unlockFile('zz-bad', [
        {
          capability: 'spell.zz-nope',
          prerequisites: ['spell.zz-gone'],
          channels: ['book'],
          replaces: 'spell.zz-old',
        },
        { capability: 'spell.ember', channels: ['deed'] },
      ]),
    ]);
    expect(issues).toEqual([
      'src/content/data/unlock/zz-bad.json#/unlocks/0/capability: capability "spell.zz-nope" is not declared: add it to src/content/data/capability/',
      'src/content/data/unlock/zz-bad.json#/unlocks/0/prerequisites/0: capability "spell.zz-gone" is not declared: add it to src/content/data/capability/',
      'src/content/data/unlock/zz-bad.json#/unlocks/0/replaces: capability "spell.zz-old" is not declared: add it to src/content/data/capability/',
      'src/content/data/unlock/zz-bad.json#/unlocks/1/capability: "spell.ember" already has an unlock in src/content/data/unlock/sorcerer-fire.json',
    ]);
  });

  it('checks requirements against the fact registry', () => {
    const issues = loadIssues([
      capabilities(TEST_CAPS),
      unlockFile('zz-req', [
        { capability: 'spell.zz-a', channels: ['book'], requirements: { fact: 'zz.undeclared' } },
        { capability: 'spell.zz-b', channels: ['book'] },
      ]),
    ]);
    expect(issues).toEqual([
      'src/content/data/unlock/zz-req.json#/unlocks/0/requirements/fact: unlock:zz-req names undeclared fact "zz.undeclared": declare it in src/content/data/fact/',
    ]);
  });

  it('ignores other content types', () => {
    expect(checkUnlocks([{ type: 'fact', file: 'f.json', value: { id: 'f' } }])).toEqual([]);
  });
});

describeContent(
  'unlock',
  'AC-6: declared, acyclic, and no pure numeric upgrade unless supporting',
  (entry, content) => {
    // Every unlock, so a cycle through another file is caught; issues name this entry's file.
    const entries = [
      ...content.all('capability').map((value) => ({ type: 'capability', file: '', value })),
      ...content.all('unlock').map((value) => ({ type: 'unlock', file: value.id, value })),
    ];
    expect(checkUnlocks(entries).filter(({ file }) => file === entry.id)).toEqual([]);
    for (const unlock of entry.unlocks) expect(unlock.channels.length).toBeGreaterThan(0);
  },
);
