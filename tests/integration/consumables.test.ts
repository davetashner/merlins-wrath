// mw-e17.6 AC-5: a thrown oil flask in the testbed, as the game wires it (createGameWorld: Rapier
// physics, the player with an inventory and quick slots, the scene's props), plus the e03 element
// field and fire rules over content's materials (the game runs them from mw-b1a; until then this test
// adds them, as tests/integration/fire-crates.test.ts does). The player throws an oil flask from a
// quick slot at the loose wooden crate, then holds a torch to it: the flask burns because its data
// makes it a flammable liquid, and the crate it lies against catches through heat in the element
// field. Nothing here, nor in the sim, knows what an oil flask is.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { burntMaterials, loadGameContent, materialPresets } from '@content/index';
import { markExercised } from '@content/testing';
import {
  applyStimulus,
  elementFieldOf,
  elementFieldSystem,
  elementRulesSystem,
  ElementRuleSet,
  fireRules,
  installElementField,
  itemSpawnRequested,
  placementOf,
  PlayerLook,
  readProperty,
  SceneSpawnComponent,
  teleportCommand,
  useQuickSlotCommand,
  WorldItemComponent,
  World,
  type EntityId,
  type ItemSpawnRequest,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it } from 'vitest';

const content = loadGameContent();

/** The testbed with fire, the player 2 m south of the loose crate (at (−1, 0, −2)) facing it. */
function facingTheCrate() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60 });
  const { world, player, consumables } = game;
  const sim = world as unknown as World<never>;
  installElementField(sim);
  world
    .addSystem(
      elementRulesSystem(
        new ElementRuleSet(
          fireRules({
            presets: materialPresets(content.all('material')),
            burnt: burntMaterials(content.all('material')),
          }),
        ),
      ),
    )
    .addSystem(elementFieldSystem());
  const crate = world
    .query(SceneSpawnComponent)
    .ids()
    .find((id) => world.get(id, SceneSpawnComponent)?.id === 'loose-crate');
  if (crate === undefined) throw new Error('no loose crate in the testbed');
  world.step([teleportCommand(player, { x: -1, y: 0, z: 0 })]);
  world.set(player, PlayerLook, { yaw: 0, pitch: -0.8 }); // facing −z, aiming at the crate's face
  for (let i = 0; i < 10; i++) world.step([]);
  return { world, sim, player, consumables, crate };
}

describe('consumables in the testbed (mw-e17.6)', () => {
  it(
    'AC-5: the player throws an oil flask, then ignites it, and the area burns via e03 propagation',
    { timeout: 30_000 },
    ({ task }) => {
      markExercised(task, 'item', 'oil-flask');
      markExercised(task, 'material', 'oil');
      const t = facingTheCrate();
      expect(readProperty(t.sim, t.crate, 'flammable')).toBe(true);
      expect(readProperty(t.sim, t.crate, 'burning')).toBe(false);

      // Throw: two flasks go on quick slot 1, and the slot is used twice (once the use lock is over).
      const added = t.consumables.items.inventory.add(t.sim, t.player, 'oil-flask', 2);
      if (!added.ok) throw new Error(added.reason);
      expect(t.consumables.assign(t.sim, t.player, 0, added.instanceIds[0] ?? -1)).toBe(true);
      const requests: ItemSpawnRequest[] = [];
      t.world.events.on(itemSpawnRequested, (e) => requests.push(e));
      for (let throws = 0; throws < 2; throws++) {
        t.world.step([useQuickSlotCommand(t.player, 0)]);
        for (let i = 0; i < 120; i++) t.world.step([]); // it flies, hits the crate and settles
      }
      expect(requests.map((r) => r.worldProperties)).toEqual([
        { material: 'oil', flammable: true, liquid: true },
        { material: 'oil', flammable: true, liquid: true },
      ]);
      expect(t.consumables.slotView(t.sim, t.player, 0)).toMatchObject({ depleted: true });
      const flasks = t.world
        .query(WorldItemComponent)
        .ids()
        .filter((id) => t.world.get(id, WorldItemComponent)?.defId === 'oil-flask');
      const [lit, other] = flasks;
      if (lit === undefined || other === undefined) throw new Error('the flasks did not spawn');

      // They lie together at the crate's foot, flammable liquids (their material's properties).
      const at = (id: EntityId) => {
        const p = placementOf(t.sim, id);
        if (p === undefined) throw new Error('unplaced');
        return { x: p.x, y: p.y, z: p.z };
      };
      const crate = at(t.crate);
      for (const flask of flasks) {
        expect(Math.hypot(at(flask).x - crate.x, at(flask).z - crate.z)).toBeLessThan(1);
        expect(readProperty(t.sim, flask, 'liquid')).toBe(true);
        expect(readProperty(t.sim, flask, 'burning')).toBe(false);
      }
      const apart = Math.hypot(at(lit).x - at(other).x, at(lit).z - at(other).z);
      expect(apart).toBeLessThan(0.75);

      // Ignite: the player holds a torch to the first (a contact heat stimulus, as any flame is).
      applyStimulus(t.sim, {
        shape: { kind: 'contact', target: lit },
        element: 'heat',
        intensity: 400,
        source: t.player,
      });
      const where = at(lit);
      let litAt: number | undefined;
      let otherAt: number | undefined;
      for (let i = 0; i < 1800 && otherAt === undefined; i++) {
        t.world.step([]);
        if (litAt === undefined && readProperty(t.sim, lit, 'burning')) litAt = t.world.tick;
        if (readProperty(t.sim, other, 'burning')) otherAt = t.world.tick;
      }
      // The torch lights the first; the second catches from the heat its flames put into the field.
      expect(litAt).toBeDefined();
      expect(otherAt).toBeGreaterThan(litAt ?? Infinity);
      // The area is on fire: the air where the first lies holds flame heat, past oil's ignition.
      expect(elementFieldOf(t.sim).readAt('temperature', where)).toBeGreaterThan(210);
    },
  );
});
