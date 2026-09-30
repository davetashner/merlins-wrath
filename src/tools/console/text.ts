// Text helpers for the debug console (mw-e33.1): splitting a typed line into tokens, and finding the
// closest known names to a typo.

/** Splits a command line on whitespace; "double quotes" keep spaces inside one token. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  for (const match of line.matchAll(/"([^"]*)"?|\S+/g)) tokens.push(match[1] ?? match[0]);
  return tokens;
}

/** Levenshtein edit distance between `a` and `b` (one row of the table at a time). */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let distance = b.length;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = i - 1;
    let left = i;
    const row = [left];
    previous.slice(1).forEach((up, j) => {
      const cost = a[i - 1] === b[j] ? 0 : 1;
      left = Math.min(up + 1, left + 1, diagonal + cost);
      diagonal = up;
      row.push(left);
    });
    previous = row;
    distance = left;
  }
  return distance;
}

/** The `count` candidates closest to `word` by edit distance (ties alphabetical). */
export function closest(word: string, candidates: readonly string[], count = 3): string[] {
  return candidates
    .map((candidate) => ({ candidate, distance: editDistance(word, candidate) }))
    .sort((a, b) => a.distance - b.distance || (a.candidate < b.candidate ? -1 : 1))
    .slice(0, count)
    .map(({ candidate }) => candidate);
}

/** The longest prefix every string shares ('' for none). */
export function commonPrefix(strings: readonly string[]): string {
  const [first = '', ...rest] = strings;
  let end = first.length;
  for (const s of rest) {
    let i = 0;
    while (i < end && s[i] === first[i]) i++;
    end = i;
  }
  return first.slice(0, end);
}
