import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { todayIn, type Config } from '../config.ts';
import { caffeineSummary, extractDerived } from '../extract/index.ts';
import type { DerivedEntry, Store, Transcript } from '../store/types.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const saveTranscriptShape = {
  text: z
    .string()
    .trim()
    .min(1, 'The transcript cannot be empty.')
    .max(50_000)
    .describe('The full transcript, word for word. Do not summarise, tidy, or shorten it.'),
  statedMood: z
    .number()
    .int()
    .min(1)
    .max(5)
    .nullable()
    .optional()
    .describe(
      'The mood number the user said out loud, 1-5. Never infer or estimate this. ' +
        'If they did not say a number, ask once; if they still do not give one, pass null.',
    ),
  date: z
    .string()
    .regex(ISO_DATE, 'date must be YYYY-MM-DD')
    .optional()
    .describe('The day the entry is about, YYYY-MM-DD. Omit for today. Set it only for backfill.'),
  captureMethod: z
    .enum(['voice', 'form'])
    .optional()
    .describe('How the entry was captured. "voice" unless the user typed it.'),
  phase: z
    .enum(['baseline', 'intervention', 'washout'])
    .optional()
    .describe('Experiment phase. Omit unless the user says the phase has changed.'),
};

export const saveTranscriptSchema = z.object(saveTranscriptShape);
export type SaveTranscriptInput = z.infer<typeof saveTranscriptSchema>;

/** Pure: turns validated input into the record that gets stored. */
export function buildTranscript(
  input: SaveTranscriptInput,
  config: Config,
  now: Date = new Date(),
  id: string = randomUUID(),
): Transcript {
  return {
    id,
    date: input.date ?? todayIn(config.timezone, now),
    text: input.text,
    capturedAt: now.toISOString(),
    captureMethod: input.captureMethod ?? 'voice',
    // `?? null` keeps "not mentioned" distinct from a value. Never collapse
    // null into 0 or false (PRD §4.1).
    statedMood: input.statedMood ?? null,
    phase: input.phase ?? config.defaultPhase,
  };
}

/**
 * One line, no commentary (PRD §6): the values just extracted from *this* entry
 * and nothing else. No comparison to previous days, no reflection, no follow-up
 * question. Everything on the line came out of the transcript that was just
 * spoken, so it reveals no history.
 */
export function confirmationLine(transcript: Transcript, derived?: DerivedEntry | null): string {
  const parts: string[] = [];

  const caffeine = derived ? caffeineSummary(derived) : null;
  if (caffeine) parts.push(caffeine);

  parts.push(transcript.statedMood === null ? 'no mood stated' : `mood ${transcript.statedMood}`);
  return `Saved — ${parts.join(', ')}.`;
}

export async function saveTranscript(
  input: SaveTranscriptInput,
  store: Store,
  config: Config,
): Promise<{ transcript: Transcript; derived: DerivedEntry | null; confirmation: string }> {
  const transcript = buildTranscript(input, config);
  await store.append(transcript);

  // Extraction runs after the append and never before it. The transcript is the
  // source of truth (PRD §2.1) — a broken extractor must not be able to lose an
  // entry, so a failure here is logged and the save still stands.
  let derived: DerivedEntry | null = null;
  try {
    derived = extractDerived(transcript);
    await store.putDerived(derived);
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'extract.failed', id: transcript.id, message: String(error) }),
    );
    derived = null;
  }

  return { transcript, derived, confirmation: confirmationLine(transcript, derived) };
}
