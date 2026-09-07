import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import type { Config } from '../src/config.ts';
import { todayIn } from '../src/config.ts';
import { MemoryStore } from '../src/store/memory.ts';
import {
  buildTranscript,
  confirmationLine,
  saveTranscript,
  saveTranscriptSchema,
} from '../src/tools/saveTranscript.ts';

const config: Config = {
  port: 0,
  token: 'x'.repeat(32),
  timezone: 'America/Vancouver',
  defaultPhase: 'baseline',
  store: 'memory',
  collection: 'transcripts',
  derivedCollection: 'derived',
  projectId: undefined,
  databaseId: undefined,
};

describe('todayIn', () => {
  test('uses the configured zone, not UTC', () => {
    // 05:30 UTC on the 8th is still 22:30 on the 7th in Vancouver (UTC-7).
    const instant = new Date('2026-09-08T05:30:00Z');
    assert.equal(todayIn('America/Vancouver', instant), '2026-09-07');
    assert.equal(todayIn('UTC', instant), '2026-09-08');
  });
});

describe('buildTranscript', () => {
  const now = new Date('2026-09-07T15:02:00Z');

  test('fills defaults for a plain morning entry', () => {
    const t = buildTranscript({ text: 'Slept badly. Mood 3.', statedMood: 3 }, config, now, 'id-1');
    assert.deepEqual(t, {
      id: 'id-1',
      date: '2026-09-07',
      text: 'Slept badly. Mood 3.',
      capturedAt: '2026-09-07T15:02:00.000Z',
      captureMethod: 'voice',
      statedMood: 3,
      phase: 'baseline',
    });
  });

  test('keeps an unstated mood as null, not 0', () => {
    const t = buildTranscript({ text: 'Just rambling.' }, config, now, 'id-2');
    assert.equal(t.statedMood, null);
    assert.notEqual(t.statedMood, 0);
  });

  test('honours an explicit date for backfill', () => {
    const t = buildTranscript(
      { text: 'Backfilled.', date: '2026-09-01', captureMethod: 'form' },
      config,
      now,
      'id-3',
    );
    assert.equal(t.date, '2026-09-01');
    assert.equal(t.captureMethod, 'form');
  });

  test('stores the transcript verbatim', () => {
    const text = '  Bed 11:40, up 7:15.\n\nLast coffee 2pm.  ';
    const parsed = saveTranscriptSchema.parse({ text });
    const t = buildTranscript(parsed, config, now, 'id-4');
    // Only surrounding whitespace is trimmed; the words are untouched.
    assert.equal(t.text, 'Bed 11:40, up 7:15.\n\nLast coffee 2pm.');
  });
});

describe('saveTranscriptSchema', () => {
  test('rejects an empty transcript', () => {
    assert.equal(saveTranscriptSchema.safeParse({ text: '   ' }).success, false);
  });

  test('rejects a mood outside 1-5', () => {
    assert.equal(saveTranscriptSchema.safeParse({ text: 'hi', statedMood: 6 }).success, false);
    assert.equal(saveTranscriptSchema.safeParse({ text: 'hi', statedMood: 0 }).success, false);
    assert.equal(saveTranscriptSchema.safeParse({ text: 'hi', statedMood: 3.5 }).success, false);
  });

  test('accepts an explicit null mood', () => {
    assert.equal(saveTranscriptSchema.safeParse({ text: 'hi', statedMood: null }).success, true);
  });

  test('rejects a malformed date', () => {
    assert.equal(saveTranscriptSchema.safeParse({ text: 'hi', date: '7 Sep' }).success, false);
  });
});

describe('confirmationLine', () => {
  test('is one line and mentions only the mood', () => {
    const t = buildTranscript({ text: 'a', statedMood: 3 }, config);
    assert.equal(confirmationLine(t), 'Saved — mood 3.');
    assert.equal(confirmationLine({ ...t, statedMood: null }), 'Saved — no mood stated.');
  });
});

describe('store is append-only', () => {
  test('a duplicate id is rejected, never overwritten', async () => {
    const store = new MemoryStore();
    const first = buildTranscript({ text: 'original' }, config, new Date(), 'dup');
    const second = buildTranscript({ text: 'overwrite attempt' }, config, new Date(), 'dup');

    await store.append(first);
    await assert.rejects(() => store.append(second), /append-only/);

    const all = await store.listAll();
    assert.equal(all.length, 1);
    assert.equal(all[0]?.text, 'original');
  });

  test('two entries on the same day both survive', async () => {
    const store = new MemoryStore();
    await saveTranscript({ text: 'first pass', statedMood: 3 }, store, config);
    await saveTranscript({ text: 'forgot to mention the run', statedMood: 3 }, store, config);
    assert.equal((await store.listAll()).length, 2);
  });
});
