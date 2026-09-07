/**
 * `reextract_all` — Layer 1+ (PRD §6). Re-runs the current extractor over every
 * transcript and rewrites the derived collection.
 *
 * This is the operation that makes retroactive variables safe (PRD §4.3): add a
 * variable in month three, re-run once, and get it for every past day at the
 * same extraction version. Baseline and intervention data must share a version
 * or the comparison is invalid, so re-extraction is whole-dataset and never
 * per-entry.
 *
 * It returns a version-bump summary and nothing else. It reads transcripts, but
 * no transcript text and no per-day value ever leaves this tool, so it stays
 * safe to expose in a logging conversation (PRD §6, §7).
 */
import { EXTRACTION_VERSION, extractDerived, rulesetHash } from '../extract/index.ts';
import type { CaffeineStatus } from '../extract/caffeine.ts';
import type { Config } from '../config.ts';
import type { Store } from '../store/types.ts';

export interface ReextractSummary {
  transcripts: number;
  extractionVersion: string;
  rulesetHash: string;
  counts: Record<CaffeineStatus, number>;
  /** Records that were already at this version and hash before the run. */
  alreadyCurrent: number;
}

export async function reextractAll(
  store: Store,
  config: Config,
  now: Date = new Date(),
): Promise<ReextractSummary> {
  const hash = rulesetHash(config.presets);
  const [transcripts, existing] = await Promise.all([store.listAll(), store.listAllDerived()]);

  const before = new Map(existing.map((entry) => [entry.transcriptId, entry]));
  const counts: Record<CaffeineStatus, number> = { time: 0, none: 0, unclear: 0, unmentioned: 0 };
  let alreadyCurrent = 0;

  for (const transcript of transcripts) {
    const previous = before.get(transcript.id);
    if (previous?.extractionVersion === EXTRACTION_VERSION && previous.rulesetHash === hash) {
      alreadyCurrent += 1;
    }

    const derived = extractDerived(transcript, config.presets, now);
    counts[derived.caffeineStatus] = counts[derived.caffeineStatus] + 1;
    await store.putDerived(derived);
  }

  return {
    transcripts: transcripts.length,
    extractionVersion: EXTRACTION_VERSION,
    rulesetHash: hash,
    counts,
    alreadyCurrent,
  };
}

/** One line, same house style as the save confirmation (PRD §6). */
export function reextractLine(summary: ReextractSummary): string {
  const { counts } = summary;
  return (
    `Re-extracted ${summary.transcripts} transcript(s) at ${summary.extractionVersion} ` +
    `(${summary.rulesetHash}) — ${counts.time} with a caffeine time, ${counts.none} with none, ` +
    `${counts.unclear} unclear, ${counts.unmentioned} not mentioned.`
  );
}
