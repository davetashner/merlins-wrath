// The committed 600-step physics input script (AC-2) and the types every runner shares.
import type { BodySpawn } from '../../shared/scene-config.ts';

export interface ScriptImpulse {
  step: number;
  body: number;
  impulse: [number, number, number];
  torque: [number, number, number];
}

export interface InputScript {
  version: 1;
  description: string;
  steps: number;
  dt: number;
  gravity: [number, number, number];
  /** Snapshot is taken before applying this step's inputs. */
  snapshotAt: number;
  /** Hash checkpoints are recorded after every `checkpointEvery` steps. */
  checkpointEvery: number;
  statics: { half: [number, number, number]; at: [number, number, number] }[];
  bodies: BodySpawn[];
  impulses: ScriptImpulse[];
}

export interface RunResult {
  engine: string;
  engineVersion: string;
  steps: number;
  finalHash: string;
  checkpoints: string[];
  /** Hash of the snapshot bytes themselves (Rapier only). */
  snapshotBytesHash: string | null;
  snapshotBytes: number | null;
  /** Final hash after restoring the step-`snapshotAt` snapshot and replaying the rest of the script. */
  restoredFinalHash: string | null;
  restoredCheckpoints: string[] | null;
  restoreMatches: boolean | null;
  restoreMethod: string;
  ms: number;
}

/** FNV-1a over the raw bytes, two independent 32-bit lanes → 64-bit hex. */
export function hashBytes(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    const x = bytes[i]!;
    a = Math.imul(a ^ x, 0x01000193);
    b = Math.imul(b ^ x, 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** Hash every body's position, rotation, linear and angular velocity as exact float64 bit patterns. */
export function hashState(values: Float64Array): string {
  return hashBytes(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

export const FLOATS_PER_BODY = 13;

declare global {
  interface Window {
    __determinism: { done: boolean; results: RunResult[]; errors: string[]; userAgent: string };
  }
}
