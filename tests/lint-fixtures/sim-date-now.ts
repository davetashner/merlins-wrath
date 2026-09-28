// lint-as: src/sim/fixture.ts
// expect: no-restricted-globals
export const now = (): number => Date.now();
