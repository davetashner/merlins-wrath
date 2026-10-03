// Volume settings to mix buses (mw-0j5): the audio settings' master, music and effects sliders set
// the matching bus gains. The music slider also covers the ambience bed (its help text: "the score and
// the ambient music beds"). Gains are applied once the audio context is running and again on every
// change after that, so adjusting a slider before the first gesture never creates the context early.
import type { BusId } from '@audio/index';

/** The settings the volume mapping reads. */
export type VolumeKey = 'audio.master' | 'audio.music' | 'audio.sfx';

/** Which buses each volume setting drives. */
export const VOLUME_BUSES: Readonly<Record<VolumeKey, readonly BusId[]>> = {
  'audio.master': ['master'],
  'audio.music': ['music', 'ambience'],
  'audio.sfx': ['sfx'],
};

/** Seconds a slider change ramps over, to avoid zipper noise. */
export const VOLUME_RAMP_S = 0.05;

export interface VolumeEngine {
  readonly context: { readonly state: string } | undefined;
  setBusGain(bus: BusId, gain: number, rampSeconds?: number): void;
}

export interface VolumeSettings {
  get(key: VolumeKey): number;
  on(key: VolumeKey, listener: (value: number) => void): () => void;
}

export interface VolumeBinding {
  /** Call once per frame: applies every volume the first time the context is running. */
  update(): void;
  dispose(): void;
}

/** Drives the master, music, ambience and effects buses from the volume settings. */
export function bindVolumes(engine: VolumeEngine, settings: VolumeSettings): VolumeBinding {
  let applied = false;
  const running = (): boolean => engine.context?.state === 'running';
  const apply = (key: VolumeKey, value: number, ramp: number): void => {
    for (const bus of VOLUME_BUSES[key]) engine.setBusGain(bus, value, ramp);
  };
  const keys = Object.keys(VOLUME_BUSES) as VolumeKey[];
  const offs = keys.map((key) =>
    settings.on(key, (value) => {
      if (applied && running()) apply(key, value, VOLUME_RAMP_S);
    }),
  );
  return {
    update() {
      if (applied || !running()) return;
      applied = true;
      for (const key of keys) apply(key, settings.get(key), 0);
    },
    dispose() {
      for (const off of offs) off();
    },
  };
}
