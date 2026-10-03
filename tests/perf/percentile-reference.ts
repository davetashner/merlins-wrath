// Reference implementation of nearest-rank percentiles (mw-e32.1 AC-3), deliberately written the
// slow, obvious way so it can be checked by eye against the textbook definition:
//
//   The P-th percentile (0 < P ≤ 100) of a list of N ordered values is the smallest value in the
//   list such that no more than P percent of the data is strictly less than it and at least P
//   percent of the data is less than or equal to it — i.e. the value at ordinal rank ⌈P/100 × N⌉.
//
// The production code (src/tools/perf/percentiles.ts) is optimised differently and must agree with
// this on every input. Do not "improve" this file: change it only if the definition changes.

export function referencePercentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const ordered = values.slice();
  // Insertion sort: quadratic, but impossible to get wrong for finite numbers.
  for (let i = 1; i < ordered.length; i++) {
    const value = ordered[i] ?? 0;
    let j = i - 1;
    while (j >= 0 && (ordered[j] ?? 0) > value) {
      ordered[j + 1] = ordered[j] ?? 0;
      j--;
    }
    ordered[j + 1] = value;
  }
  // Walk the ordered list until at least P percent of the data is at or below the candidate.
  for (let index = 0; index < ordered.length; index++) {
    const atOrBelow = index + 1;
    if (atOrBelow * 100 >= p * ordered.length) return ordered[index] ?? 0;
  }
  return ordered.at(-1) ?? 0; // only for p > 100
}
