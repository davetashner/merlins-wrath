// mw-e11.5 AC-6: the no-omniscience boundary. Agents (src/sim/ai: the behaviour runtime, its inputs
// and primitives) learn about the world only through percepts. The type system stops code holding a
// percept from turning it into a world lookup, and this architecture test stops agent code importing
// the modules that expose a target's true state: the player, character bodies, the visibility model,
// raw line-of-sight queries and the perception system's internals.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

/** Directories holding agent code (awareness, mw-e11.6, is src/sim/ai/awareness.ts; memory joins). */
const AGENT_DIRS = ['src/sim/ai'];

/** Imports agent code may not make (relative or through the @sim alias). */
const FORBIDDEN = [
  /(?:^|\/)player(?:\/|$)/,
  /(?:^|\/)character(?:\/|$)/,
  /(?:^|\/)stealth(?:\/|$)/,
  /(?:^|\/)sight(?:\/|$)/,
  /(?:^|\/)perception\/(?:system|sight|hearing|channels|touch)(?:\.ts)?$/,
  /^@sim\/index$/,
];

function diagnosticCodes(file: string): number[] {
  const configPath = ts.findConfigFile(root, (f) => ts.sys.fileExists(f), 'tsconfig.json');
  if (!configPath) throw new Error('tsconfig.json not found');
  const { config } = ts.readConfigFile(configPath, (f) => ts.sys.readFile(f)) as {
    config: unknown;
  };
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
  return ts.getPreEmitDiagnostics(ts.createProgram([file], options)).map((d) => d.code);
}

/** Every module specifier imported or re-exported by `source`. */
function importsOf(source: string): string[] {
  const file = ts.createSourceFile('agent.ts', source, ts.ScriptTarget.Latest);
  return file.statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

function agentFiles(): string[] {
  return AGENT_DIRS.flatMap((dir) =>
    readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => join(dir, name)),
  );
}

const violations = (files: readonly string[], read: (file: string) => string) =>
  files.flatMap((file) =>
    importsOf(read(file))
      .filter((spec) => FORBIDDEN.some((pattern) => pattern.test(spec)))
      .map((spec) => `${file} imports ${spec}`),
  );

describe('perception boundary (mw-e11.5)', { timeout: 30_000 }, () => {
  it('AC-6: reading the world through a percept’s source does not compile', () => {
    // TS2345: Argument of type 'PerceptSource' is not assignable to parameter of type 'number'.
    expect(diagnosticCodes(fixture('percept-source-as-entity.ts'))).toContain(2345);
    expect(diagnosticCodes(fixture('percept-clean.ts'))).toEqual([]);
  });

  it('AC-6: no agent module imports the player, character bodies or raw senses', () => {
    const files = agentFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(violations(files, (file) => readFileSync(join(root, file), 'utf8'))).toEqual([]);
  });

  it('AC-6: the check catches such an import (control)', () => {
    const sources: Record<string, string> = {
      'peek.ts': "import { CharacterController } from '../character/system';",
      'cheat.ts': "export { installPlayer } from '../player/player';",
      'ok.ts': "import type { Percept } from '../perception/percept';",
    };
    expect(violations(Object.keys(sources), (file) => sources[file] ?? '')).toEqual([
      'peek.ts imports ../character/system',
      'cheat.ts imports ../player/player',
    ]);
  });
});
