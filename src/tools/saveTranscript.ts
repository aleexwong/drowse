import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { todayIn, type Config } from '../config.ts';
import type { Transcript, TranscriptStore } from '../store/types.ts';

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
 * One line, no commentary (PRD §6). Layer 0 confirms the mood and nothing else —
 * no comparison to previous days, no reflection, no follow-up question.
 */
export function confirmationLine(transcript: Transcript): string {
  return transcript.statedMood === null
    ? 'Saved — no mood stated.'
    : `Saved — mood ${transcript.statedMood}.`;
}

export async function saveTranscript(
  input: SaveTranscriptInput,
  store: TranscriptStore,
  config: Config,
): Promise<{ transcript: Transcript; confirmation: string }> {
  const transcript = buildTranscript(input, config);
  await store.append(transcript);
  return { transcript, confirmation: confirmationLine(transcript) };
}
