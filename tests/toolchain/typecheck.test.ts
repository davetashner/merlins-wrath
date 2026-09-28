import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

// Type-check one file with the repo's own tsconfig.json compiler options.
function diagnosticCodes(file: string): number[] {
  const configPath = ts.findConfigFile(root, (f) => ts.sys.fileExists(f), 'tsconfig.json');
  if (!configPath) throw new Error('tsconfig.json not found');
  const { config } = ts.readConfigFile(configPath, (f) => ts.sys.readFile(f)) as {
    config: unknown;
  };
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const program = ts.createProgram([file], options);
  return ts.getPreEmitDiagnostics(program).map((d) => d.code);
}

// Each case builds a TypeScript program: a few seconds on a small CI runner.
describe('tsconfig strictness', { timeout: 30_000 }, () => {
  it('AC-3: an implicit any fails the typecheck', () => {
    // TS7006: Parameter implicitly has an 'any' type.
    expect(diagnosticCodes(fixture('implicit-any.ts'))).toContain(7006);
  });

  it('AC-3: an unchecked index access fails the typecheck', () => {
    // TS2532: Object is possibly 'undefined'.
    expect(diagnosticCodes(fixture('unchecked-index.ts'))).toContain(2532);
  });

  it('AC-3: a correctly guarded file passes (control)', () => {
    expect(diagnosticCodes(fixture('clean.ts'))).toEqual([]);
  });
});
