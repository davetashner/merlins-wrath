import { describe, expect, it } from 'vitest';
import { CUE_EVENT_NAMES, cueEventSpec, type CueEventName } from '@content/index';
import { CUE_EVENT_BINDINGS, type CueLookups, type CueReading } from './events.ts';

const MATERIALS: Record<number, string> = { 1: 'bone', 2: 'iron', 3: 'dry-wood' };
const CLASSES: Record<string, string> = { iron: 'metal', bone: 'bone' };
const lookups: CueLookups = {
  materialOf: (e) => MATERIALS[e],
  impactClassOf: (m) => CLASSES[m],
  shieldOf: (e) => (e === 1 ? 'wood-shield' : undefined),
  moveSoundOf: (m) => (m === 'sword-light-1' ? 'sfx-knight-sword-swing-light' : undefined),
  surfaceUnder: () => 'wood',
  armorOf: (e) => (e === 4 ? 'plate' : undefined),
};
/** Only the two required lookups: every optional fact is absent. */
const bare: CueLookups = { materialOf: lookups.materialOf, impactClassOf: lookups.impactClassOf };

const hitbox = {
  tick: 1,
  attacker: 4,
  hitbox: 'sword-light-1',
  activeTick: 2,
  target: 1,
  hurtbox: 'torso',
  region: 'torso',
  multiplier: 1,
  armored: false,
  direction: { x: 0, y: 0, z: 1 },
};

const origin = { x: 1, y: 2, z: 3 };
const packet = {
  instigator: 4,
  source: 2,
  amounts: { slash: 18, blunt: 4 },
  region: 'head',
  tags: [],
};

/** One representative payload per event. */
const SAMPLES: Record<CueEventName, unknown> = {
  DamageApplied: {
    tick: 1,
    target: 1,
    packet,
    amounts: { blunt: 4, slash: 18 },
    total: 22,
    immune: false,
    poiseDamage: 15,
    staminaDamage: 0,
    tags: ['critical'],
    healthBefore: 30,
    healthAfter: 8,
    poiseBroken: true,
    died: false,
  },
  PoiseBroken: { tick: 1, target: 1, instigator: 4, source: null },
  GuardBroken: { tick: 1, entity: 1, instigator: 4, source: null, staggerTicks: 60 },
  HitParried: { tick: 1, entity: 1, attacker: 4, source: null, parriedTicks: 90 },
  DodgedHit: hitbox,
  ActionPhaseChanged: { tick: 1, entity: 4, move: 'sword-light-1', phase: 'active', moveTick: 13 },
  LocomotionEvents: { tick: 1, entity: 4, kind: 'footstep', foot: 'left', gait: 'walk' },
  Died: { tick: 1, target: 1, killer: null, source: 2, tags: ['backstab'] },
  AttackTelegraph: { tick: 1, attacker: 4, attack: 'guard-strike', cue: 'guard-strike-windup' },
  AttackHit: {
    tick: 1,
    attacker: 4,
    attack: 'guard-strike',
    target: 1,
    source: 2,
    results: [{ total: 18 }, { total: 4 }],
  },
  AttackProjectileLaunched: {
    tick: 1,
    attacker: 4,
    attack: 'spit',
    projectile: 9,
    origin,
    direction: { x: 0, y: 0, z: 1 },
  },
  AttackEnded: { tick: 1, attacker: 4, attack: 'guard-strike', reason: 'staggered', elapsed: 9 },
  ActionRejected: { entity: 4, action: 'dodge', reason: 'stamina', tick: 1 },
  StaminaExhausted: { entity: 4, tick: 1 },
  StaminaRecovered: { entity: 4, tick: 1 },
  fireIgnited: { entity: 3 },
  fireExtinguished: { entity: 3, cause: 'water' },
  fireBurntOut: { entity: 3, becomes: 'charred' },
  stimulusResolved: {
    tick: 1,
    stimulus: { shape: { kind: 'point', at: origin }, element: 'fire', source: 4 },
    amount: 5,
    hits: [{ entity: 3, falloff: 1, amount: 5 }],
  },
  propertyChanged: { entity: 3, key: 'burning', old: false, new: true, source: null },
  factChanged: { key: 'bell-rung', old: undefined, new: true, source: null, tick: 1 },
  signalReceived: {
    graph: 7,
    graphId: 'gate',
    node: 'chime',
    receiver: 'audio-cue',
    entity: null,
    key: 'sfx-bell-chime',
    value: true,
    tick: 1,
  },
  volumeEntered: { graph: 7, graphId: 'gate', node: 'plate', entity: 4, tick: 1 },
  volumeExited: { graph: 7, graphId: 'gate', node: 'plate', entity: 4, tick: 1 },
  physicsImpact: {
    entity: 3,
    other: 5,
    materials: ['dry-wood', 'iron'],
    energy: 54,
    impulse: 18,
    speed: 6,
    normal: { x: 0, y: -1, z: 0 },
    position: origin,
  },
};

