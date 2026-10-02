import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { ConditionError } from '../facts/conditions';
import {
  addCapabilities,
  capabilityGained,
  capabilityLost,
  CapabilityRegistry,
  capabilitySources,
  hasCapability,
  type CapabilityChange,
} from './capabilities';
import {
  LEARNED_SOURCE,
  progressionLearned,
  refusalText,
  UnlockBook,
  type CapabilityLearned,
  type LearnRule,
  type UnlockDef,
} from './unlocks';

const IDS = [
  'spell.ember',
  'spell.firebolt',
  'spell.flame-jet',
  'spell.fire-wall',
  'spell.mage-hand',
  'spell.telekinesis',
  'spell.telekinetic-throw',
  'technique.shield-bash',
];

const FIRE: readonly UnlockDef[] = [
  { capability: 'spell.ember', prerequisites: [], channels: ['book', 'deed'] },
  { capability: 'spell.firebolt', prerequisites: ['spell.ember'], channels: ['book'] },
  { capability: 'spell.flame-jet', prerequisites: ['spell.ember'], channels: ['book'] },
  {
    capability: 'spell.fire-wall',
    prerequisites: ['spell.flame-jet', 'spell.firebolt'],
    channels: ['book'],
  },
];

const TELEKINESIS: readonly UnlockDef[] = [
  { capability: 'spell.mage-hand', prerequisites: [], channels: ['book'] },
  {
    capability: 'spell.telekinesis',
    prerequisites: ['spell.mage-hand'],
    channels: ['book'],
    replaces: 'spell.mage-hand',
  },
  {
    capability: 'spell.telekinetic-throw',
    prerequisites: ['spell.telekinesis'],
    channels: ['book'],
    replaces: 'spell.telekinesis',
  },
];

const BOOK = 'book:vesperine-hours';

/** A world with one actor, an unlock book over IDS, and every event the learns emit. */
function setup(unlocks: readonly UnlockDef[] = [...FIRE, ...TELEKINESIS], rules?: LearnRule[]) {
  const world = new World({ seed: 1 });
  const actor = world.spawn();
  addCapabilities(world, actor);
  const registry = new CapabilityRegistry(IDS);
  const book = new UnlockBook(registry, unlocks, rules);
  const events: [string, CapabilityChange | CapabilityLearned][] = [];
  world.events.on(capabilityGained, (e) => events.push(['gained', e]));
  world.events.on(capabilityLost, (e) => events.push(['lost', e]));
  world.events.on(progressionLearned, (e) => events.push(['learned', e]));
  const flush = () => {
    world.events.flush();
    return events.splice(0);
  };
  return { world, actor, registry, book, flush };
}

