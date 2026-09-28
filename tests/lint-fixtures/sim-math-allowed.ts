// lint-as: src/sim/fixture.ts
// expect: none
export const len = (x: number, y: number): number =>
  Math.sqrt(x * x + y * y) + Math.abs(Math.trunc(x)) + Math.imul(1, Math.sign(y)) + Math.round(x);
