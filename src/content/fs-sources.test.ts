import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readContentSources } from './fs-sources.ts';

describe('readContentSources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-'));
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads <root>/<type>/*.json sorted by path, skipping other files and depths', () => {
    mkdirSync(join(dir, 'b/nested'), { recursive: true });
    mkdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'b/two.json'), '2');
    writeFileSync(join(dir, 'a/one.json'), '1');
    writeFileSync(join(dir, 'a/notes.txt'), 'x');
    writeFileSync(join(dir, 'b/nested/deep.json'), '3');
    writeFileSync(join(dir, 'b.schema.json'), '{}');
    expect(readContentSources(dir, 'content')).toEqual([
      { path: 'content/a/one.json', text: '1' },
      { path: 'content/b/two.json', text: '2' },
    ]);
    expect(readContentSources(dir)[0]?.path).toBe(`${dir}/a/one.json`);
  });
});
