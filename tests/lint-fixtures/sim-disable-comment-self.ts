// lint-as: src/sim/fixture.ts
// expect: @eslint-community/eslint-comments/no-restricted-disable, unused-disable-directive
// eslint-disable-next-line no-restricted-properties, @eslint-community/eslint-comments/no-restricted-disable
export const roll = (): number => Math.random();
