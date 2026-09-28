import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixtureDir = join(root, 'tests/lint-fixtures');

// The repo's real eslint.config.js, minus type-aware parsing: fixtures are linted at virtual
// src/<layer>/ paths that the TypeScript project service doesn't know about.
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [{ files: ['**/*.ts'], ...tseslint.configs.disableTypeChecked }],
});

interface Fixture {
  name: string;
  lintAs: string;
  expected: string[];
  code: string;
}

function header(code: string, key: string, name: string): string {
  const value = new RegExp(`^// ${key}: (.+)$`, 'm').exec(code)?.[1];
  if (!value) throw new Error(`${name}: missing "// ${key}:" header`);
  return value.trim();
}

const fixtures: Fixture[] = readdirSync(fixtureDir)
  .filter((f) => f.endsWith('.ts'))
  .sort()
  .map((name) => {
    const code = readFileSync(join(fixtureDir, name), 'utf8');
    const expect = header(code, 'expect', name);
    return {
      name,
      lintAs: header(code, 'lint-as', name),
      expected: expect === 'none' ? [] : expect.split(',').map((r) => r.trim()),
      code,
    };
  });

async function lint(fixture: Fixture): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintText(fixture.code, { filePath: join(root, fixture.lintAs) });
  if (!result) throw new Error(`${fixture.name}: no lint result`);
  return result.messages;
}

// ESLint reports unused disable directives and parse errors without a rule id.
const ruleName = (m: Linter.LintMessage): string =>
  m.fatal ? 'parse-error' : (m.ruleId ?? 'unused-disable-directive');

const byName = (name: string): Fixture => {
  const fixture = fixtures.find((f) => f.name === name);
  if (!fixture) throw new Error(`fixture ${name} not found`);
  return fixture;
};

describe('determinism and layer lint rules', () => {
  it('AC-5: every fixture fires exactly its expected rule ids', async () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      const fired = [...new Set((await lint(fixture)).map(ruleName))].sort();
      expect(fired, fixture.name).toEqual([...fixture.expected].sort());
    }
  });

  it.each([
    ['sim-math-random.ts', /seeded RNG/],
    ['sim-date-now.ts', /injected sim clock/],
    ['sim-performance-now.ts', /injected sim clock/],
  ])('AC-1: %s is an error naming the injected alternative', async (name, alternative) => {
    const messages = await lint(byName(name));
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(m.severity).toBe(2);
      expect(m.message).toMatch(alternative);
    }
  });

  it.each(['sim-imports-render-alias.ts', 'sim-imports-render-relative.ts', 'sim-dom-globals.ts'])(
    'AC-2: %s is an error',
    async (name) => {
      const messages = await lint(byName(name));
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.every((m) => m.severity === 2)).toBe(true);
    },
  );

  it('AC-3: src/game may use performance.now (rules are scoped to src/sim)', async () => {
    expect(await lint(byName('game-performance-now.ts'))).toEqual([]);
  });

  it.each(['sim-disable-comment.ts', 'sim-disable-comment-self.ts'])(
    'AC-4: %s reports the disable comment itself',
    async (name) => {
      const errors = (await lint(byName(name))).filter((m) => m.severity === 2);
      expect(errors.length).toBeGreaterThan(0);
      for (const m of errors) {
        expect(m.ruleId).toBe('@eslint-community/eslint-comments/no-restricted-disable');
        expect(m.line).toBe(3); // the comment line, not the Math.random call it tried to hide
      }
    },
  );
});

// Math functions that are not correctly rounded by IEEE-754 and so go through simMath in src/sim.
const SIM_MATH_BANNED = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'pow',
  'hypot',
  'cbrt',
];

describe('simMath is the only door to Math transcendentals in src/sim (mw-e00.27)', () => {
  it.each(['sim-math-transcendental.ts', 'sim-math-transcendental-destructured.ts'])(
    'AC-1: %s is an error naming simMath',
    async (name) => {
      const messages = await lint(byName(name));
      expect(messages.length).toBeGreaterThan(0);
      for (const m of messages) {
        expect(m.severity).toBe(2);
        expect(m.ruleId).toBe('no-restricted-properties');
        expect(m.message).toMatch(/simMath/);
      }
    },
  );

  it('AC-1: every banned function is reported in src/sim', async () => {
    const code = SIM_MATH_BANNED.map((fn, i) => `export const f${String(i)} = Math.${fn};`).join(
      '\n',
    );
    const [result] = await eslint.lintText(code, { filePath: join(root, 'src/sim/fixture.ts') });
    const reported = (result?.messages ?? []).map((m) => m.message);
    expect(reported).toHaveLength(SIM_MATH_BANNED.length);
    expect(SIM_MATH_BANNED).toEqual(
      expect.arrayContaining(['sin', 'cos', 'atan2', 'pow', 'hypot']),
    );
  });

  it('AC-2: src/sim/math.ts may call Math.sin, but Math.random stays banned there', async () => {
    expect(await lint(byName('sim-math-module-transcendental.ts'))).toEqual([]);
    const random = await lint(byName('sim-math-module-random.ts'));
    expect(random.map((m) => m.message).join()).toMatch(/seeded RNG/);
  });

  it('AC-3: src/game may call Math.sin (the rule is scoped to src/sim)', async () => {
    expect(await lint(byName('game-math-transcendental.ts'))).toEqual([]);
  });

  it('keeps correctly rounded Math functions (sqrt, abs, trunc, …) allowed in src/sim', async () => {
    expect(await lint(byName('sim-math-allowed.ts'))).toEqual([]);
  });
});