const read = (event: CueEventName, payload: unknown, look = lookups): CueReading =>
  CUE_EVENT_BINDINGS[event].read(payload, look);

/** The kind a fact value has, in CUE_FACT_KINDS terms. */
function kindOf(value: unknown): string {
  if (Array.isArray(value)) return 'list';
  return typeof value;
}

describe('cue event bindings', () => {
  it('bind every cue event to the sim event of the same name', () => {
    expect(Object.keys(CUE_EVENT_BINDINGS)).toEqual(CUE_EVENT_NAMES);
    for (const name of CUE_EVENT_NAMES) expect(CUE_EVENT_BINDINGS[name].type.name).toBe(name);
  });

  it('produce only declared facts, of the declared kind, and only declared anchors', () => {
    const mismatches: string[] = [];
    for (const name of CUE_EVENT_NAMES) {
      const spec = cueEventSpec(name);
      const { anchors, facts } = read(name, SAMPLES[name]);
      for (const [key, value] of Object.entries(facts)) {
        if (value !== undefined && spec.facts[key] !== kindOf(value)) {
          mismatches.push(`${name}.${key}`);
        }
      }
      for (const key of Object.keys(anchors)) {
        if (!spec.anchors.includes(key)) mismatches.push(`${name}@${key}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('derive hit facts from materials: impact class and material id of target and weapon', () => {
    expect(read('DamageApplied', SAMPLES.DamageApplied)).toEqual({
      anchors: { target: { entity: 1 }, instigator: { entity: 4 }, source: { entity: 2 } },
      facts: {
        target: 'bone',
        targetMaterial: 'bone',
        weapon: 'metal',
        weaponMaterial: 'iron',
        damageType: 'slash',
        contact: 'hit',
        region: 'head',
        tags: ['critical'],
        immune: false,
        died: false,
        poiseBroken: true,
        total: 22,
        poiseDamage: 15,
      },
    });
    // No source: the instigator is the weapon; a material without an impact class is its own class.
    const unarmed = read('DamageApplied', {
      ...(SAMPLES.DamageApplied as object),
      target: 3,
      packet: { ...packet, source: null, instigator: 2 },
      amounts: {},
    });
    expect(unarmed.anchors).toMatchObject({ source: undefined, instigator: { entity: 2 } });
    expect(unarmed.facts).toMatchObject({ target: 'dry-wood', weapon: 'metal' });
    expect(unarmed.facts['damageType']).toBeUndefined();
    // Nobody to blame and no material known: no material facts at all.
    const none = read('DamageApplied', {
      ...(SAMPLES.DamageApplied as object),
      target: 8,
      packet: { ...packet, source: null, instigator: null },
    });
    expect(Object.keys(none.facts)).not.toContain('target');
    expect(Object.keys(none.facts)).not.toContain('weapon');
  });

  it('name the damage type that dealt the most, whatever the order', () => {
    const dominant = (amounts: Record<string, number>) =>
      read('DamageApplied', { ...(SAMPLES.DamageApplied as object), amounts }).facts['damageType'];
    expect(dominant({ slash: 18, blunt: 4 })).toBe('slash');
    expect(dominant({ blunt: 4, slash: 18 })).toBe('slash');
    expect(dominant({ fire: 0 })).toBeUndefined();
  });

  it('read attack, stamina and fire payloads', () => {
    expect(read('AttackTelegraph', SAMPLES.AttackTelegraph).facts).toEqual({
      attack: 'guard-strike',
      telegraph: 'guard-strike-windup',
    });
    expect(read('AttackHit', SAMPLES.AttackHit).facts).toMatchObject({
      total: 22,
      weapon: 'metal',
    });
    expect(read('AttackProjectileLaunched', SAMPLES.AttackProjectileLaunched).anchors).toEqual({
      origin: { position: origin },
      attacker: { entity: 4 },
      projectile: { entity: 9, position: origin },
    });
    expect(read('StaminaRecovered', SAMPLES.StaminaRecovered)).toEqual({
      anchors: { entity: { entity: 4 } },
      facts: {},
    });
    expect(read('fireBurntOut', SAMPLES.fireBurntOut).facts).toEqual({
      material: 'dry-wood',
      becomes: 'charred',
      destroyed: false,
    });
    expect(read('fireBurntOut', { entity: 3, becomes: null }).facts).toEqual({
      material: 'dry-wood',
      becomes: undefined,
      destroyed: true,
    });
  });

  it('anchor a stimulus at a representative point of its shape', () => {
    const at = (shape: object) =>
      read('stimulusResolved', {
        stimulus: { shape, element: 'water', source: null },
        amount: 1,
        hits: [],
      }).anchors['at'];
    expect(at({ kind: 'point', at: origin })).toEqual({ position: origin });
    expect(at({ kind: 'sphere', center: origin })).toEqual({ position: origin });
    expect(at({ kind: 'box', center: origin })).toEqual({ position: origin });
    expect(at({ kind: 'cone', apex: origin })).toEqual({ position: origin });
    expect(at({ kind: 'capsule', from: origin })).toEqual({ position: origin });
    expect(at({ kind: 'contact', target: 5 })).toEqual({ entity: 5 });
  });

  it('split a changed value into on / to / value facts by its type', () => {
    const change = (value: unknown) =>
      read('factChanged', { key: 'k', new: value, source: 3, tick: 1 }).facts;
    expect(change(true)).toEqual({ key: 'k', on: true });
    expect(change('open')).toEqual({ key: 'k', to: 'open' });
    expect(change(4)).toEqual({ key: 'k', value: 4 });
    expect(
      read('propertyChanged', { entity: 3, key: 'lightEmitter', new: { radius: 1 }, source: 4 }),
    ).toEqual({
      anchors: { entity: { entity: 3 }, source: { entity: 4 } },
      facts: { key: 'lightEmitter', material: 'dry-wood' },
    });
  });

  it('read signal receipts, keyed receivers without an entity', () => {
    expect(read('signalReceived', SAMPLES.signalReceived)).toEqual({
      anchors: { entity: undefined },
      facts: {
        graph: 'gate',
        node: 'chime',
        receiver: 'audio-cue',
        key: 'sfx-bell-chime',
        value: true,
      },
    });
    expect(
      read('signalReceived', {
        ...(SAMPLES.signalReceived as object),
        receiver: 'door',
        entity: 6,
        key: null,
      }).facts['key'],
    ).toBeUndefined();
  });

  it('AC-1: read a physics impact: both sides’ impact class and material, energy, impulse and speed', () => {
    expect(read('physicsImpact', SAMPLES.physicsImpact)).toEqual({
      anchors: {
        entity: { entity: 3, position: origin },
        other: { entity: 5 },
        at: { position: origin },
      },
      facts: {
        entity: 'dry-wood', // no impact class known: the material is its own class
        entityMaterial: 'dry-wood',
        other: 'metal',
        otherMaterial: 'iron',
        energy: 54,
        impulse: 18,
        speed: 6,
      },
    });
    // Unbound level geometry: no `other` anchor, but the payload still names its material.
    const unbound = read('physicsImpact', {
      ...(SAMPLES.physicsImpact as object),
      other: null,
      materials: ['bone', 'generic'],
    });
    expect(unbound.anchors['other']).toBeUndefined();
    expect(unbound.facts).toMatchObject({ entity: 'bone', other: 'generic' });
  });

  it('mw-e28.4: tell a clean hit from a blocked one (with the blocker’s shield) and an immune one', () => {
    const damage = (extra: object, look = lookups) =>
      read('DamageApplied', { ...(SAMPLES.DamageApplied as object), ...extra }, look).facts;
    expect(damage({ tags: ['blocked'] })).toMatchObject({
      contact: 'blocked',
      shield: 'wood-shield',
    });
    expect(damage({ tags: ['blocked', 'guard-break'] })['contact']).toBe('blocked');
    expect(damage({ tags: ['blocked'] }, bare)['shield']).toBeUndefined();
    expect(damage({ immune: true, tags: [] })).toMatchObject({ contact: 'immune' });
    expect(damage({ immune: true, tags: [] })['shield']).toBeUndefined();
  });

  it('mw-e28.16: a parried hit is contact parried; the parry names its parrier, attacker and shield', () => {
    const damage = (extra: object) =>
      read('DamageApplied', { ...(SAMPLES.DamageApplied as object), ...extra }).facts;
    expect(damage({ tags: ['parried', 'parryable'] })).toMatchObject({ contact: 'parried' });
    expect(damage({ tags: ['parried'] })['shield']).toBeUndefined();
    expect(read('HitParried', SAMPLES.HitParried)).toEqual({
      anchors: { entity: { entity: 1 }, attacker: { entity: 4 }, source: undefined },
      facts: { shield: 'wood-shield' },
    });
    expect(read('HitParried', { ...(SAMPLES.HitParried as object), attacker: null }, bare)).toEqual(
      {
        anchors: { entity: { entity: 1 }, attacker: undefined, source: undefined },
        facts: { shield: undefined },
      },
    );
  });

  it('mw-e28.4: read guard breaks, dodged swings and move phases (with the move’s own sound)', () => {
    expect(read('GuardBroken', SAMPLES.GuardBroken)).toEqual({
      anchors: { entity: { entity: 1 }, instigator: { entity: 4 }, source: undefined },
      facts: { shield: 'wood-shield' },
    });
    expect(read('DodgedHit', SAMPLES.DodgedHit)).toEqual({
      anchors: { target: { entity: 1 }, attacker: { entity: 4 } },
      facts: { hitbox: 'sword-light-1', region: 'torso' },
    });
    expect(read('ActionPhaseChanged', SAMPLES.ActionPhaseChanged)).toEqual({
      anchors: { entity: { entity: 4 } },
      facts: { move: 'sword-light-1', phase: 'active', sound: 'sfx-knight-sword-swing-light' },
    });
    expect(read('ActionPhaseChanged', SAMPLES.ActionPhaseChanged, bare).facts['sound']).toBe(
      undefined,
    );
    expect(read('GuardBroken', SAMPLES.GuardBroken, bare).facts['shield']).toBeUndefined();
  });

  it('mw-e28.6: read footsteps and landings with the surface underfoot and the armour layer', () => {
    expect(read('LocomotionEvents', SAMPLES.LocomotionEvents)).toEqual({
      anchors: { entity: { entity: 4 } },
      facts: { kind: 'footstep', foot: 'left', gait: 'walk', surface: 'wood', armor: 'plate' },
    });
    const land = (impactSpeed: number) =>
      read('LocomotionEvents', { tick: 1, entity: 5, kind: 'land', impactSpeed }).facts;
    expect(land(4)).toEqual({
      kind: 'land',
      impactSpeed: 4,
      landing: 'light',
      surface: 'wood',
      armor: undefined,
    });
    expect(land(6)['landing']).toBe('heavy');
    // Airborne events have no surface; without the optional lookups there is no surface or armour.
    expect(read('LocomotionEvents', { tick: 1, entity: 4, kind: 'jumpStart' }).facts).toEqual({
      kind: 'jumpStart',
      surface: undefined,
      armor: 'plate',
    });
    expect(read('LocomotionEvents', SAMPLES.LocomotionEvents, bare).facts).toEqual({
      kind: 'footstep',
      foot: 'left',
      gait: 'walk',
    });
  });
});
