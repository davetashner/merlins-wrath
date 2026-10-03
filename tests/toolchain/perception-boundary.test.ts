// mw-e11.5 AC-6: the no-omniscience boundary. Agents (src/sim/ai: the behaviour runtime, its inputs
// and primitives) learn about the world only through percepts. The type system stops code holding a
// percept from turning it into a world lookup, and this architecture test stops agent code importing
// the modules that expose a target's true state: the player, character bodies, the visibility model,
// raw line-of-sight queries and the perception system's internals.
//
// mw-e11.8 extends it to positions: agent code reads only its own agent's placement (a target is
// aimed at through target memory's prediction, never through the target entity), and the memory
// module imports nothing that could reach the world at all.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

/** Directories holding agent code (awareness, mw-e11.6, and memory, mw-e11.8, live in src/sim/ai). */
const AGENT_DIRS = ['src/sim/ai'];

/** Imports agent code may not make (relative or through the @sim alias). */
const FORBIDDEN = [
  /(?:^|\/)player(?:\/|$)/,
  /(?:^|\/)character(?:\/|$)/,
  /(?:^|\/)stealth(?:\/|$)/,
  /(?:^|\/)sight(?:\/|$)/,
  /(?:^|\/)physics(?:\/|$)/,
  /(?:^|\/)targeting(?:\/|$)/,
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

/** The memory module (mw-e11.8) and the only imports it may make, all type-only. */
const MEMORY = 'src/sim/ai/memory.ts';
const MEMORY_IMPORTS = ['../perception/percept', '../stimulus/shapes'];

/** `source`'s imports that are not type-only or not in MEMORY_IMPORTS. */
function memoryViolations(source: string): string[] {
  const file = ts.createSourceFile('memory.ts', source, ts.ScriptTarget.Latest);
  return file.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return [];
    const spec = statement.moduleSpecifier;
    if (spec === undefined || !ts.isStringLiteral(spec)) return [];
    const typeOnly = ts.isImportDeclaration(statement)
      ? statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
      : statement.isTypeOnly;
    return typeOnly && MEMORY_IMPORTS.includes(spec.text) ? [] : [spec.text];
  });
}

/** Expressions that name the agent itself: `entity`, `agent`, `v.entity`, `view.entity`. */
function isSelf(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === 'entity' || node.text === 'agent';
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'entity' &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === 'v' || node.expression.text === 'view')
  );
}

/**
 * Every use of PlacementComponent in `source` outside an import that is not a call argument right
 * after the agent itself (`getIf(world, entity, PlacementComponent)`, `world.set(entity, …)`).
 */
function placementViolations(name: string, source: string): string[] {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === 'PlacementComponent') {
      const call = node.parent;
      const args = ts.isCallExpression(call) ? call.arguments : undefined;
      const index = args?.indexOf(node) ?? -1;
      const before = args?.[index - 1];
      if (before === undefined || !isSelf(before)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${name}:${String(line + 1)} ${call.getText()}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

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

describe('no true target positions in agent code (mw-e11.8)', { timeout: 30_000 }, () => {
  it('the memory module imports only percept and shape types: no world, transforms or bodies', () => {
    expect(memoryViolations(readFileSync(join(root, MEMORY), 'utf8'))).toEqual([]);
    expect(agentFiles()).toContain(MEMORY);
  });

  it('agent code reads and writes only its own agent’s placement', () => {
    const files = agentFiles();
    const read = (file: string) => readFileSync(join(root, file), 'utf8');
    expect(files.flatMap((file) => placementViolations(file, read(file)))).toEqual([]);
    // Not vacuous: agents do read their own placement.
    expect(
      files.filter((file) => read(file).includes('PlacementComponent)')).length,
    ).toBeGreaterThan(2);
  });

  it('the checks catch a peek at a target’s placement or a world import in memory (control)', () => {
    const cheat = [
      "import { PlacementComponent } from '../stimulus/placement';",
      'const mine = getIf(world, entity, PlacementComponent);',
      'const theirs = getIf(v.world, v.brain.blackboard.target, PlacementComponent);',
      'const all = world.query(PlacementComponent);',
      'world.get(view.entity, PlacementComponent);',
    ].join('\n');
    expect(placementViolations('cheat.ts', cheat)).toEqual([
      'cheat.ts:3 getIf(v.world, v.brain.blackboard.target, PlacementComponent)',
      'cheat.ts:4 world.query(PlacementComponent)',
    ]);
    expect(
      memoryViolations(
        [
          "import type { Percept } from '../perception/percept';",
          "import { World } from '../core/world';",
          "import type { Placement } from '../stimulus/placement';",
          "import { ZERO } from '../stimulus/shapes';",
        ].join('\n'),
      ),
    ).toEqual(['../core/world', '../stimulus/placement', '../stimulus/shapes']);
  });
});
