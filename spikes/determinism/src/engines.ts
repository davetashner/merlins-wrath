// Which physics builds the determinism check covers.
export const ENGINES = ['rapier-deterministic', 'rapier-standard', 'havok'] as const;
export type EngineName = (typeof ENGINES)[number];
export const HAVOK_VERSION = '@babylonjs/havok 1.3.14';
