// Sim event bindings for cue sheets (mw-e28.3): each cue event name in src/content/cue-events.ts
// bound to the sim's EventType and a reader that turns a payload into the anchors and facts the table
// promises. The map is typed against the content table, so adding an event there without binding it
// here fails typecheck; events.test.ts checks every reader only produces declared facts of the
// declared kind. Readers only read: payloads and, through `CueLookups`, an entity's material.

import type { CueEventName } from '@content/index';
import {
  ActionRejected,
  AttackEnded,
  AttackHit,
  AttackProjectileLaunched,
  AttackTelegraph,
  DamageApplied,
  Died,
  factChanged,
  fireBurntOut,
  fireExtinguished,
  fireIgnited,
  physicsImpact,
  PoiseBroken,
  propertyChanged,
  signalReceived,
  StaminaExhausted,
  StaminaRecovered,
  stimulusResolved,
  volumeEntered,
  volumeExited,
  type DamageAmounts,
  type EntityId,
  type EventType,
  type StimulusShape,
  type Vec3,
} from '@sim/index';
import type { CueFacts, CueFactValue } from './matcher.ts';

/** Where a cue plays: an entity to follow, a fixed position, or both (position is the fallback). */
export interface CueAnchor {
  readonly entity?: EntityId;
  readonly position?: Vec3;
}

/** What a binding reads from one event occurrence. */
export interface CueReading {
  readonly anchors: Readonly<Record<string, CueAnchor | undefined>>;
  readonly facts: CueFacts;
}

/** World lookups a reader may use (read-only). */
export interface CueLookups {
  /** Material id of an entity, if it has one. */
  readonly materialOf: (entity: EntityId) => string | undefined;
  /** Impact class of a material (its impactSound without `sfx-impact-`), e.g. iron → "metal". */
  readonly impactClassOf: (material: string) => string | undefined;
}

/** A cue event bound to the sim. */
export interface CueEventBinding {
  readonly type: EventType<unknown>;
  read(payload: unknown, lookups: CueLookups): CueReading;
}

/** Type-erases a binding; `read` only ever receives payloads of `type` (the bridge pairs them). */
function bind<T>(
  type: EventType<T>,
  read: (payload: T, lookups: CueLookups) => CueReading,
): CueEventBinding {
  return { type: type as EventType<unknown>, read };
}

const at = (entity: EntityId | null): CueAnchor | undefined =>
  entity === null ? undefined : { entity };

/** `<prefix>` (impact class) and `<prefix>Material` facts of a known material id. */
function classFacts(
  prefix: string,
  material: string,
  { impactClassOf }: CueLookups,
): Record<string, string> {
  return { [prefix]: impactClassOf(material) ?? material, [`${prefix}Material`]: material };
}

/** `<prefix>` (impact class) and `<prefix>Material` facts of an entity. */
function materialFacts(
  prefix: string,
  entity: EntityId | null,
  lookups: CueLookups,
): Record<string, string | undefined> {
  const material = entity === null ? undefined : lookups.materialOf(entity);
  return material === undefined ? {} : classFacts(prefix, material, lookups);
}

/** The damage type that dealt the most (canonical order breaks ties). */
function dominantType(amounts: DamageAmounts): string | undefined {
  let best: string | undefined;
  let most = 0;
  for (const [type, amount] of Object.entries(amounts)) {
    if (amount > most) {
      best = type;
      most = amount;
    }
  }
  return best;
}

/** `on` / `to` / `value` facts of a changed value, by its type. */
function valueFacts(value: unknown): Record<string, CueFactValue> {
  if (typeof value === 'boolean') return { on: value };
  if (typeof value === 'string') return { to: value };
  if (typeof value === 'number') return { value };
  return {};
}

/** A representative point of a stimulus shape (a contact shape anchors to its target). */
function shapeAnchor(shape: StimulusShape): CueAnchor {
  switch (shape.kind) {
    case 'point':
      return { position: shape.at };
    case 'sphere':
    case 'box':
      return { position: shape.center };
    case 'cone':
      return { position: shape.apex };
    case 'capsule':
      return { position: shape.from };
    case 'contact':
      return { entity: shape.target };
  }
}

const entityOnly = (payload: { entity: EntityId }): CueReading => ({
  anchors: { entity: { entity: payload.entity } },
  facts: {},
});

