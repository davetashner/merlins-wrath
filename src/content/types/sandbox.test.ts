import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  COMBAT_SANDBOX_ID,
  compileSandbox,
  SANDBOX_HIT_REGIONS,
  sandboxSchema,
  type SandboxDefInput,
} from './sandbox.ts';

const valid = {
  id: 'test-sandbox',
  notes: 'A sandbox for tests.',
  scene: 'arena',
  dummy: {
    health: 500,
    poise: 40,
    infiniteHealth: true,
    resetAfterTicks: 180,
    resistances: { slash: 0.5 },
    regions: ['torso', 'head'],
    regionMultipliers: { weakpoint: 2, head: 1.5, torso: 1, limb: 0.75 },
    radius: 0.35,
    reactions: { knockbackImpulse: 300, knockdownImpulse: 900, launchSpeed: 2, mass: 80 },
  },
  attacker: { move: 'swing', periodTicks: 120, parryable: true, unblockable: false },
  player: { health: 100, poise: 30 },
} satisfies SandboxDefInput;

const problems = (value: unknown) =>
  (sandboxSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('sandbox schema (mw-e04.9)', () => {
  it('accepts a sandbox and compiles it to frozen runtime data', () => {
    const runtime = compileSandbox(sandboxSchema.parse(valid));
    expect(runtime).toEqual({
      id: 'test-sandbox',
      scene: 'arena',
      dummy: valid.dummy,
      attacker: valid.attacker,
      player: valid.player,
    });
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.dummy.regions)).toBe(true);
    expect(Object.isFrozen(runtime.dummy.reactions)).toBe(true);
    expect(Object.isFrozen(runtime.attacker)).toBe(true);
    expect(SANDBOX_HIT_REGIONS).toEqual(['weakpoint', 'head', 'torso', 'limb']);
  });

  it('defaults resistances and the reaction thresholds', () => {
    const dummy: Record<string, unknown> = { ...valid.dummy };
    delete dummy['resistances'];
    const parsed = sandboxSchema.parse({
      ...valid,
      dummy: { ...dummy, reactions: { mass: 60 } },
    });
    expect(parsed.dummy.resistances).toEqual({});
    expect(parsed.dummy.reactions).toEqual({
      knockbackImpulse: 300,
      knockdownImpulse: 900,
      launchSpeed: 2,
      mass: 60,
    });
  });

  it('rejects bad regions, thresholds, multipliers and periods', () => {
    const dummy = (patch: object) => problems({ ...valid, dummy: { ...valid.dummy, ...patch } });
    expect(dummy({ regions: [] })).toHaveLength(1);
    expect(dummy({ regions: ['torso', 'torso'] })).toEqual([
      'dummy.regions: regions must not repeat',
    ]);
    expect(dummy({ regions: ['tail'] })).toHaveLength(1);
    expect(
      dummy({ reactions: { knockbackImpulse: 900, knockdownImpulse: 300, mass: 80 } }),
    ).toEqual(['dummy.reactions: knockdownImpulse must be ≥ knockbackImpulse']);
    expect(dummy({ resistances: { slash: 4 } })).toHaveLength(1);
    expect(dummy({ health: 0 })).toHaveLength(1);
    expect(dummy({ resetAfterTicks: 1.5 })).toHaveLength(1);
    expect(problems({ ...valid, attacker: { ...valid.attacker, periodTicks: 0 } })).toHaveLength(1);
    expect(problems({ ...valid, player: { health: 100 } })).toHaveLength(1);
    expect(problems({ ...valid, extra: true })).toHaveLength(1);
  });
});

describeContent('sandbox', 'is valid, round-trips and compiles', (sandbox) => {
  expect(sandboxSchema.parse(JSON.parse(serializeContent(sandbox)))).toEqual(sandbox);
  expect(compileSandbox(sandbox).id).toBe(sandbox.id);
});

describeContent(
  'sandbox',
  'the combat sandbox swings every 2.0 s at an infinite dummy',
  (sandbox) => {
    if (sandbox.id !== COMBAT_SANDBOX_ID) return;
    const runtime = compileSandbox(sandbox);
    expect(runtime.scene).toBe('combat-sandbox');
    expect(runtime.attacker).toMatchObject({ move: 'training-dummy-swing', periodTicks: 120 });
    expect(runtime.dummy).toMatchObject({ infiniteHealth: true, resetAfterTicks: 180 });
  },
);
