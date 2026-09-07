import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.ts';
import { EXTRACTION_VERSION } from './extract/index.ts';
import type { Store } from './store/types.ts';
import { QuickLogError, logCaffeine, logCaffeineShape, presetTable } from './tools/logCaffeine.ts';
import { reextractAll, reextractLine } from './tools/reextractAll.ts';
import { saveTranscript, saveTranscriptShape } from './tools/saveTranscript.ts';

export const SERVER_NAME = 'drowse';
export const SERVER_VERSION = '0.1.0';

/**
 * Four tools, none of which can read history. `query_entries` is Layer 3 and is
 * deliberately absent (PRD §6, §7).
 *
 * `save_transcript` is the main path; `log_caffeine` is the preset path for when
 * you do not want to talk; `list_presets` shows the catalogue; `reextract_all`
 * is maintenance and returns counts.
 *
 * There is no `extract_entry`. Extraction is deterministic and runs inside the
 * two write tools, so a per-entry extraction tool would only add a way to point
 * extraction at a day other than the one just logged.
 */
export function createMcpServer(store: Store, config: Config): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Drowse is a voice journal. Call save_transcript once per morning entry with the ' +
        'full transcript and the mood number the user said out loud. Then reply with the ' +
        'tool\'s confirmation line and stop. Do not comment on the entry, compare it to ' +
        'previous days, reflect anything back, or ask a follow-up question. Never call ' +
        'reextract_all during a logging conversation — it is a maintenance operation the ' +
        'user asks for explicitly.',
    },
  );

  server.registerTool(
    'save_transcript',
    {
      title: 'Save morning transcript',
      description:
        'Store one morning voice-journal entry: the full transcript plus the mood number ' +
        'the user stated. Returns a confirmation line only — it never returns history, and ' +
        'there is no way to read past entries from this server. Pass the transcript verbatim; ' +
        'never infer the mood.',
      inputSchema: saveTranscriptShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const { transcript, derived, confirmation } = await saveTranscript(input, store, config);
      console.log(
        JSON.stringify({
          event: 'transcript.saved',
          id: transcript.id,
          date: transcript.date,
          statedMood: transcript.statedMood,
          captureMethod: transcript.captureMethod,
          phase: transcript.phase,
          textLength: transcript.text.length,
          lastCaffeine: derived?.lastCaffeine ?? null,
          caffeineStatus: derived?.caffeineStatus ?? null,
        }),
      );
      return { content: [{ type: 'text', text: confirmation }] };
    },
  );

  server.registerTool(
    'log_caffeine',
    {
      title: 'Log a drink from a preset',
      description:
        'Record one caffeinated drink by preset id and clock time, without a transcript. Use ' +
        'this when the user names a drink and a time directly ("flat white at 2pm") instead of ' +
        'talking through their morning. It stores a plain sentence as a form-captured ' +
        'transcript and returns a confirmation line only. Call list_presets first if you do ' +
        'not know the preset id — never invent one.',
      inputSchema: logCaffeineShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const { transcript, derived, confirmation } = await logCaffeine(input, store, config);
        console.log(
          JSON.stringify({
            event: 'caffeine.logged',
            id: transcript.id,
            date: transcript.date,
            preset: input.preset,
            at: input.at,
            count: input.count ?? 1,
            caffeineMg: derived?.caffeineMg ?? null,
          }),
        );
        return { content: [{ type: 'text', text: confirmation }] };
      } catch (error) {
        if (error instanceof QuickLogError) {
          return { isError: true, content: [{ type: 'text', text: error.message }] };
        }
        throw error;
      }
    },
  );

  server.registerTool(
    'list_presets',
    {
      title: 'List drink presets',
      description:
        'Show every configured drink preset with its id and typical caffeine content. Reads ' +
        'configuration only — it returns no entries, no dates and no history, so it is safe ' +
        'to call at any time.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({ content: [{ type: 'text', text: presetTable(config) }] }),
  );

  server.registerTool(
    'reextract_all',
    {
      title: 'Re-extract every transcript',
      description:
        'Maintenance only. Re-runs the current extractor over the whole corpus and rewrites ' +
        `the derived records at extraction version ${EXTRACTION_VERSION}. Returns counts only — ` +
        'it never returns transcripts, dates, or any single day\'s values, so it cannot be ' +
        'used to read history. Do not call it during a logging conversation; only when the ' +
        'user explicitly asks to re-extract.',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const summary = await reextractAll(store, config);
      console.log(JSON.stringify({ event: 'derived.reextracted', ...summary }));
      return { content: [{ type: 'text', text: reextractLine(summary) }] };
    },
  );

  return server;
}
