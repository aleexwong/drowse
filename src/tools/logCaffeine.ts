/**
 * `log_caffeine` — the preset path.
 *
 * Talking is the main way in, but it should not be the *only* way in. A drink is
 * a preset id and a clock time; typing those two things should not require
 * saying a well-formed English sentence and hoping the parser agrees.
 *
 * What this does not do is write a number straight into the derived collection.
 * The preset expands into an ordinary transcript sentence, which the ordinary
 * extractor then reads. So a quick log is a real corpus entry — re-extractable,
 * improvable, exportable — rather than a value smuggled past the transcript
 * (PRD §2.1). It is the form fallback the PRD already allows (PRD §5).
 */
import { z } from 'zod';
import type { Config } from '../config.ts';
import { QuickLogError, expandPreset } from '../extract/index.ts';
import type { DerivedEntry, Store, Transcript } from '../store/types.ts';
import { saveTranscript } from './saveTranscript.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const logCaffeineShape = {
  preset: z
    .string()
    .trim()
    .min(1)
    .describe('Preset id, e.g. "flat-white" or "cold-brew". Call list_presets to see them all.'),
  at: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'at must be HH:MM in 24-hour form')
    .describe('The time it was drunk, HH:MM, 24-hour. Required — this tool exists to record a time.'),
  count: z.number().int().min(1).max(20).optional().describe('How many. Defaults to 1.'),
  date: z
    .string()
    .regex(ISO_DATE, 'date must be YYYY-MM-DD')
    .optional()
    .describe('The day it was drunk, YYYY-MM-DD. Omit for today.'),
};

export const logCaffeineSchema = z.object(logCaffeineShape);
export type LogCaffeineInput = z.infer<typeof logCaffeineSchema>;

export { QuickLogError };

export async function logCaffeine(
  input: LogCaffeineInput,
  store: Store,
  config: Config,
): Promise<{ transcript: Transcript; derived: DerivedEntry | null; confirmation: string }> {
  const { text } = expandPreset(config.presets, input.preset, input.at, input.count ?? 1);

  // `form`, not `voice` — a quick log is a different capture method, and the
  // difference has to stay visible so it cannot be mistaken for an intervention
  // effect later (PRD §9, bias controls).
  return saveTranscript(
    {
      text,
      statedMood: null,
      captureMethod: 'form',
      ...(input.date ? { date: input.date } : {}),
    },
    store,
    config,
  );
}

/** The catalogue, as a table. Contains no entries and no history — just the config. */
export function presetTable(config: Config): string {
  const rows = config.presets.map((p) => {
    const dose = p.decaf ? 'decaf' : p.mg === 0 ? 'dose unknown' : `${p.mg}mg`;
    return `${p.id.padEnd(16)} ${dose.padEnd(13)} ${p.label}`;
  });
  return [`${config.presets.length} presets:`, ...rows].join('\n');
}
