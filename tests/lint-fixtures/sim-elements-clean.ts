// lint-as: src/sim/elements/fixture.ts
// expect: none
// Element rules may compare enums and numbers, and look materials up in data tables.
declare const state: string;
declare const burnt: ReadonlyMap<string, string | null>;
declare const material: string;
export const quiet = state !== 'awake';
export const isText = typeof material === 'string';
export const becomes = burnt.get(material) ?? null;
export const destroyed = becomes === null;
