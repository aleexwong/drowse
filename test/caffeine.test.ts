import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  EXTRACTION_VERSION,
  RULESET_HASH,
  extractCaffeine,
  extractDerived,
} from '../src/extract/index.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { reextractAll, reextractLine } from '../src/tools/reextractAll.ts';
import type { Transcript } from '../src/store/types.ts';

const transcript = (id: string, text: string, date = '2026-09-07'): Transcript => ({
  id,
  date,
  text,
  capturedAt: '2026-09-07T15:02:00.000Z',
  captureMethod: 'voice',
  statedMood: 3,
  phase: 'baseline',
});

describe('extractCaffeine — a time was stated', () => {
  const cases: [string, string][] = [
    ['Last coffee was 2pm yesterday.', '14:00'],
    ['Slept badly, bed around 11:40, up at 7:15. Last coffee 2pm yesterday. Mood 3.', '14:00'],
    ['Last espresso 14:30.', '14:30'],
    ['Coffee at 2:15 p.m.', '14:15'],
    ['Last coffee 2.45pm.', '14:45'],
    ['Had a flat white at 9am.', '09:00'],
    ['Last caffeine was noon.', '12:00'],
    ['Cold brew at midday, nothing after.', '12:00'],
    ['Matcha at 4pm.', '16:00'],
    ['2pm was my last coffee.', '14:00'],
    ['Last coke at 8:05pm.', '20:05'],
    ['Coffee at 12am, which was a mistake.', '00:00'],
  ];

  for (const [text, expected] of cases) {
    test(JSON.stringify(text), () => {
      assert.deepEqual(extractCaffeine(text), {
        lastCaffeine: expected,
        caffeineStatus: 'time',
      });
    });
  }

  test('the latest stated time wins — the field is *last* caffeine', () => {
    const t = extractCaffeine('Coffee at 8am and then a coffee at 1:15pm.');
    assert.equal(t.lastCaffeine, '13:15');
  });

  test('a bedtime in the same sentence is not read as a coffee', () => {
    // The nearest-time rule has to beat the latest-time rule here.
    const t = extractCaffeine('Coffee at 2pm, bed at 11:40pm.');
    assert.equal(t.lastCaffeine, '14:00');
  });

  test('a time in the next sentence does not attach', () => {
    const t = extractCaffeine('Last coffee 2pm. Woke up at 7:15.');
    assert.equal(t.lastCaffeine, '14:00');
  });
});

describe('extractCaffeine — none, unclear, unmentioned stay distinct', () => {
  test('explicitly none is "none", not null-as-in-unknown', () => {
    assert.deepEqual(extractCaffeine('No coffee at all yesterday.'), {
      lastCaffeine: null,
      caffeineStatus: 'none',
    });
    assert.equal(extractCaffeine("Didn't have any coffee.").caffeineStatus, 'none');
    assert.equal(extractCaffeine('Skipped the espresso entirely.').caffeineStatus, 'none');
  });

  test('mentioned without a usable time is "unclear"', () => {
    assert.deepEqual(extractCaffeine('Coffee sometime in the afternoon.'), {
      lastCaffeine: null,
      caffeineStatus: 'unclear',
    });
    // A bare number is not a time: "coffee at 3" could be either end of the day.
    assert.equal(extractCaffeine('Coffee at 3.').caffeineStatus, 'unclear');
  });

  test('a plural still counts', () => {
    assert.equal(extractCaffeine('Two coffees, last one at 11am.').lastCaffeine, '11:00');
  });

  test('a boundary word is not a cup', () => {
    // "Coffees before 10am" names a limit; the last cup was some other time.
    assert.equal(extractCaffeine('Two coffees before 10am.').caffeineStatus, 'unclear');
    assert.equal(extractCaffeine('Nothing caffeinated past 3pm.').caffeineStatus, 'unclear');
  });

  test('a cutoff is not a cup', () => {
    // "No coffee after 2pm" means the last one was earlier, not at 14:00.
    assert.deepEqual(extractCaffeine('No coffee after 2pm.'), {
      lastCaffeine: null,
      caffeineStatus: 'unclear',
    });
  });

  test('never mentioned is "unmentioned"', () => {
    assert.deepEqual(extractCaffeine('Slept fine, bed at 11, up at 7. Mood 4.'), {
      lastCaffeine: null,
      caffeineStatus: 'unmentioned',
    });
  });

  test('decaf and herbal tea are not caffeine', () => {
    assert.equal(extractCaffeine('Decaf latte at 8pm.').caffeineStatus, 'unmentioned');
    assert.equal(extractCaffeine('Peppermint tea at 9pm.').caffeineStatus, 'unmentioned');
    // ...but a real coffee in the same entry still counts.
    assert.equal(extractCaffeine('Coffee at 2pm, decaf at 8pm.').lastCaffeine, '14:00');
  });

  test('an impossible time is refused, not clamped', () => {
    assert.equal(extractCaffeine('Coffee at 25:99.').caffeineStatus, 'unclear');
    assert.equal(extractCaffeine('Coffee at 14:73.').caffeineStatus, 'unclear');
  });

  test('numbers that are not times are ignored', () => {
    assert.equal(extractCaffeine('Coffee. Slept 7.5 hours. Mood 3.').caffeineStatus, 'unclear');
    assert.equal(extractCaffeine('Coffee on 2026-09-07.').caffeineStatus, 'unclear');
  });
});

