import type { CaffeineStatus } from '../extract/caffeine.ts';

export type CaptureMethod = 'voice' | 'form';
export type Phase = 'baseline' | 'intervention' | 'washout';

/**
 * A transcript is the source of truth (PRD §2.1). It is written once and never
 * edited. Everything else in Drowse is derived from it and regenerable.
 */
export interface Transcript {
  id: string;
  /** Calendar date the entry is about, YYYY-MM-DD. */
  date: string;
  /** Full transcript text, exactly as spoken. Never edited. */
  text: string;
  /** ISO-8601 instant the entry reached the server. */
  capturedAt: string;
  captureMethod: CaptureMethod;
  /** 1–5, stated by the user. Never inferred by a model (PRD §4.2). */
  statedMood: number | null;
  phase: Phase;
}

export interface TranscriptStore {
  /**
   * Append one transcript. Must reject a duplicate id rather than overwrite —
   * the collection is append-only.
   *
   * Deliberately has no read path: save_transcript must not see history (PRD §6).
   */
  append(transcript: Transcript): Promise<void>;

  /** Read every transcript, oldest first. Used by export only, never by a tool. */
  listAll(): Promise<Transcript[]>;

  close(): Promise<void>;
}

/**
 * A derived record is regenerable (PRD §2.1, §4.1). It is keyed by
 * `transcriptId`, one per transcript, and re-extraction overwrites it — the
 * opposite of the transcripts collection, which is append-only.
 *
 * Layer 2 fills in caffeine only. `bedtime`, `wakeTime`, `sleepDuration` and
 * `isWeekend` are Layer 1 and are deliberately absent rather than stored as
 * placeholder nulls: an absent field cannot be mistaken for "not mentioned".
 */
export interface DerivedEntry {
  transcriptId: string;
  /** Copied from the transcript so derived rows sort and join without a lookup. */
  date: string;
  /** Strict HH:MM (24-hour), or null. */
  lastCaffeine: string | null;
  caffeineStatus: CaffeineStatus;
  extractionVersion: string;
  /** PRD calls this `promptHash`; the extractor is rules, not a prompt. */
  rulesetHash: string;
  extractedAt: string;
}

export interface DerivedStore {
  /**
   * Write one derived record, overwriting any earlier one for the same
   * transcript. Overwriting is correct here and wrong for transcripts: a
   * derived value is a claim about a transcript, and the newest extractor
   * makes the best claim.
   */
  putDerived(entry: DerivedEntry): Promise<void>;

  /** Every derived record, oldest first. Export and re-extraction only. */
  listAllDerived(): Promise<DerivedEntry[]>;
}

/** Everything the server can talk to. */
export interface Store extends TranscriptStore, DerivedStore {}
