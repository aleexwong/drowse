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
