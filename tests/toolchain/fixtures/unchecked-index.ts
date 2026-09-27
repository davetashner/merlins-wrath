// Deliberately broken: indexing may return undefined under noUncheckedIndexedAccess.
export function first(xs: number[]): number {
  return xs[0] + 1;
}
