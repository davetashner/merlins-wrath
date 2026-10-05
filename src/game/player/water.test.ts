// @vitest-environment happy-dom
// The player's water glue (mw-e02.14): the load class from equipment, drowning through the damage
// model, the breath model and the sinking notice.
import { describe, expect, it } from 'vitest';
import { loadGameContent, PLAYER_CONTROLLER_ID, controllerTuningFor } from '@content/index';
import {
  addEquipment,
  addInventory,
  CharacterBreath,
  CharacterController,
  DAMAGE_COMPONENTS,
  DamageApplied,
  DamageModel,
  DEFAULT_WATER_TUNING,
  giveBreath,
  giveCombatant,
  healthOf,
  spawnCharacter,
  Sinking,
  World,
} from '@sim/index';
import { WaterHud, WATER_HUD_TEXT } from '@ui/water-hud';
import { DROWNING_TAG, playerWater } from './water';
import { attachWaterHud, waterHudModel } from './water-hud';

const content = loadGameContent();
const tuning = controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID));

function setup() {
  const world = new World<never>({ seed: 1, hz: 60 });
  world.register(CharacterController, CharacterBreath, ...DAMAGE_COMPONENTS);
  const player = spawnCharacter(world, { x: 0, y: 0, z: 0 });
  return { world, player };
}

describe('player water (mw-e02.14)', () => {
  it('has no load class until the player has equipment, then reads it from the worn armor', () => {
    const { world, player } = setup();
    const water = playerWater({ content, world, damage: new DamageModel() });
    expect(water.loadClass?.(player)).toBeUndefined();
    addInventory(world, player);
    addEquipment(world, player, 'knight');
    expect(water.loadClass?.(player)).toBe('light');
    expect(water.loadClass?.(player)).toBe('light'); // the rules are built once and reused
  });

  it('drowning is environmental blunt damage tagged drowning', () => {
    const { world, player } = setup();
    giveCombatant(world, player, { health: 100 });
    const damage = new DamageModel();
    const seen: string[][] = [];
    world.events.on(DamageApplied, (hit) => seen.push([...hit.tags]));
    const water = playerWater({ content, world, damage });
    water.onDrown?.(player, 10);
    world.step();
    expect(healthOf(world, player)?.current).toBe(90);
    expect(seen).toEqual([['drowning', 'environment']]);
    expect(DROWNING_TAG).toBe('drowning');
  });
});

describe('water HUD glue (mw-e02.14)', () => {
  it('has no model until the player has a breath', () => {
    const { world, player } = setup();
    expect(waterHudModel(world, player, tuning)).toBeNull();
    const bare = new World<never>({ seed: 1 });
    expect(waterHudModel(bare, 1, tuning)).toBeNull();
  });

  it('shows the breath left, and the warning once when the player starts to sink', () => {
    document.body.innerHTML = '';
    const { world, player } = setup();
    giveBreath(world, player, DEFAULT_WATER_TUNING, 60);
    world.step();
    const hud = new WaterHud();
    document.body.append(hud.element);
    const glue = attachWaterHud({ world, player, hud, tuning });
    glue.frame(0);
    expect(hud.visible).toBe(false);
    world.set(player, CharacterBreath, {
      air: 10 * 60,
      drowning: 0,
      inWater: true,
      sinking: false,
    });
    glue.frame(16);
    expect(waterHudModel(world, player, tuning)?.breath).toBeCloseTo(0.5, 6);
    expect(hud.visible).toBe(true);
    world.events.emit(Sinking, { entity: player, tick: 1 });
    world.events.emit(Sinking, { entity: player + 1, tick: 1 });
    world.step();
    glue.frame(32);
    expect(hud.notice).toBe(WATER_HUD_TEXT.sinking);
    glue.dispose();
    world.events.emit(Sinking, { entity: player, tick: 2 });
    world.step();
    glue.frame(10_000);
    expect(hud.notice).toBe('');
  });

  it('does nothing for a player without a breath', () => {
    document.body.innerHTML = '';
    const { world, player } = setup();
    const hud = new WaterHud();
    const glue = attachWaterHud({ world, player, hud, tuning });
    glue.frame(0);
    expect(hud.visible).toBe(false);
  });
});
