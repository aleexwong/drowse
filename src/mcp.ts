import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from './config.ts';
import type { TranscriptStore } from './store/types.ts';
import { saveTranscript, saveTranscriptShape } from './tools/saveTranscript.ts';

export const SERVER_NAME = 'drowse';
export const SERVER_VERSION = '0.1.0';

/**
 * Layer 0 exposes exactly one tool. `extract_entry`, `reextract_all` and
 * `query_entries` are later layers and are deliberately absent — a logging
 * conversation must not be able to read history (PRD §6, §7).
 */
export function createMcpServer(store: TranscriptStore, config: Config): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Drowse is a voice journal. Call save_transcript once per morning entry with the ' +
        'full transcript and the mood number the user said out loud. Then reply with the ' +
        'tool\'s confirmation line and stop. Do not comment on the entry, compare it to ' +
        'previous days, reflect anything back, or ask a follow-up question.',
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
      const { transcript, confirmation } = await saveTranscript(input, store, config);
      console.log(
        JSON.stringify({
          event: 'transcript.saved',
          id: transcript.id,
          date: transcript.date,
          statedMood: transcript.statedMood,
          captureMethod: transcript.captureMethod,
          phase: transcript.phase,
          textLength: transcript.text.length,
        }),
      );
      return { content: [{ type: 'text', text: confirmation }] };
    },
  );

  return server;
}
