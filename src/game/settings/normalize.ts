// Lenient settings loading (mw-e31.1). Stored settings come from an older build, a newer build, or a
// player poking at localStorage, so loading never rejects the whole object: each value is checked on
// its own against the schema. A number outside its range is clamped, any other bad value falls back
// to its default, unknown keys and categories are dropped, and every repair is reported as a warning.

import {
  SETTINGS_CATEGORIES,
  SETTINGS_SCHEMA,
  settingDefs,
  settingValueSchema,
  type SettingDef,
  type Settings,
} from './schema';

/** Receives one human-readable line per repair. */
export type SettingsWarn = (message: string) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stored value as it reads in a warning (`NaN`, `undefined`, `"loud"`, `[1,2]`). */
export function describeValue(value: unknown): string {
  return value === undefined || typeof value === 'number' ? String(value) : JSON.stringify(value);
}

/**
 * Repairs one value for `def`: valid values pass through, an out-of-range finite number is clamped
 * to the range, anything else becomes the default. `key` names it in the warning.
 */
export function coerceSetting(
  def: SettingDef,
  value: unknown,
  key: string,
  warn: SettingsWarn,
): unknown {
  if (settingValueSchema(def).safeParse(value).success) return value;
  if (def.kind === 'slider' && typeof value === 'number' && Number.isFinite(value)) {
    const clamped = Math.min(def.max, Math.max(def.min, value));
    warn(
      `setting ${key}: ${String(value)} is outside ${String(def.min)}–${String(def.max)}; clamped to ${String(clamped)}`,
    );
    return clamped;
  }
  warn(`setting ${key}: ${describeValue(value)} is invalid; using the default`);
  return def.default;
}

/** Turns any stored settings object (current version) into valid Settings, warning per repair. */
export function normalizeSettings(raw: unknown, warn: SettingsWarn): Settings {
  const stored = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) warn('stored settings are not an object; using the defaults');
  for (const category of Object.keys(stored)) {
    if (!(category in SETTINGS_SCHEMA)) warn(`dropped unknown settings category ${category}`);
  }
  const settings: Record<string, Record<string, unknown>> = {};
  for (const category of SETTINGS_CATEGORIES) {
    const given = stored[category];
    const values = isRecord(given) ? given : {};
    if (given !== undefined && !isRecord(given)) {
      warn(`settings category ${category} is not an object; using its defaults`);
    }
    const out: Record<string, unknown> = {};
    for (const { key, def } of settingDefs(category)) {
      const name = key.slice(category.length + 1);
      out[name] = name in values ? coerceSetting(def, values[name], key, warn) : def.default;
    }
    for (const name of Object.keys(values)) {
      if (!(name in out)) warn(`dropped unknown setting ${category}.${name}`);
    }
    settings[category] = out;
  }
  return settings as unknown as Settings;
}
