import type { CaffeinePreset } from './presets.ts';
import type { DerivedEntry, Transcript } from '../store/types.ts';
import { EXTRACTION_VERSION, extractCaffeine, rulesetHash } from './caffeine.ts';
import { findPreset } from './presets.ts';

export {
  EXTRACTION_VERSION,
  extractCaffeine,
  rulesetHash,
  type CaffeineEvent,
  type CaffeineExtraction,
  type CaffeineStatus,
} from './caffeine.ts';
export {
  DEFAULT_PRESETS,
  PresetError,
  aliasIndex,
  findPreset,
  loadPresets,
  validatePresets,
  type CaffeinePreset,
} from './presets.ts';

/**
 * Build the derived record for one transcript. Pure apart from the clock, and it
 * reads nothing but this transcript's own text — never history (PRD §6).
 */
export function extractDerived(
  transcript: Transcript,
  presets: CaffeinePreset[],
  now: Date = new Date(),
): DerivedEntry {
  const { events, lastCaffeine, totalMg, caffeineStatus } = extractCaffeine(transcript.text, presets);
  return {
    transcriptId: transcript.id,
    date: transcript.date,
    lastCaffeine,
    caffeineStatus,
    caffeineMg: totalMg,
    caffeineEvents: events,
    extractionVersion: EXTRACTION_VERSION,
    rulesetHash: rulesetHash(presets),
    extractedAt: now.toISOString(),
  };
}

/** The caffeine half of the Layer 2 confirmation line (PRD §6). */
export function caffeineSummary(derived: DerivedEntry): string | null {
  const dose = derived.caffeineMg === null ? '' : ` (${derived.caffeineMg}mg)`;
  switch (derived.caffeineStatus) {
    case 'time':
      return `caffeine ${derived.lastCaffeine}${dose}`;
    case 'none':
      return 'no caffeine';
    case 'unclear':
      return `caffeine time unclear${dose}`;
    case 'unmentioned':
      return null;
  }
}

const ISO_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class QuickLogError extends Error {}

/**
 * The quick-log path: a preset id and a time become an ordinary transcript
 * sentence, which the ordinary extractor then reads.
 *
 * This is the answer to "I do not want to talk, I want to log a coffee". It
 * needs no model, no phrasing and no luck — but it deliberately does *not* write
 * a derived value directly. The transcript stays the source of truth (PRD §2.1),
 * so a quick log is a real, re-extractable entry rather than a number smuggled
 * past the corpus, and improving the extractor still improves it.
 *
 * The PRD allows exactly this as the form fallback (PRD §5).
 */
export function expandPreset(
  presets: CaffeinePreset[],
  presetId: string,
  at: string,
  count = 1,
): { text: string; preset: CaffeinePreset } {
  const preset = findPreset(presets, presetId);
  if (!preset) {
    const known = presets.map((p) => p.id).join(', ');
    throw new QuickLogError(`Unknown preset "${presetId}". Known presets: ${known}`);
  }
  if (!ISO_TIME.test(at)) {
    throw new QuickLogError(`Time must be HH:MM in 24-hour form — got "${at}".`);
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new QuickLogError(`Count must be a whole number from 1 to 20 — got ${count}.`);
  }

  // Written the way the parser reads best, and the way you would say it. The
  // round trip is covered by a test: every preset must survive expand ->
  // extract and come back as the same preset, count and time.
  const noun = count === 1 ? preset.label.toLowerCase() : `${preset.label.toLowerCase()}s`;
  const quantity = count === 1 ? 'One' : String(count);
  return { text: `${quantity} ${noun} at ${at}.`, preset };
}
