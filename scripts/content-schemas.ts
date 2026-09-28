// Writes (or with --check, verifies) the JSON Schema next to each content type folder (mw-e00.18):
// src/content/data/<type>.schema.json, generated from the type's zod schema so editors can
// autocomplete content files. Run through scripts/content-schemas-cli.ts (`pnpm content:schemas`).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentJsonSchema } from '../src/content/json-schema.ts';
import { contentTypes } from '../src/content/registry.ts';

/** Repo-relative path of each type's generated schema → its expected contents. */
export function expectedSchemas(): Map<string, string> {
  return new Map(
    Object.entries(contentTypes).map(([type, schema]) => [
      `src/content/data/${type}.schema.json`,
      `${JSON.stringify(contentJsonSchema(schema), null, 2)}\n`,
    ]),
  );
}

const read = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

/** Writes every schema, or with `--check` returns 1 listing the stale ones. Returns the exit code. */
export function main(argv: readonly string[], root: string = process.cwd()): number {
  const check = argv.includes('--check');
  let stale = 0;
  for (const [path, text] of expectedSchemas()) {
    if (read(resolve(root, path)) === text) continue;
    if (check) {
      console.log(`::error title=Content schemas::${path} is stale; run pnpm content:schemas.`);
      stale++;
    } else {
      writeFileSync(resolve(root, path), text);
      console.log(`wrote ${path}`);
    }
  }
  return stale > 0 ? 1 : 0;
}
