// lint-as: src/sim/fixture.ts
// expect: no-restricted-globals
export const stamp = (): string => new Date().toISOString();
