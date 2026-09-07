import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.ts';
import { EXTRACTION_VERSION } from './extract/index.ts';
import type { Store } from './store/types.ts';
import { reextractAll, reextractLine } from './tools/reextractAll.ts';
import { saveTranscript, saveTranscriptShape } from './tools/saveTranscript.ts';

export const SERVER_NAME = 'drowse';
export const SERVER_VERSION = '0.1.0';

/**
 * Two tools. `query_entries` is Layer 3 and is deliberately absent — a logging
 * conversation must not be able to read history (PRD §6, §7).
 *
 * There is no `extract_entry` either. Extraction is deterministic and runs
 * inside `save_transcript`, so a per-entry extraction tool would only add a way
 * to point extraction at a day other than the one just spoken. `reextract_all`
 * covers the retroactive case and returns counts, never entries.
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
      const summary = await reextractAll(store);
      console.log(JSON.stringify({ event: 'derived.reextracted', ...summary }));
      return { content: [{ type: 'text', text: reextractLine(summary) }] };
    },
  );

  return server;
}
