// The closed, versioned set of world properties (mw-e03.1). Interactions come from properties
// (flammable, wet, conductive…), never from pairs of object types, so every system — fire, water,
// stealth, physics, AI — reads and writes this one vocabulary. This module is the single sim-side
// definition of each property: its value type, range, unit, default and meaning. The content layer
// mirrors it as a zod schema (src/content/world-properties.ts); tests/contracts keeps the two equal.
// Adding, removing or changing a property is a schema change: bump WORLD_PROPERTIES_VERSION (save
// migrations, e30, key off it).

/** Bumped whenever a property is added, removed, renamed or changes type or range. */
export const WORLD_PROPERTIES_VERSION = 1;

/** A light source's output. Colour is a render concern and lives outside the sim. */
export interface LightEmission {
  /** Light output in sim light units (0 = dark; a torch is about 100). */
  readonly intensity: number;
  /** Distance in metres beyond which the source contributes no light. */
  readonly radius: number;
}

/** Every world property and its value type. Absent on an entity = the property's default. */
export interface WorldPropertyValues {
  /** Material preset id (e03-material-presets supplies the per-material defaults). */
  material: string;
  /** Current temperature, °C. */
  temperature: number;
  /** Fire can ignite it (see `isFlammableNow` for whether it can right now). */
  flammable: boolean;
  /** Temperature at which it ignites, °C. */
  ignitionPoint: number;
  /** Seconds of burning left before the fuel is spent. */
  fuel: number;
  /** On fire right now. */
  burning: boolean;
  /** How soaked it is: 0 dry … 1 saturated. */
  wetness: number;
  /** Frozen solid (ice, or an object encased in it). */
  frozen: boolean;
  /** Temperature at or below which it freezes, °C. */
  freezePoint: number;
  /** Conducts electric charge. */
  conductive: boolean;
  /** Stored electric charge, sim charge units (0 = neutral). */
  charge: number;
  /** Mass, kg. */
  weight: number;
  /** Breaks when a single impact delivers at least this much energy, J. */
  fragile: number;
  /** Structural hit points; at 0 it is destroyed or collapses. */
  hp: number;
  /** Density, kg/m³: below water's 1000 it floats (buoyancy). */
  density: number;
  /** Climbing grade: 1 easy (ladder, ivy), 2 needs stamina (rough stone), 3 needs skill or a tool. */
  climbable: number;
  /** Can be picked up and carried. */
  liftable: boolean;
  /** Can be pushed or dragged. */
  pushable: boolean;
  /** An actor can hide in or behind it. */
  hideable: boolean;
  /** Reflects light beams and bolts. */
  reflective: boolean;
  /** Light and sight pass through it (glass, water, ice). */
  transparent: boolean;
  /** Fully blocks light and sight. Neither this nor transparent = partial cover (foliage, cloth). */
  opaque: boolean;
  /** Emits light. */
  lightEmitter: LightEmission;
  /** Fraction of sound it absorbs: 0 none … 1 all. */
  soundDamping: number;
  /** Surface friction coefficient (ice ≈ 0.05, stone ≈ 0.6, rubber ≈ 1). */
  friction: number;
  /** Fraction of impact energy it absorbs (straw, cushions): 0 none … 1 all. */
  impactAbsorb: number;
  /** Ownership tag (faction or owner id): taking or breaking an owned object can be a crime. */
  owner: string;
}

/** Name of a world property. */
export type WorldPropertyKey = keyof WorldPropertyValues;

interface SpecBase<T> {
  /** Effective value when an entity doesn't have the property. */
  readonly default: T;
  /** One-line meaning, used in docs and editor tooltips. */
  readonly doc: string;
}

/** Inclusive numeric range (every property number is finite). */
export interface NumberRange {
  readonly min: number;
  readonly max: number;
  /** Whole numbers only. */
  readonly integer?: true;
  /** Display unit, '' when unitless. */
  readonly unit: string;
}

