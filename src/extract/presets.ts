/**
 * The preset catalogue — the drinks, what they contain, and what they get called.
 *
 * This file is the extractor's entire vocabulary. There is no second hardcoded
 * word list anywhere: the aliases below are what the rules match on, and the
 * milligrams below are what a matched drink is worth. Add a preset here (or in
 * your own file, see `loadPresets`) and both the parser and the quick-log path
 * learn it at once.
 *
 * Milligrams are typical servings, not measurements. A "coffee" is a 2x range
 * depending on bean, grind and pour, which is the same false-precision problem
 * that got food tracking cut (PRD §8). They are here because *relative* dose
 * across your own days is the useful signal — a 200mg cold brew and a 63mg latte
 * are not the same input — and because a number you can override beats a
 * category you cannot.
 */

export interface CaffeinePreset {
  /** Stable id. Used by the quick-log path, so keep it typeable. */
  id: string;
  label: string;
  /** Typical caffeine in one serving, milligrams. */
  mg: number;
  /**
   * Every way this drink gets said out loud. Longest alias wins, so "green tea"
   * beats "tea" and "double espresso" beats "espresso".
   */
  aliases: string[];
  /** Carries no meaningful caffeine. Matched, counted, then excluded from the dose. */
  decaf?: boolean;
}

/**
 * Defaults. Yours will differ — that is what `DROWSE_PRESETS` is for. Values are
 * mid-range figures for a standard serving (USDA / manufacturer published).
 */
export const DEFAULT_PRESETS: CaffeinePreset[] = [
  // --- Coffee ---------------------------------------------------------------
  { id: 'coffee', label: 'Coffee', mg: 95, aliases: ['coffee', 'cup of coffee', 'drip coffee', 'filter coffee', 'brewed coffee', 'black coffee'] },
  { id: 'espresso', label: 'Espresso', mg: 63, aliases: ['espresso', 'single espresso', 'shot', 'shot of espresso'] },
  { id: 'double-espresso', label: 'Double espresso', mg: 126, aliases: ['double espresso', 'doppio', 'double shot', 'two shots'] },
  { id: 'americano', label: 'Americano', mg: 77, aliases: ['americano', 'long black'] },
  { id: 'latte', label: 'Latte', mg: 63, aliases: ['latte', 'caffe latte', 'cafe latte'] },
  { id: 'flat-white', label: 'Flat white', mg: 130, aliases: ['flat white'] },
  { id: 'cappuccino', label: 'Cappuccino', mg: 63, aliases: ['cappuccino'] },
  { id: 'cortado', label: 'Cortado', mg: 63, aliases: ['cortado', 'macchiato'] },
  { id: 'mocha', label: 'Mocha', mg: 90, aliases: ['mocha'] },
  { id: 'cold-brew', label: 'Cold brew', mg: 200, aliases: ['cold brew', 'nitro', 'nitro cold brew'] },
  { id: 'instant-coffee', label: 'Instant coffee', mg: 62, aliases: ['instant coffee', 'instant'] },
  { id: 'decaf', label: 'Decaf', mg: 3, aliases: ['decaf', 'decaf coffee', 'decaffeinated coffee'], decaf: true },

  // --- Tea ------------------------------------------------------------------
  { id: 'black-tea', label: 'Black tea', mg: 47, aliases: ['tea', 'black tea', 'english breakfast', 'earl grey', 'builders tea', 'cup of tea'] },
  { id: 'green-tea', label: 'Green tea', mg: 28, aliases: ['green tea', 'sencha'] },
  { id: 'matcha', label: 'Matcha', mg: 70, aliases: ['matcha', 'matcha latte'] },
  { id: 'chai', label: 'Chai', mg: 50, aliases: ['chai', 'chai latte'] },
  { id: 'herbal-tea', label: 'Herbal tea', mg: 0, aliases: ['herbal tea', 'peppermint tea', 'mint tea', 'chamomile', 'camomile', 'rooibos', 'ginger tea'], decaf: true },

  // --- Everything else ------------------------------------------------------
  { id: 'coke', label: 'Coke', mg: 34, aliases: ['coke', 'cola', 'coca-cola', 'pepsi'] },
  { id: 'diet-coke', label: 'Diet coke', mg: 46, aliases: ['diet coke', 'coke zero', 'diet cola'] },
  { id: 'energy-drink', label: 'Energy drink', mg: 80, aliases: ['energy drink', 'red bull', 'redbull'] },
  { id: 'monster', label: 'Monster', mg: 160, aliases: ['monster'] },
  { id: 'pre-workout', label: 'Pre-workout', mg: 200, aliases: ['pre-workout', 'preworkout', 'pre workout'] },
  { id: 'dark-chocolate', label: 'Dark chocolate', mg: 24, aliases: ['dark chocolate'] },

  /**
   * A generic catch-all so "caffeine" in a sentence is still a match. It has no
   * dose, because "I had caffeine at 2pm" says nothing about how much.
   */
  { id: 'unspecified', label: 'Caffeine', mg: 0, aliases: ['caffeine', 'caffeinated'] },
];