describe('capability unlocks (mw-e19.3)', () => {
  it('AC-1: learning Flame Jet without Ember fails with missing-prerequisite: spell.ember', () => {
    const { world, actor, book, flush } = setup();
    const result = book.learn(world, actor, 'spell.flame-jet', BOOK);
    expect(result).toEqual({
      status: 'refused',
      capability: 'spell.flame-jet',
      refusals: [{ reason: 'missing-prerequisite', capability: 'spell.ember' }],
    });
    expect(result.status === 'refused' && result.refusals.map(refusalText)).toEqual([
      'missing-prerequisite: spell.ember',
    ]);
    // A refusal changes nothing.
    expect(hasCapability(world, actor, 'spell.flame-jet')).toBe(false);
    expect(flush()).toEqual([]);
  });

  it('AC-1: a refusal lists every missing prerequisite, in definition order', () => {
    const { world, actor, book } = setup();
    expect(book.check(world, actor, 'spell.fire-wall', BOOK)).toEqual({
      status: 'refused',
      capability: 'spell.fire-wall',
      refusals: [
        { reason: 'missing-prerequisite', capability: 'spell.flame-jet' },
        { reason: 'missing-prerequisite', capability: 'spell.firebolt' },
      ],
    });
  });

  it('AC-2: with prerequisites met, learning grants source learned and emits progression.learned with the channel', () => {
    const { world, actor, book, flush } = setup();
    expect(book.learn(world, actor, 'spell.ember', 'deed:deepworks-fall')).toEqual({
      status: 'learned',
      capability: 'spell.ember',
      channel: 'deed:deepworks-fall',
    });
    flush();
    expect(book.check(world, actor, 'spell.flame-jet', BOOK).status).toBe('learned');
    // check is a dry run.
    expect(hasCapability(world, actor, 'spell.flame-jet')).toBe(false);

    expect(book.learn(world, actor, 'spell.flame-jet', BOOK)).toEqual({
      status: 'learned',
      capability: 'spell.flame-jet',
      channel: BOOK,
    });
    expect(capabilitySources(world, actor, 'spell.flame-jet')).toEqual([LEARNED_SOURCE]);
    expect(flush()).toEqual([
      ['gained', { tick: 0, actor, capability: 'spell.flame-jet', source: 'learned' }],
      ['learned', { tick: 0, actor, capability: 'spell.flame-jet', channel: BOOK }],
    ]);
  });

  it('AC-2: a verb chain unlocks step by step (Ember → Firebolt and Flame Jet → Fire Wall)', () => {
    const { world, actor, book } = setup();
    for (const id of ['spell.ember', 'spell.firebolt', 'spell.flame-jet', 'spell.fire-wall']) {
      expect(book.learn(world, actor, id, BOOK).status, id).toBe('learned');
    }
    expect(hasCapability(world, actor, 'spell.fire-wall')).toBe(true);
  });

  it('AC-2: a prerequisite held only through an item still counts', () => {
    const { world, actor, registry, book } = setup();
    registry.grant(world, actor, 'spell.ember', 'equipment:ember-wand');
    expect(book.learn(world, actor, 'spell.firebolt', BOOK).status).toBe('learned');
  });

  it('AC-3: learning a known capability again is a no-op returning already-known', () => {
    const { world, actor, book, flush } = setup();
    book.learn(world, actor, 'spell.ember', BOOK);
    flush();
    expect(book.learn(world, actor, 'spell.ember', 'book:other-book')).toEqual({
      status: 'already-known',
      capability: 'spell.ember',
    });
    expect(capabilitySources(world, actor, 'spell.ember')).toEqual([LEARNED_SOURCE]);
    expect(flush()).toEqual([]);
  });

  it('AC-3: a class grant is known; an item grant alone is not, so learning makes it permanent', () => {
    const { world, actor, registry, book, flush } = setup();
    registry.grant(world, actor, 'spell.ember', 'class');
    expect(book.learn(world, actor, 'spell.ember', BOOK).status).toBe('already-known');

    registry.grant(world, actor, 'spell.mage-hand', 'equipment:mage-glove');
    flush();
    expect(book.knows(world, actor, 'spell.mage-hand')).toBe(false);
    expect(book.learn(world, actor, 'spell.mage-hand', BOOK).status).toBe('learned');
    expect(capabilitySources(world, actor, 'spell.mage-hand')).toEqual([
      'equipment:mage-glove',
      LEARNED_SOURCE,
    ]);
    // Already held, so no capability.gained; the learn itself is still reported.
    expect(flush()).toEqual([
      ['learned', { tick: 0, actor, capability: 'spell.mage-hand', channel: BOOK }],
    ]);
  });

  it('AC-4: a replacing unlock revokes the old learned source and grants the new one in one call', () => {
    const { world, actor, book, flush } = setup();
    book.learn(world, actor, 'spell.mage-hand', BOOK);
    flush();
    expect(book.learn(world, actor, 'spell.telekinesis', BOOK)).toEqual({
      status: 'learned',
      capability: 'spell.telekinesis',
      channel: BOOK,
      replaced: 'spell.mage-hand',
    });
    expect(hasCapability(world, actor, 'spell.mage-hand')).toBe(false);
    expect(capabilitySources(world, actor, 'spell.telekinesis')).toEqual([LEARNED_SOURCE]);
    expect(flush()).toEqual([
      ['gained', { tick: 0, actor, capability: 'spell.telekinesis', source: 'learned' }],
      ['lost', { tick: 0, actor, capability: 'spell.mage-hand', source: 'learned' }],
      [
        'learned',
        {
          tick: 0,
          actor,
          capability: 'spell.telekinesis',
          channel: BOOK,
          replaced: 'spell.mage-hand',
        },
      ],
    ]);
  });

  it('AC-4: a subsumed capability stays known, for prerequisites and for learning it again', () => {
    const { world, actor, book } = setup();
    for (const id of ['spell.mage-hand', 'spell.telekinesis', 'spell.telekinetic-throw']) {
      expect(book.learn(world, actor, id, BOOK).status, id).toBe('learned');
    }
    // Throw replaced Telekinesis, which replaced Mage Hand: both are subsumed, transitively.
    expect(hasCapability(world, actor, 'spell.telekinesis')).toBe(false);
    expect(book.knows(world, actor, 'spell.mage-hand')).toBe(true);
    expect(book.learn(world, actor, 'spell.mage-hand', BOOK).status).toBe('already-known');
  });

  it('AC-4: a subsumer held through an item satisfies a prerequisite on what it subsumes', () => {
    const { world, actor, registry, book } = setup();
    registry.grant(world, actor, 'spell.telekinesis', 'equipment:tk-ring');
    expect(book.check(world, actor, 'spell.telekinesis', BOOK).status).toBe('learned');
  });

  it('AC-4: a replaced capability also granted by another source keeps that grant', () => {
    const { world, actor, registry, book } = setup();
    registry.grant(world, actor, 'spell.mage-hand', 'class');
    book.learn(world, actor, 'spell.telekinesis', BOOK);
    expect(capabilitySources(world, actor, 'spell.mage-hand')).toEqual(['class']);
  });

  it('explains every refusal: unknown, wrong channel, unmet requirements and extra rules', () => {
    const offClass: LearnRule = ({ unlock }) =>
      unlock.capability === 'technique.shield-bash'
        ? { reason: 'rule', rule: 'off-class', key: 'progression.off-class.knight' }
        : undefined;
    const unlocks: UnlockDef[] = [
      {
        capability: 'technique.shield-bash',
        prerequisites: [],
        channels: ['trainer'],
        requirements: { fact: 'hale.trusts-you' },
      },
      ...FIRE,
    ];
    const { world, actor, book } = setup(unlocks, [offClass]);
    expect(book.unlockFor('spell.mage-hand')).toBeUndefined();
    const notLearnable = book.check(world, actor, 'spell.mage-hand', BOOK);
    expect(notLearnable).toEqual({
      status: 'refused',
      capability: 'spell.mage-hand',
      refusals: [{ reason: 'not-learnable' }],
    });

    const result = book.check(world, actor, 'technique.shield-bash', BOOK);
    const texts = result.status === 'refused' ? result.refusals.map(refusalText) : [];
    expect(texts).toEqual([
      'wrong-channel: book:vesperine-hours (taught by trainer)',
      'requirement-unmet: fact(hale.trusts-you)',
      'off-class: progression.off-class.knight',
    ]);
    expect(refusalText({ reason: 'not-learnable' })).toBe('not-learnable');

    world.facts.set('hale.trusts-you', true);
    expect(book.check(world, actor, 'technique.shield-bash', 'trainer:hale')).toEqual({
      status: 'refused',
      capability: 'technique.shield-bash',
      refusals: [{ reason: 'rule', rule: 'off-class', key: 'progression.off-class.knight' }],
    });
    expect(book.check(world, actor, 'spell.ember', BOOK).status).toBe('learned');
  });

  it('rejects malformed channels and bad definitions', () => {
    const { world, actor, book } = setup();
    expect(() => book.learn(world, actor, 'spell.ember', 'book')).toThrow(RangeError);
    expect(() => book.check(world, actor, 'spell.ember', 'shop:tidemarket')).toThrow(
      /not a learn channel/,
    );
    const registry = new CapabilityRegistry(IDS);
    const ember: UnlockDef = { capability: 'spell.ember', prerequisites: [], channels: ['book'] };
    expect(() => new UnlockBook(registry, [ember, ember])).toThrow(/defined twice/);
    expect(
      () => new UnlockBook(registry, [{ ...ember, prerequisites: ['spell.firebal'] }]),
    ).toThrow(/undeclared capability "spell.firebal"/);
    expect(() => new UnlockBook(registry, [{ ...ember, channels: [] }])).toThrow(/no channel/);
    expect(() => new UnlockBook(registry, [{ ...ember, replaces: 'spell.ember' }])).toThrow(
      /replaces itself/,
    );
    expect(() => new UnlockBook(registry, [{ ...ember, requirements: { all: [] } }])).toThrow(
      ConditionError,
    );
  });

  it('stays finite on a replacement cycle (content rejects them; AC-6)', () => {
    const cycle: UnlockDef[] = [
      {
        capability: 'spell.ember',
        prerequisites: [],
        channels: ['book'],
        replaces: 'spell.firebolt',
      },
      {
        capability: 'spell.firebolt',
        prerequisites: [],
        channels: ['book'],
        replaces: 'spell.ember',
      },
    ];
    const { world, actor, book } = setup(cycle);
    expect(book.knows(world, actor, 'spell.ember')).toBe(false);
  });
});