describe('extraction is deterministic and versioned', () => {
  test('the same text always gives the same value', () => {
    const text = 'Last coffee 2pm.';
    assert.deepEqual(extractCaffeine(text), extractCaffeine(text));
  });

  test('every derived record carries the version and ruleset hash', () => {
    const d = extractDerived(transcript('t1', 'Last coffee 2pm.'), new Date('2026-09-07T16:00:00Z'));
    assert.deepEqual(d, {
      transcriptId: 't1',
      date: '2026-09-07',
      lastCaffeine: '14:00',
      caffeineStatus: 'time',
      extractionVersion: EXTRACTION_VERSION,
      rulesetHash: RULESET_HASH,
      extractedAt: '2026-09-07T16:00:00.000Z',
    });
  });

  test('the derived record never carries the mood or the text', () => {
    const d = extractDerived(transcript('t2', 'Coffee 2pm. Mood 3.'));
    assert.equal('statedMood' in d, false);
    assert.equal('text' in d, false);
  });
});

describe('reextract_all', () => {
  test('rewrites every derived record and reports counts only', async () => {
    const store = new MemoryStore();
    await store.append(transcript('a', 'Last coffee 2pm.', '2026-09-01'));
    await store.append(transcript('b', 'No coffee yesterday.', '2026-09-02'));
    await store.append(transcript('c', 'Coffee in the afternoon.', '2026-09-03'));
    await store.append(transcript('d', 'Slept fine. Mood 4.', '2026-09-04'));

    const summary = await reextractAll(store);
    assert.equal(summary.transcripts, 4);
    assert.equal(summary.alreadyCurrent, 0);
    assert.deepEqual(summary.counts, { time: 1, none: 1, unclear: 1, unmentioned: 1 });

    const derived = await store.listAllDerived();
    assert.equal(derived.length, 4);
    assert.equal(derived[0]?.lastCaffeine, '14:00');

    const line = reextractLine(summary);
    assert.equal(line.includes('\n'), false);
    assert.equal(/coffee at|2026-09-01|14:00/.test(line), false);
  });

  test('re-running is idempotent and overwrites rather than duplicating', async () => {
    const store = new MemoryStore();
    await store.append(transcript('a', 'Last coffee 2pm.'));

    await reextractAll(store);
    const second = await reextractAll(store);

    assert.equal(second.alreadyCurrent, 1);
    assert.equal((await store.listAllDerived()).length, 1);
  });

  test('a stale derived record is replaced, and the transcript is untouched', async () => {
    const store = new MemoryStore();
    await store.append(transcript('a', 'Last coffee 2pm.'));
    await store.putDerived({
      transcriptId: 'a',
      date: '2026-09-07',
      lastCaffeine: '09:00',
      caffeineStatus: 'time',
      extractionVersion: 'caffeine-0.0.1',
      rulesetHash: 'stale',
      extractedAt: '2026-01-01T00:00:00.000Z',
    });

    await reextractAll(store);
    const derived = await store.listAllDerived();
    assert.equal(derived[0]?.lastCaffeine, '14:00');
    assert.equal(derived[0]?.extractionVersion, EXTRACTION_VERSION);

    const all = await store.listAll();
    assert.equal(all[0]?.text, 'Last coffee 2pm.');
  });
});
