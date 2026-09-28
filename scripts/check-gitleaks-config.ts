// Lints .gitleaks.toml: every allowlist entry must carry an explanatory comment (mw-e00.5), directly
// above it or at the end of its line. Run through scripts/check-gitleaks-config-cli.ts.
import { readFileSync } from 'node:fs';

const ALLOWLIST_TABLE = /^\[\[?\s*(?:rules\.)?allowlists?\s*\]\]?$/;
const ENTRY_KEY = /^(regexes|paths|stopwords|commits)\s*=\s*\[(.*)$/;
const STRING = /'''[\s\S]*?'''|"""[\s\S]*?"""|'[^'\n]*'|"(?:[^"\\\n]|\\.)*"/g;

const strings = (text: string): number => text.match(STRING)?.length ?? 0;
const hasTrailingComment = (text: string): boolean => text.replace(STRING, '').includes('#');

/** Problems as `line N: message`; empty means every allowlist entry is explained. */
export function lintGitleaksConfig(toml: string): string[] {
  const problems: string[] = [];
  let inAllowlist = false;
  let arrayKey: string | null = null;
  let explained = false; // the previous line was a comment

  toml.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    const n = index + 1;
    const commented = explained;
    explained = line.startsWith('#');
    if (explained) return;

    if (arrayKey !== null) {
      if (line.startsWith(']')) {
        arrayKey = null;
      } else if (strings(line) > 0 && !commented && !hasTrailingComment(line)) {
        problems.push(`line ${String(n)}: ${arrayKey} entry has no explanatory comment.`);
      }
      return;
    }
    if (line.startsWith('[')) {
      inAllowlist = ALLOWLIST_TABLE.test(line);
      return;
    }
    const entry = inAllowlist ? ENTRY_KEY.exec(line) : null;
    if (!entry) return;
    const key = String(entry[1]);
    const rest = String(entry[2]);
    if (!rest.replace(STRING, '').includes(']')) {
      arrayKey = key; // multi-line array: entries follow, one per line
      if (strings(rest) > 0)
        problems.push(`line ${String(n)}: put ${key} entries on their own lines.`);
    } else if (strings(rest) > 1) {
      problems.push(`line ${String(n)}: put one ${key} entry per line so each can be explained.`);
    } else if (strings(rest) === 1 && !commented && !hasTrailingComment(rest)) {
      problems.push(`line ${String(n)}: ${key} entry has no explanatory comment.`);
    }
  });
  return problems;
}

/** Returns the exit code: 0 clean, 1 unexplained entries, 2 unreadable config. */
export function main(argv: readonly string[]): number {
  const path = argv[0] ?? '.gitleaks.toml';
  let toml: string;
  try {
    toml = readFileSync(path, 'utf8');
  } catch {
    console.log(`::error title=gitleaks config::Cannot read ${path}.`);
    return 2;
  }
  const problems = lintGitleaksConfig(toml);
  for (const p of problems) console.log(`::error file=${path},title=gitleaks config::${p}`);
  if (problems.length === 0) console.log(`${path}: every allowlist entry is explained.`);
  return problems.length > 0 ? 1 : 0;
}