export interface NumberSpec extends SpecBase<number>, NumberRange {
  readonly type: 'number';
}
export interface BooleanSpec extends SpecBase<boolean> {
  readonly type: 'boolean';
}
/** A lowercase kebab-case id (same format as content ids). */
export interface IdSpec extends SpecBase<string> {
  readonly type: 'id';
}
/** A flat record of numbers, e.g. `lightEmitter`. */
export interface RecordSpec<T> extends SpecBase<T> {
  readonly type: 'record';
  readonly fields: { readonly [F in keyof T]: NumberRange };
}

/** The spec a property with value type `T` has. */
export type PropertySpec<T> = [T] extends [number]
  ? NumberSpec
  : [T] extends [boolean]
    ? BooleanSpec
    : [T] extends [string]
      ? IdSpec
      : RecordSpec<T>;

/** Any property's spec, for code that handles every kind. */
export type AnyPropertySpec =
  | NumberSpec
  | BooleanSpec
  | IdSpec
  | (SpecBase<unknown> & {
      readonly type: 'record';
      readonly fields: Readonly<Record<string, NumberRange>>;
    });

/** Lowercase kebab-case, e.g. `dry-wood` (mirrors the content id format). */
export const PROPERTY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ABSOLUTE_ZERO = -273.15;
/** Hotter than anything the game simulates; a larger value is a bug, not a hot fire. */
const MAX_TEMPERATURE = 10_000;

const celsius = (fallback: number, doc: string): NumberSpec => ({
  type: 'number',
  min: ABSOLUTE_ZERO,
  max: MAX_TEMPERATURE,
  unit: '°C',
  default: fallback,
  doc,
});
const unit01 = (doc: string): NumberSpec => ({
  type: 'number',
  min: 0,
  max: 1,
  unit: '',
  default: 0,
  doc,
});
const flag = (doc: string): BooleanSpec => ({ type: 'boolean', default: false, doc });

/** Every property's spec. Keys are the snapshot and data-file names: never rename one. */
export const WORLD_PROPERTY_SPECS: {
  readonly [K in WorldPropertyKey]: PropertySpec<WorldPropertyValues[K]>;
} = {
  material: { type: 'id', default: 'generic', doc: 'Material preset id.' },
  temperature: celsius(20, 'Current temperature.'),
  flammable: flag('Fire can ignite it.'),
  ignitionPoint: celsius(300, 'Temperature at which it ignites.'),
  fuel: {
    type: 'number',
    min: 0,
    max: 86_400,
    unit: 's',
    default: 0,
    doc: 'Seconds of burning left.',
  },
  burning: flag('On fire right now.'),
  wetness: unit01('How soaked it is (0 dry, 1 saturated).'),
  frozen: flag('Frozen solid.'),
  freezePoint: celsius(0, 'Temperature at or below which it freezes.'),
  conductive: flag('Conducts electric charge.'),
  charge: {
    type: 'number',
    min: 0,
    max: 1_000_000,
    unit: 'charge',
    default: 0,
    doc: 'Stored electric charge.',
  },
  weight: { type: 'number', min: 0, max: 1_000_000, unit: 'kg', default: 1, doc: 'Mass.' },
  fragile: {
    type: 'number',
    min: 0,
    max: 1_000_000_000,
    unit: 'J',
    default: 1_000_000_000,
    doc: 'Impact energy that breaks it (the default is effectively unbreakable).',
  },
  hp: {
    type: 'number',
    min: 0,
    max: 1_000_000,
    unit: 'hp',
    default: 100,
    doc: 'Structural hit points.',
  },
  density: {
    type: 'number',
    min: 0.01,
    max: 100_000,
    unit: 'kg/m³',
    default: 1000,
    doc: 'Density; below 1000 it floats in water.',
  },
  climbable: {
    type: 'number',
    min: 1,
    max: 3,
    integer: true,
    unit: 'grade',
    default: 1,
    doc: 'Climbing grade: 1 easy, 2 needs stamina, 3 needs skill or a tool.',
  },
  liftable: flag('Can be picked up and carried.'),
  pushable: flag('Can be pushed or dragged.'),
  hideable: flag('An actor can hide in or behind it.'),
  reflective: flag('Reflects light beams and bolts.'),
  transparent: flag('Light and sight pass through it.'),
  opaque: flag('Fully blocks light and sight.'),
  lightEmitter: {
    type: 'record',
    fields: {
      intensity: { min: 0, max: 100_000, unit: 'light' },
      radius: { min: 0, max: 100, unit: 'm' },
    },
    default: { intensity: 0, radius: 0 },
    doc: 'Emits light of this intensity out to this radius.',
  },
  soundDamping: unit01('Fraction of sound it absorbs.'),
  friction: {
    type: 'number',
    min: 0,
    max: 2,
    unit: '',
    default: 0.6,
    doc: 'Surface friction coefficient.',
  },
  impactAbsorb: unit01('Fraction of impact energy it absorbs.'),
  owner: { type: 'id', default: 'unowned', doc: 'Ownership tag (faction or owner id).' },
};

