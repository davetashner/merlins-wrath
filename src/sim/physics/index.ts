// Physics in the sim (ADR-0001): the sim-owned port the World steps and snapshots (mw-e03.35), its
// Rapier implementation (the Rapier module itself is injected by the game), and the static-geometry
// sink the scene loader writes to (mw-e00.21).
export { decodeBase64, encodeBase64 } from './base64';
export { PhysicsStateError, type PhysicsPort, type PhysicsState } from './port';
export {
  DEFAULT_GRAVITY,
  RapierPhysics,
  type RapierModule,
  type RapierPhysicsOptions,
} from './rapier';
export * from './static-colliders';
