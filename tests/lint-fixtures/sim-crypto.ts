// lint-as: src/sim/fixture.ts
// expect: no-restricted-globals
export const bytes = (): Uint8Array => crypto.getRandomValues(new Uint8Array(4));
