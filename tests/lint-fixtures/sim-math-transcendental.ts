// lint-as: src/sim/fixture.ts
// expect: no-restricted-properties
export const wave = (t: number): number => Math.sin(t) + Math.cos(t) + Math.pow(t, 2);
