// lint-as: src/sim/fixture.ts
// expect: none
export const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.floor(n)));
