// lint-as: src/sim/fixture.ts
// expect: no-restricted-properties
const { random } = Math;
export const roll = (): number => random();
