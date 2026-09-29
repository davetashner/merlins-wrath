import { describe, expect, it } from 'vitest';
import { describeContent } from '../testing.ts';
import { animClipSchema, type AnimClipDefInput } from './anim-clip.ts';

const clip = (over: Partial<AnimClipDefInput> = {}): AnimClipDefInput => ({
  id: 'anim-test',
  notes: 'Test clip.',
  rig: 'rig',
  duration: 1,
  tracks: { arm: [{ t: 0, rot: [0, 0, 0] }] },
  ...over,
});

const problems = (value: unknown) =>
  (animClipSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describeContent('anim-clip', 'keys only its rig’s bones, inside its duration', (entry, content) => {
  const rig = content.resolve(entry.rig);
  const bones = new Set(rig.skeleton.map((b) => b.bone));
  for (const [bone, keys] of Object.entries(entry.tracks)) {
    expect(bones.has(bone)).toBe(true);
    for (const key of keys) expect(key.t).toBeLessThanOrEqual(entry.duration);
  }
  for (const marker of entry.markers) expect(marker.t).toBeLessThanOrEqual(entry.duration);
});

describe('animation clip schema', () => {
  it('fills defaults', () => {
    const parsed = animClipSchema.parse(clip());
    expect(parsed).toMatchObject({ loop: false, additive: false, markers: [] });
    expect(parsed.rig.toString()).toBe('anim-graph:rig');
    expect(parsed.root).toBeUndefined();
  });

  it('needs an animation id', () => {
    expect(problems(clip({ id: 'test' }))).toEqual([
      'id: must be an animation id, e.g. "anim-knight-sword-light-1"',
    ]);
  });

  it('rejects keys and markers out of order or past the clip', () => {
    expect(
      problems(
        clip({
          tracks: {
            arm: [
              { t: 0.5, rot: [0, 0, 0] },
              { t: 0.5, rot: [1, 0, 0] },
              { t: 2, rot: [0, 0, 0] },
            ],
          },
          root: [
            { t: 0.2, pos: [0, 0, 0] },
            { t: 0.1, pos: [0, 0, 1] },
          ],
          markers: [{ kind: 'hit', t: 1.5 }],
        }),
      ),
    ).toEqual([
      'tracks.arm.1.t: key times must be strictly ascending',
      "tracks.arm.2.t: key time 2 s is past the clip's duration (1 s)",
      'root.1.t: key times must be strictly ascending',
      "markers.0.t: marker at 1.5 s is past the clip's duration (1 s)",
    ]);
  });
});
