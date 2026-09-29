// Line of sight (mw-e09.1): multi-point visibility with partial cover and see-through occluders, over
// an engine-free SightWorld (in-memory fake here, Rapier in src/sim/physics).
export { FakeSightWorld } from './fake-sight-world';
export {
  DEFAULT_SIGHT_SAMPLES,
  LineOfSight,
  type LineOfSightOptions,
  type OcclusionVolume,
  type SightOptions,
  type SightQuery,
  type SightTarget,
} from './line-of-sight';
export {
  OPAQUE,
  parseOcclusion,
  partial,
  TRANSPARENT,
  transmittance,
  type OpaqueOcclusion,
  type Occlusion,
  type PartialOcclusion,
  type TransparentOcclusion,
} from './occlusion';
export { segmentCrossesBox, segmentCrossesSphere, segmentEntersBox } from './segment';
export type { SightVisitor, SightWorld } from './sight-world';
