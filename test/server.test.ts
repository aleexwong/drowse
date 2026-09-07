import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test, { after, before, describe } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Config } from '../src/config.ts';
import { createApp } from '../src/http.ts';
import { DEFAULT_PRESETS } from '../src/extract/index.ts';
import { MemoryStore } from '../src/store/memory.ts';

const TOKEN = 'test-token-'.padEnd(40, 'z');

const config: Config = {
  port: 0,
  token: TOKEN,
  timezone: 'America/Vancouver',
  defaultPhase: 'baseline',
  store: 'memory',
  collection: 'transcripts',
  derivedCollection: 'derived',
  presets: DEFAULT_PRESETS,
  projectId: undefined,
  databaseId: undefined,
};

const store = new MemoryStore();
let baseUrl: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

before(async () => {
  server = createApp(store, config).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function connect(url: string) {
  const client = new Client({ name: 'drowse-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

describe('auth', () => {
  test('health check needs no token', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  test('MCP without a token is 401', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  });

  test('MCP with the wrong token is 401', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer nope' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  });

  test('a wrong token in the path is 401', async () => {
    const res = await fetch(`${baseUrl}/mcp/not-the-token`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 401);
  });

  test('export needs a token', async () => {
    assert.equal((await fetch(`${baseUrl}/export.json`)).status, 401);
  });
});

describe('MCP surface', () => {
  test('every tool is a write or a config read — none can see history', async () => {
    const client = await connect(`${baseUrl}/mcp/${TOKEN}`);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['list_presets', 'log_caffeine', 'reextract_all', 'save_transcript'],
    );
    // Still no read path — a logging conversation cannot see history. Layer 2
    // added extraction, not access: reextract_all returns counts only.
    assert.equal(
      tools.some((t) => t.name === 'query_entries'),
      false,
    );
    await client.close();
  });

  test('save_transcript returns one confirmation line and no history', async () => {
    const client = await connect(`${baseUrl}/mcp/${TOKEN}`);
    const result = await client.callTool({
      name: 'save_transcript',
      arguments: {
        text: 'Slept badly, bed around 11:40, up at 7:15. Last coffee 2pm yesterday. Mood 3.',
        statedMood: 3,
        date: '2026-09-07',
      },
    });

    const content = result.content as { type: string; text: string }[];
    assert.equal(content.length, 1);
    assert.equal(content[0]?.text, 'Saved — caffeine 14:00 (95mg), mood 3.');
    assert.equal(content[0]?.text.includes('\n'), false);
    await client.close();
  });

  test('reextract_all returns counts and no entries', async () => {
    const client = await connect(`${baseUrl}/mcp/${TOKEN}`);
    const result = await client.callTool({ name: 'reextract_all', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    const line = content[0]?.text ?? '';

    assert.match(line, /^Re-extracted \d+ transcript\(s\) at caffeine-2\.0\.0/);
    assert.match(line, /1 with a caffeine time/);
    // The summary must not leak a transcript, a date, or a single day's value.
    assert.equal(/bed around 11:40|2026-09-07|14:00/.test(line), false);
    await client.close();
  });

  test('log_caffeine records a drink with no transcript and no model', async () => {
    const client = await connect(`${baseUrl}/mcp/${TOKEN}`);
    const result = await client.callTool({
      name: 'log_caffeine',
      arguments: { preset: 'flat-white', at: '14:00', date: '2026-09-08' },
    });
    const content = result.content as { type: string; text: string }[];
    assert.equal(content[0]?.text, 'Saved — caffeine 14:00 (130mg), no mood stated.');
    await client.close();
  });

  test('log_caffeine refuses an invented preset id', async () => {
    const client = await connect(`${baseUrl}/mcp/${TOKEN}`);
    const result = await client.callTool({
      name: 'log_caffeine',
      arguments: { preset: 'oat-milk-thing', at: '14:00' },
    });
    assert.equal(result.isError, true);
    const content = result.content as { type: string; text: string }[];
    assert.match(content[0]?.text ?? '', /Unknown preset/);
    await client.close();
  });

  test('list_presets returns the catalogue and no entries', async () => {
    const client = await connect(`${baseUrl}/mcp/${TOKEN}`);
    const result = await client.callTool({ name: 'list_presets', arguments: {} });
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    assert.match(text, /flat-white\s+130mg/);
    assert.equal(/2026-09-0\d/.test(text), false);
    await client.close();
  });

  test('a bad mood is rejected before anything is stored', async () => {
    const client = await connect(`${baseUrl}/mcp/${TOKEN}`);
    const result = await client.callTool({
      name: 'save_transcript',
      arguments: { text: 'Mood nine.', statedMood: 9 },
    });
    assert.equal(result.isError, true);
    await client.close();
  });
});

describe('the HTTP quick-log path — no MCP client, no model', () => {
  test('POST /caffeine stores a drink and returns the dose', async () => {
    const res = await fetch(`${baseUrl}/caffeine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ preset: 'cold-brew', at: '09:30', date: '2026-09-09' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.lastCaffeine, '09:30');
    assert.equal(body.caffeineMg, 200);
  });

  test('POST /caffeine needs a token', async () => {
    const res = await fetch(`${baseUrl}/caffeine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'coffee', at: '09:30' }),
    });
    assert.equal(res.status, 401);
  });

  test('a bad time is a 400, not a stored guess', async () => {
    const res = await fetch(`${baseUrl}/caffeine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ preset: 'coffee', at: '2pm' }),
    });
    assert.equal(res.status, 400);
  });

  test('GET /presets lists the catalogue', async () => {
    const res = await fetch(`${baseUrl}/presets`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.count >= 20);
    assert.ok(body.presets.some((p: { id: string; mg: number }) => p.id === 'flat-white' && p.mg === 130));
  });
});

describe('export', () => {
  test('produces valid JSON including full transcripts', async () => {
    const res = await fetch(`${baseUrl}/export.json`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);

    const body = JSON.parse(await res.text());
    assert.equal(body.schema, 'drowse.transcripts.v1');
    assert.equal(body.count, body.transcripts.length);
    assert.ok(body.count >= 1);

    const entry = body.transcripts.find((t: { date: string }) => t.date === '2026-09-07');
    assert.ok(entry, 'the saved entry is in the export');
    assert.match(entry.text, /bed around 11:40/);
    assert.equal(entry.statedMood, 3);
    assert.equal(entry.captureMethod, 'voice');
    assert.equal(entry.phase, 'baseline');
    assert.ok(Date.parse(entry.capturedAt));

    // Derived rows ride along, keyed back to the transcript they came from.
    const derived = body.derived.find(
      (d: { transcriptId: string }) => d.transcriptId === entry.id,
    );
    assert.ok(derived, 'the derived record is in the export');
    assert.equal(derived.lastCaffeine, '14:00');
    assert.equal(derived.caffeineStatus, 'time');
    assert.equal(derived.caffeineMg, 95);
    assert.deepEqual(derived.caffeineEvents, [
      { presetId: 'coffee', label: 'Coffee', count: 1, mg: 95, time: '14:00' },
    ]);
    assert.equal(derived.extractionVersion, 'caffeine-2.0.0');
    assert.ok(derived.rulesetHash);
  });

  test('the path-token form works too', async () => {
    const res = await fetch(`${baseUrl}/export/${TOKEN}`);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(await res.text()).schema, 'drowse.transcripts.v1');
  });
});