/** Every cue event, bound. Keys equal the sim event names (checked by events.test.ts). */
export const CUE_EVENT_BINDINGS: Readonly<Record<CueEventName, CueEventBinding>> = {
  DamageApplied: bind(DamageApplied, (e, look) => {
    const hitter = e.packet.source ?? e.packet.instigator;
    return {
      anchors: {
        target: { entity: e.target },
        instigator: at(e.packet.instigator),
        source: at(e.packet.source),
      },
      facts: {
        ...materialFacts('target', e.target, look),
        ...materialFacts('weapon', hitter, look),
        damageType: dominantType(e.amounts),
        region: e.packet.region,
        tags: e.tags,
        immune: e.immune,
        died: e.died,
        poiseBroken: e.poiseBroken,
        total: e.total,
        poiseDamage: e.poiseDamage,
      },
    };
  }),
  PoiseBroken: bind(PoiseBroken, (e, look) => ({
    anchors: { target: { entity: e.target }, instigator: at(e.instigator), source: at(e.source) },
    facts: materialFacts('target', e.target, look),
  })),
  Died: bind(Died, (e, look) => ({
    anchors: { target: { entity: e.target }, killer: at(e.killer), source: at(e.source) },
    facts: { ...materialFacts('target', e.target, look), tags: e.tags },
  })),
  AttackTelegraph: bind(AttackTelegraph, (e) => ({
    anchors: { attacker: { entity: e.attacker } },
    facts: { attack: e.attack, telegraph: e.cue },
  })),
  AttackHit: bind(AttackHit, (e, look) => ({
    anchors: {
      target: { entity: e.target },
      attacker: { entity: e.attacker },
      source: { entity: e.source },
    },
    facts: {
      ...materialFacts('target', e.target, look),
      ...materialFacts('weapon', e.source, look),
      attack: e.attack,
      total: e.results.reduce((sum, r) => sum + r.total, 0),
    },
  })),
  AttackProjectileLaunched: bind(AttackProjectileLaunched, (e) => ({
    anchors: {
      origin: { position: e.origin },
      attacker: { entity: e.attacker },
      projectile: { entity: e.projectile, position: e.origin },
    },
    facts: { attack: e.attack },
  })),
  AttackEnded: bind(AttackEnded, (e) => ({
    anchors: { attacker: { entity: e.attacker } },
    facts: { attack: e.attack, reason: e.reason },
  })),
  ActionRejected: bind(ActionRejected, (e) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { action: e.action, reason: e.reason },
  })),
  StaminaExhausted: bind(StaminaExhausted, entityOnly),
  StaminaRecovered: bind(StaminaRecovered, entityOnly),
  fireIgnited: bind(fireIgnited, (e, look) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { material: look.materialOf(e.entity) },
  })),
  fireExtinguished: bind(fireExtinguished, (e, look) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { material: look.materialOf(e.entity), cause: e.cause },
  })),
  fireBurntOut: bind(fireBurntOut, (e, look) => ({
    anchors: { entity: { entity: e.entity } },
    facts: {
      material: look.materialOf(e.entity),
      becomes: e.becomes ?? undefined,
      destroyed: e.becomes === null,
    },
  })),
  stimulusResolved: bind(stimulusResolved, (e) => ({
    anchors: { at: shapeAnchor(e.stimulus.shape), source: at(e.stimulus.source) },
    facts: {
      element: e.stimulus.element,
      shape: e.stimulus.shape.kind,
      amount: e.amount,
      hits: e.hits.length,
    },
  })),
  propertyChanged: bind(propertyChanged, (e, look) => ({
    anchors: { entity: { entity: e.entity }, source: at(e.source) },
    facts: { key: e.key, ...valueFacts(e.new), material: look.materialOf(e.entity) },
  })),
  factChanged: bind(factChanged, (e) => ({
    anchors: { source: at(e.source) },
    facts: { key: e.key, ...valueFacts(e.new) },
  })),
  signalReceived: bind(signalReceived, (e) => ({
    anchors: { entity: at(e.entity) },
    facts: {
      graph: e.graphId,
      node: e.node,
      receiver: e.receiver,
      key: e.key ?? undefined,
      value: e.value,
    },
  })),
  volumeEntered: bind(volumeEntered, (e) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { graph: e.graphId, node: e.node },
  })),
  volumeExited: bind(volumeExited, (e) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { graph: e.graphId, node: e.node },
  })),
  // The payload names both materials (unbound geometry reads the default), so no lookup is needed.
  physicsImpact: bind(physicsImpact, (e, look) => ({
    anchors: {
      entity: { entity: e.entity, position: e.position },
      other: at(e.other),
      at: { position: e.position },
    },
    facts: {
      ...classFacts('entity', e.materials[0], look),
      ...classFacts('other', e.materials[1], look),
      energy: e.energy,
      impulse: e.impulse,
      speed: e.speed,
    },
  })),
};
