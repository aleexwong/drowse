import type { DerivedEntry, Transcript } from '../store/types.ts';
import { EXTRACTION_VERSION, RULESET_HASH, extractCaffeine } from './caffeine.ts';

export {
  EXTRACTION_VERSION,
  RULESET_HASH,
  extractCaffeine,
  type CaffeineExtraction,
  type CaffeineStatus,
} from './caffeine.ts';

/**
 * Build the derived record for one transcript. Pure apart from the clock, and it
 * reads nothing but this transcript's own text — no history, ever (PRD §6).
 */
export function extractDerived(transcript: Transcript, now: Date = new Date()): DerivedEntry {
  const { lastCaffeine, caffeineStatus } = extractCaffeine(transcript.text);
  return {
    transcriptId: transcript.id,
    date: transcript.date,
    lastCaffeine,
    caffeineStatus,
    extractionVersion: EXTRACTION_VERSION,
    rulesetHash: RULESET_HASH,
    extractedAt: now.toISOString(),
  };
}

/** The caffeine half of the Layer 2 confirmation line (PRD §6). */
export function caffeineSummary(derived: DerivedEntry): string | null {
  switch (derived.caffeineStatus) {
    case 'time':
      return `caffeine ${derived.lastCaffeine}`;
    case 'none':
      return 'no caffeine';
    case 'unclear':
      return 'caffeine time unclear';
    case 'unmentioned':
      return null;
  }
}