/** Ids whose dose is unknown rather than zero — they must not drag a total down. */
export const DOSELESS = new Set(['unspecified']);

export class PresetError extends Error {}

/**
 * Validate a catalogue. Loud on load rather than silently wrong six weeks later:
 * a duplicate alias would make matching depend on array order, which is exactly
 * the kind of invisible drift `rulesetHash` exists to catch.
 */
export function validatePresets(presets: CaffeinePreset[]): CaffeinePreset[] {
  if (presets.length === 0) throw new PresetError('The preset catalogue is empty.');

  const ids = new Set<string>();
  const aliases = new Map<string, string>();

  for (const preset of presets) {
    if (!/^[a-z0-9-]+$/.test(preset.id)) {
      throw new PresetError(`Preset id "${preset.id}" must be lowercase letters, digits and dashes.`);
    }
    if (ids.has(preset.id)) throw new PresetError(`Duplicate preset id: "${preset.id}".`);
    ids.add(preset.id);

    if (!Number.isFinite(preset.mg) || preset.mg < 0) {
      throw new PresetError(`Preset "${preset.id}" has an invalid mg: ${preset.mg}.`);
    }
    if (preset.aliases.length === 0) {
      throw new PresetError(`Preset "${preset.id}" has no aliases, so nothing can ever match it.`);
    }

    for (const alias of preset.aliases) {
      const key = alias.toLowerCase().trim();
      if (!key) throw new PresetError(`Preset "${preset.id}" has an empty alias.`);
      const owner = aliases.get(key);
      if (owner && owner !== preset.id) {
        throw new PresetError(
          `Alias "${key}" is claimed by both "${owner}" and "${preset.id}". ` +
            'Matching would depend on array order — give one of them a different word.',
        );
      }
      aliases.set(key, preset.id);
    }
  }
  return presets;
}

/**
 * Load the catalogue. `DROWSE_PRESETS` points at a JSON file — either an array of
 * presets (replaces the defaults outright) or `{ "extends": "default", "presets":
 * [...] }` to add to and override them by id.
 *
 * Your morning is not the average morning. The defaults are a starting point, and
 * the moment you weigh your own beans they are wrong.
 */
export function loadPresets(json?: string): CaffeinePreset[] {
  if (!json) return validatePresets(DEFAULT_PRESETS);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new PresetError(`Preset file is not valid JSON: ${String(error)}`);
  }

  if (Array.isArray(parsed)) return validatePresets(parsed as CaffeinePreset[]);

  if (parsed && typeof parsed === 'object' && 'presets' in parsed) {
    const { extends: base, presets } = parsed as { extends?: string; presets: CaffeinePreset[] };
    if (!Array.isArray(presets)) throw new PresetError('"presets" must be an array.');
    if (base !== undefined && base !== 'default') {
      throw new PresetError(`"extends" must be "default" or absent — got "${base}".`);
    }
    if (base === undefined) return validatePresets(presets);

    const merged = new Map(DEFAULT_PRESETS.map((p) => [p.id, p]));
    for (const preset of presets) merged.set(preset.id, preset);
    return validatePresets([...merged.values()]);
  }

  throw new PresetError('Preset file must be an array, or an object with a "presets" array.');
}

export function findPreset(presets: CaffeinePreset[], id: string): CaffeinePreset | undefined {
  return presets.find((preset) => preset.id === id.toLowerCase().trim());
}

/** Every alias, longest first — the order the matcher must try them in. */
export function aliasIndex(presets: CaffeinePreset[]): { alias: string; preset: CaffeinePreset }[] {
  return presets
    .flatMap((preset) => preset.aliases.map((alias) => ({ alias: alias.toLowerCase(), preset })))
    .sort((a, b) => b.alias.length - a.alias.length || a.alias.localeCompare(b.alias));
}
