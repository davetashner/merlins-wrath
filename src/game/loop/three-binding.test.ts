import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_ROTATION, type Transform } from './render-sync';
import { object3DBinding } from './three-binding';

describe('object3DBinding', () => {
  it('applies position and rotation to the Object3D', () => {
    const object = new Object3D();
    const binding = object3DBinding(object, () => undefined);
    const transform: Transform = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    };
    binding.apply(object, transform);
    expect(object.position.toArray()).toEqual([1, 2, 3]);
    expect(object.quaternion.toArray()).toEqual([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    expect(binding.object).toBe(object);
  });

  it('passes the reader through', () => {
    const read = vi.fn(() => ({ position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_ROTATION }));
    const binding = object3DBinding(new Object3D(), read);
    const view = { tick: 0, isAlive: () => true, get: () => undefined };
    expect(binding.read(view, 1)).toEqual(read.mock.results[0]?.value);
    expect(read).toHaveBeenCalledWith(view, 1);
  });

  it('AC-5: dispose removes the object from the scene and frees geometry and every material', () => {
    const scene = new Scene();
    const group = new Group();
    const geometry = new BoxGeometry();
    const single = new MeshBasicMaterial();
    const multi = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    group.add(new Mesh(geometry, single), new Mesh(new BoxGeometry(), multi));
    scene.add(group);
    const disposed = vi.fn();
    geometry.addEventListener('dispose', disposed);
    for (const material of [single, ...multi]) material.addEventListener('dispose', disposed);

    object3DBinding(group, () => undefined).dispose(group);
    expect(group.parent).toBeNull();
    expect(scene.children).not.toContain(group);
    expect(disposed).toHaveBeenCalledTimes(4);
  });
});
