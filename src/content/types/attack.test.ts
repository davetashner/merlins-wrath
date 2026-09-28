// Tests for the attack content type (mw-e12.5): schema rules, the cross-entry checks compileAttack
// makes, and a per-entry test for every attack the game ships.

import { describe, expect, it } from 'vitest';
import { loadContent, type ContentSource } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { serializeContent } from '../schema.ts';
import { loadGameContent } from '../game-content.ts';
import { loadFixtureContent } from '../test-fixtures.ts';
import { markExercised } from '../testing.ts';
import {
  AttackCompileError,
  attackSchema,
  compileAttack,
  compileAttacks,
  type AttackDefInput,
} from './attack.ts';
import { compileMoves, type MoveDefInput } from './move.ts';

const hitbox = {
  track: 'test-track',
  shape: { kind: 'sphere', center: { x: 0, y: 1.2, z: 0.8 }, radius: 0.25 },
  reach: 'short',
  swing: 'thrust',
} as const;

const strikeMove = {
  id: 'strike',
  notes: 'Test move.',
  verb: 'attack',
  frames: { startup: 18, active: 4, recovery: 10 },
  damage: { amounts: { slash: 10 }, poiseDamage: 5 },
  hitbox,
  presentation: { anim: 'anim-strike' },
} satisfies MoveDefInput;

const swipeMove = {
  ...strikeMove,
  id: 'swipe',
  hitbox: {
    ...hitbox,
    shape: {
      kind: 'capsule',
      from: { x: 0, y: 1, z: 0 },
      to: { x: 0, y: 1, z: 1 },
      radius: 0.2,
    },
  },
} satisfies MoveDefInput;

const rollMove = {
  id: 'roll',
  notes: 'Test move.',
  verb: 'dodge',
  frames: { startup: 0, active: 10, recovery: 5 },
  presentation: { anim: 'anim-roll' },
} satisfies MoveDefInput;

const melee = {
  id: 'guard-strike',
  notes: 'Test attack.',
  kind: 'melee',
  move: 'strike',
  telegraph: 'guard-strike-windup',
  range: { min: 0.5, max: 2 },
} satisfies AttackDefInput;

const bolt = {
  ...melee,
  id: 'bolt',
  kind: 'projectile',
  projectile: { speed: 12, maxRange: 20 },
} satisfies AttackDefInput;

const source = (type: string, json: { id: string }): ContentSource => ({
  path: `data/${type}/${json.id}.json`,
  text: JSON.stringify(json),
});

const load = (attacks: readonly AttackDefInput[]) =>
  loadContent(contentTypes, [
    source('move', strikeMove),
    source('move', swipeMove),
    source('move', rollMove),
    ...attacks.map((a) => source('attack', a)),
  ]);