/** Every property name, in code-unit order (the canonical order for docs and iteration). */
export const WORLD_PROPERTY_KEYS: readonly WorldPropertyKey[] = Object.freeze(
  (Object.keys(WORLD_PROPERTY_SPECS) as WorldPropertyKey[]).sort(),
);

/** Whether `key` names a world property. */
export function isWorldPropertyKey(key: string): key is WorldPropertyKey {
  return Object.hasOwn(WORLD_PROPERTY_SPECS, key);
}

function checkNumber(range: NumberRange, value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number';
  if (value < range.min) return `must be ≥ ${String(range.min)}, got ${String(value)}`;
  if (value > range.max) return `must be ≤ ${String(range.max)}, got ${String(value)}`;
  if (range.integer === true && !Number.isInteger(value)) {
    return `must be a whole number, got ${String(value)}`;
  }
  return undefined;
}

function checkRecord(fields: Readonly<Record<string, NumberRange>>, value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return 'must be a plain object';
  }
  const extra = Object.keys(value).find((name) => !Object.hasOwn(fields, name));
  if (extra !== undefined) return `has unknown field "${extra}"`;
  for (const [name, range] of Object.entries(fields)) {
    const problem = checkNumber(range, (value as Record<string, unknown>)[name]);
    if (problem !== undefined) return `.${name} ${problem}`;
  }
  return undefined;
}

/**
 * Why `value` is not a valid value of property `key` (e.g. `"wetness must be ≤ 1, got 1.4"`), or
 * undefined when it is valid. Accepts untyped input (restored saves, tools).
 */
export function validateProperty(key: WorldPropertyKey, value: unknown): string | undefined {
  const spec: AnyPropertySpec = WORLD_PROPERTY_SPECS[key];
  let problem: string | undefined;
  switch (spec.type) {
    case 'number':
      problem = checkNumber(spec, value);
      break;
    case 'boolean':
      problem = typeof value === 'boolean' ? undefined : 'must be true or false';
      break;
    case 'id':
      problem =
        typeof value === 'string' && PROPERTY_ID_PATTERN.test(value)
          ? undefined
          : 'must be a lowercase kebab-case id';
      break;
    case 'record':
      problem = checkRecord(spec.fields, value);
      break;
  }
  return problem === undefined ? undefined : `${key} ${problem}`;
}

/** Throws a RangeError unless `value` is a valid value of property `key`. */
export function assertProperty<K extends WorldPropertyKey>(
  key: K,
  value: unknown,
): asserts value is WorldPropertyValues[K] {
  const problem = validateProperty(key, value);
  if (problem !== undefined) throw new RangeError(problem);
}