const messages = (input: unknown) =>
  (attackSchema.safeParse(input).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

// Per-entry test for every attack: the game's (credited for content coverage, as describeContent
// does) and the frozen test fixtures'. describeContent alone would leave an empty suite while the
// game ships no attack yet (the first arrive with the bestiary, e13.1).
describe('attack content', () => {
  const content = loadFixtureContent();
  const game = loadGameContent();
  const moves = compileMoves(content.all('move'));
  for (const attack of content.all('attack')) {
    it(`passes the schema and compiles against its move [attack:${attack.id}]`, ({ task }) => {
      if (game.has('attack', attack.id)) markExercised(task, 'attack', attack.id);
      expect(attackSchema.parse(JSON.parse(serializeContent(attack)))).toEqual(attack);
      expect(attack.notes.length).toBeGreaterThan(40);
      const runtime = compileAttack(attack, moves);
      expect(runtime.packets.length).toBe(1 + attack.extraPackets.length);
    });
  }
});

describe('attack schema', () => {
  it('fills every default for a minimal melee attack', () => {
    expect(attackSchema.parse(melee)).toMatchObject({
      schemaVersion: 1,
      extraPackets: [],
      cooldown: 0,
      weight: 1,
      preconditions: { health: { min: 0, max: 1 } },
    });
  });

  it('AC-3: range.min > range.max fails validation', () => {
    expect(messages({ ...melee, range: { min: 3, max: 2 } })).toEqual([
      'range.min: attack "guard-strike": range.min (3) exceeds range.max (2)',
    ]);
    expect(messages({ ...melee, range: { min: 2, max: 2 } })).toEqual([]);
  });

  it('rejects a reversed health band, a repeated stance and a misplaced projectile section', () => {
    expect(
      messages({
        ...melee,
        preconditions: { health: { min: 0.6, max: 0.5 }, targetStances: ['idle', 'idle'] },
        projectile: { speed: 1, maxRange: 1 },
      }),
    ).toEqual([
      'preconditions.health.min: attack "guard-strike": health.min exceeds health.max',
      'preconditions.targetStances: attack "guard-strike": lists a stance twice',
      'projectile: attack "guard-strike": only projectile attacks have a projectile section (kind is "melee")',
    ]);
    expect(messages({ ...bolt, projectile: undefined })).toEqual([
      'projectile: attack "bolt": a projectile attack needs a projectile section',
    ]);
    expect(messages({ ...melee, preconditions: { targetStances: ['blocking'] } })).toEqual([]);
  });

  it('rejects unknown kinds, stances and damage types', () => {
    expect(
      messages({
        ...melee,
        kind: 'bite',
        preconditions: { targetStances: ['asleep'] },
        extraPackets: [{ amounts: { acid: 3 } }],
      }).map((m) => m.split(':')[0]),
    ).toEqual(['kind', 'extraPackets.0.amounts', 'preconditions.targetStances.0']);
  });

  it('a creature attack referencing a missing move fails to load', () => {
    expect(() => loadContent(contentTypes, [source('attack', melee)])).toThrow(
      'attack:guard-strike references missing move:strike',
    );
  });
});

describe('compileAttack', () => {
  it('flattens the move, packets (move damage first), cooldown and preconditions', () => {
    const content = load([
      {
        ...melee,
        extraPackets: [{ amounts: { poison: 4 } }],
        cooldown: 1.5,
        weight: 3,
        preconditions: { targetStances: ['blocking'], health: { max: 0.5 } },
      },
    ]);
    const attack = compileAttack(
      content.get('attack', 'guard-strike'),
      compileMoves(content.all('move')),
    );
    expect(attack).toMatchObject({
      id: 'guard-strike',
      kind: 'melee',
      move: { id: 'strike', startup: 18, active: 4, recovery: 10, totalTicks: 32 },
      hitbox: { swing: 'thrust' },
      telegraph: 'guard-strike-windup',
      rangeMin: 0.5,
      rangeMax: 2,
      cooldownMs: 1500,
      weight: 3,
      targetStances: ['blocking'],
      healthMin: 0,
      healthMax: 0.5,
      projectile: null,
    });
    expect(attack.packets.map((p) => p.amounts)).toEqual([{ slash: 10 }, { poison: 4 }]);
    expect(Object.isFrozen(attack)).toBe(true);
  });

  it('a projectile launches from its move’s sphere', () => {
    const content = load([bolt]);
    const attack = compileAttack(content.get('attack', 'bolt'), compileMoves(content.all('move')));
    expect(attack.targetStances).toBeNull();
    expect(attack.projectile).toEqual({
      speed: 12,
      maxRange: 20,
      origin: { x: 0, y: 1.2, z: 0.8 },
      radius: 0.25,
    });
  });

  it('rejects a missing move, a non-attack move and a projectile without a sphere', () => {
    const content = load([
      { ...melee, move: 'roll' },
      { ...bolt, move: 'swipe' },
    ]);
    const moves = compileMoves(content.all('move'));
    const compile =
      (id: string, table = moves) =>
      () =>
        compileAttack(content.get('attack', id), table);
    expect(compile('guard-strike')).toThrow(
      new AttackCompileError(
        'attack "guard-strike": move "roll" must be an attack move with a hitbox and damage',
      ),
    );
    expect(compile('bolt')).toThrow(
      'attack "bolt": a projectile\'s move "swipe" needs a sphere hit volume, not a capsule',
    );
    expect(compile('bolt', new Map())).toThrow('attack "bolt": move "swipe" is not in the table');
  });

  it('compileAttacks builds the table in id order', () => {
    const content = load([melee, bolt]);
    const table = compileAttacks(
      [...content.all('attack')].reverse(),
      compileMoves(content.all('move')),
    );
    expect([...table.keys()]).toEqual(['bolt', 'guard-strike']);
    expect(compileAttacks(content.all('attack'), compileMoves(content.all('move'))).size).toBe(2);
  });
});
