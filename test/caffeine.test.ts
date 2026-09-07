import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  DEFAULT_PRESETS,
  EXTRACTION_VERSION,
  PresetError,
  expandPreset,
  extractCaffeine,
  extractDerived,
  loadPresets,
  rulesetHash,
  validatePresets,
  type CaffeinePreset,
} from '../src/extract/index.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { reextractAll, reextractLine } from '../src/tools/reextractAll.ts';
import type { Config } from '../src/config.ts';
import type { Transcript } from '../src/store/types.ts';

const P = DEFAULT_PRESETS;
const parse = (text: string, presets = P) => extractCaffeine(text, presets);

const config: Config = {
  port: 0,
  token: 'x'.repeat(32),
  timezone: 'America/Vancouver',
  defaultPhase: 'baseline',
  store: 'memory',
  collection: 'transcripts',
  derivedCollection: 'derived',
  presets: P,
  projectId: undefined,
  databaseId: undefined,
};

const transcript = (id: string, text: string, date = '2026-09-07'): Transcript => ({
  id,
  date,
  text,
  capturedAt: '2026-09-07T15:02:00.000Z',
  captureMethod: 'voice',
  statedMood: 3,
  phase: 'baseline',
});

describe('the preset catalogue', () => {
  test('the defaults are valid', () => {
    assert.doesNotThrow(() => validatePresets(DEFAULT_PRESETS));
  });

  test('an alias claimed by two presets is refused, not resolved by array order', () => {
    const clashing: CaffeinePreset[] = [
      { id: 'a', label: 'A', mg: 10, aliases: ['brew'] },
      { id: 'b', label: 'B', mg: 20, aliases: ['brew'] },
    ];
    assert.throws(() => validatePresets(clashing), PresetError);
  });

  test('a preset with no aliases is refused — nothing could ever match it', () => {
    assert.throws(
      () => validatePresets([{ id: 'a', label: 'A', mg: 10, aliases: [] }]),
      PresetError,
    );
  });

  test('a duplicate id and a negative dose are refused', () => {
    assert.throws(
      () =>
        validatePresets([
          { id: 'a', label: 'A', mg: 10, aliases: ['x'] },
          { id: 'a', label: 'A2', mg: 10, aliases: ['y'] },
        ]),
      PresetError,
    );
    assert.throws(
      () => validatePresets([{ id: 'a', label: 'A', mg: -1, aliases: ['x'] }]),
      PresetError,
    );
  });

  test('your own file replaces the defaults outright', () => {
    const mine = loadPresets(JSON.stringify([{ id: 'mine', label: 'Mine', mg: 111, aliases: ['my usual'] }]));
    assert.equal(mine.length, 1);
    assert.equal(parse('My usual at 7am.', mine).totalMg, 111);
    // ...and the defaults are then genuinely gone.
    assert.equal(parse('Coffee at 7am.', mine).caffeineStatus, 'unmentioned');
  });

  test('"extends" adds to the defaults and overrides by id', () => {
    const merged = loadPresets(
      JSON.stringify({
        extends: 'default',
        presets: [
          { id: 'coffee', label: 'Coffee', mg: 140, aliases: ['coffee', 'my usual'] },
          { id: 'yerba', label: 'Yerba mate', mg: 85, aliases: ['yerba', 'mate'] },
        ],
      }),
    );
    // Overridden dose, not the 95mg default.
    assert.equal(parse('Coffee at 8am.', merged).totalMg, 140);
    assert.equal(parse('My usual at 8am.', merged).totalMg, 140);
    // Added preset works, and everything else survived.
    assert.equal(parse('Yerba at 8am.', merged).totalMg, 85);
    assert.equal(parse('Matcha at 8am.', merged).totalMg, 70);
  });

  test('a malformed file fails loudly rather than falling back', () => {
    assert.throws(() => loadPresets('not json'), PresetError);
    assert.throws(() => loadPresets('{"presets":"nope"}'), PresetError);
    assert.throws(() => loadPresets('{"extends":"other","presets":[]}'), PresetError);
  });
});

describe('every preset survives quick-log -> parse', () => {
  // The round trip that matters: if a preset can be logged but not read back,
  // the catalogue and the parser have drifted apart.
  for (const preset of DEFAULT_PRESETS) {
    test(`${preset.id} round-trips`, () => {
      const { text } = expandPreset(P, preset.id, '14:30');
      const result = parse(text);

      assert.equal(result.events.length, 1, `"${text}" produced ${result.events.length} events`);
      assert.equal(result.events[0]?.presetId, preset.id, `"${text}" matched the wrong preset`);
      assert.equal(result.events[0]?.count, 1);
      assert.equal(result.events[0]?.time, '14:30');
    });

    test(`${preset.id} round-trips with a count`, () => {
      const { text } = expandPreset(P, preset.id, '09:05', 3);
      const result = parse(text);
      assert.equal(result.events[0]?.presetId, preset.id, `"${text}" matched the wrong preset`);
      assert.equal(result.events[0]?.count, 3, `"${text}" lost the count`);
    });
  }

  test('a caffeinated preset round-trips its dose, times the count', () => {
    const { text } = expandPreset(P, 'flat-white', '14:00', 2);
    assert.equal(parse(text).totalMg, 260);
  });

  test('an unknown preset id is refused with the list of real ones', () => {
    assert.throws(() => expandPreset(P, 'oat-milk-thing', '14:00'), /Unknown preset/);
    assert.throws(() => expandPreset(P, 'coffee', '2pm'), /HH:MM/);
    assert.throws(() => expandPreset(P, 'coffee', '14:00', 0), /1 to 20/);
  });
});

describe('longest alias wins', () => {
  const cases: [string, string][] = [
    ['Green tea at 4pm.', 'green-tea'],
    ['Tea at 4pm.', 'black-tea'],
    ['Double espresso at 8am.', 'double-espresso'],
    ['Espresso at 8am.', 'espresso'],
    ['Instant coffee at 8am.', 'instant-coffee'],
    ['Coffee at 8am.', 'coffee'],
    ['Diet coke at 3pm.', 'diet-coke'],
    ['Coke at 3pm.', 'coke'],
    ['Matcha latte at 3pm.', 'matcha'],
    ['Latte at 3pm.', 'latte'],
  ];

  for (const [text, presetId] of cases) {
    test(text, () => {
      const result = parse(text);
      assert.equal(result.events.length, 1);
      assert.equal(result.events[0]?.presetId, presetId);
    });
  }
});

describe('dose', () => {
  test('adds up across drinks', () => {
    const result = parse('Coffee at 8am and a cold brew at 1pm.');
    assert.equal(result.totalMg, 295);
    assert.equal(result.lastCaffeine, '13:00');
    assert.equal(result.events.length, 2);
  });

  test('counts multiply', () => {
    assert.equal(parse('Two coffees at 8am.').totalMg, 190);
    assert.equal(parse('3 espressos at 8am.').totalMg, 189);
    assert.equal(parse('A couple of lattes at 8am.').totalMg, 126);
  });

  test('a decaf is scored as decaf and does not move the last time', () => {
    const result = parse('Coffee at 2pm, decaf latte at 8pm.');
    assert.equal(result.lastCaffeine, '14:00');
    assert.equal(result.events[1]?.presetId, 'decaf');
    assert.equal(result.events[1]?.label, 'Decaf latte');
    assert.equal(result.totalMg, 98); // 95 + 3, not 95 + 63
  });

  test('an unknown dose is null, never zero', () => {
    // "Caffeine at 2pm" says when, but nothing at all about how much.
    const result = parse('Caffeine at 2pm.');
    assert.equal(result.lastCaffeine, '14:00');
    assert.equal(result.totalMg, null);
    assert.equal(result.events[0]?.mg, null);
  });

  test('a known drink beside an unknown one still totals what it knows', () => {
    const result = parse('Caffeine at 8am. Coffee at 2pm.');
    assert.equal(result.totalMg, 95);
  });
});

describe('times', () => {
  const cases: [string, string][] = [
    ['Last coffee was 2pm yesterday.', '14:00'],
    ['Slept badly, bed around 11:40, up at 7:15. Last coffee 2pm yesterday. Mood 3.', '14:00'],
    ['Last espresso 14:30.', '14:30'],
    ['Coffee at 2:15 p.m.', '14:15'],
    ['Last coffee 2.45pm.', '14:45'],
    ['Last caffeine was noon.', '12:00'],
    ['Cold brew at midday, nothing after.', '12:00'],
    ['2pm was my last coffee.', '14:00'],
    ['Coffee at 12am, which was a mistake.', '00:00'],
  ];

  for (const [text, expected] of cases) {
    test(JSON.stringify(text), () => {
      assert.equal(parse(text).lastCaffeine, expected);
    });
  }

  test('a bedtime in the same sentence is not read as a coffee', () => {
    assert.equal(parse('Coffee at 2pm, bed at 11:40pm.').lastCaffeine, '14:00');
  });

  test('a time in the next sentence does not attach', () => {
    assert.equal(parse('Last coffee 2pm. Woke up at 7:15.').lastCaffeine, '14:00');
  });

  test('the latest stated time wins — the field is *last* caffeine', () => {
    assert.equal(parse('Coffee at 8am and then a coffee at 1:15pm.').lastCaffeine, '13:15');
  });
});

describe('none, unclear and unmentioned stay distinct', () => {
  test('explicitly none', () => {
    assert.equal(parse('No coffee at all yesterday.').caffeineStatus, 'none');
    assert.equal(parse("Didn't have any coffee.").caffeineStatus, 'none');
    assert.equal(parse('Skipped the espresso entirely.').caffeineStatus, 'none');
  });

  test('mentioned without a usable time', () => {
    assert.equal(parse('Coffee sometime in the afternoon.').caffeineStatus, 'unclear');
    // A bare number is not a time: "coffee at 3" could be either end of the day.
    assert.equal(parse('Coffee at 3.').caffeineStatus, 'unclear');
  });

  test('a cutoff is not a cup, and not an abstinent day either', () => {
    assert.deepEqual(parse('No coffee after 2pm.').caffeineStatus, 'unclear');
    assert.equal(parse('Two coffees before 10am.').caffeineStatus, 'unclear');
  });

  test('never mentioned', () => {
    const result = parse('Slept fine, bed at 11, up at 7. Mood 4.');
    assert.deepEqual(result, {
      events: [],
      lastCaffeine: null,
      totalMg: null,
      caffeineStatus: 'unmentioned',
    });
  });

  test('an impossible time is refused, not clamped', () => {
    assert.equal(parse('Coffee at 25:99.').caffeineStatus, 'unclear');
    assert.equal(parse('Coffee at 14:73.').caffeineStatus, 'unclear');
  });

  test('numbers that are not times are ignored', () => {
    assert.equal(parse('Coffee. Slept 7.5 hours. Mood 3.').caffeineStatus, 'unclear');
    assert.equal(parse('Coffee on 2026-09-07.').caffeineStatus, 'unclear');
  });
});

describe('versioning', () => {
  test('the same text and catalogue always give the same value', () => {
    assert.deepEqual(parse('Last coffee 2pm.'), parse('Last coffee 2pm.'));
  });

  test('retuning a preset changes the ruleset hash', () => {
    const retuned = loadPresets(
      JSON.stringify({
        extends: 'default',
        presets: [{ id: 'coffee', label: 'Coffee', mg: 140, aliases: ['coffee'] }],
      }),
    );
    assert.notEqual(rulesetHash(P), rulesetHash(retuned));
    // Same catalogue, same hash — it must not depend on array order or timing.
    assert.equal(rulesetHash(P), rulesetHash([...DEFAULT_PRESETS]));
  });

  test('the derived record carries the version, the hash and the events', () => {
    const d = extractDerived(transcript('t1', 'Last coffee 2pm.'), P, new Date('2026-09-07T16:00:00Z'));
    assert.deepEqual(d, {
      transcriptId: 't1',
      date: '2026-09-07',
      lastCaffeine: '14:00',
      caffeineStatus: 'time',
      caffeineMg: 95,
      caffeineEvents: [{ presetId: 'coffee', label: 'Coffee', count: 1, mg: 95, time: '14:00' }],
      extractionVersion: EXTRACTION_VERSION,
      rulesetHash: rulesetHash(P),
      extractedAt: '2026-09-07T16:00:00.000Z',
    });
  });

  test('the derived record never carries the mood or the text', () => {
    const d = extractDerived(transcript('t2', 'Coffee 2pm. Mood 3.'), P);
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

    const summary = await reextractAll(store, config);
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

    await reextractAll(store, config);
    const second = await reextractAll(store, config);

    assert.equal(second.alreadyCurrent, 1);
    assert.equal((await store.listAllDerived()).length, 1);
  });

  test('changing the catalogue makes old records stale, then fixes them', async () => {
    const store = new MemoryStore();
    await store.append(transcript('a', 'Coffee at 2pm.'));
    await reextractAll(store, config);
    assert.equal((await store.listAllDerived())[0]?.caffeineMg, 95);

    const retuned = {
      ...config,
      presets: loadPresets(
        JSON.stringify({
          extends: 'default',
          presets: [{ id: 'coffee', label: 'Coffee', mg: 140, aliases: ['coffee'] }],
        }),
      ),
    };
    const summary = await reextractAll(store, retuned);

    // The old record was not counted as current, and the number moved.
    assert.equal(summary.alreadyCurrent, 0);
    assert.equal((await store.listAllDerived())[0]?.caffeineMg, 140);
  });

  test('a stale derived record is replaced, and the transcript is untouched', async () => {
    const store = new MemoryStore();
    await store.append(transcript('a', 'Last coffee 2pm.'));
    await store.putDerived({
      transcriptId: 'a',
      date: '2026-09-07',
      lastCaffeine: '09:00',
      caffeineStatus: 'time',
      caffeineMg: 1,
      caffeineEvents: [],
      extractionVersion: 'caffeine-0.0.1',
      rulesetHash: 'stale',
      extractedAt: '2026-01-01T00:00:00.000Z',
    });

    await reextractAll(store, config);
    const derived = await store.listAllDerived();
    assert.equal(derived[0]?.lastCaffeine, '14:00');
    assert.equal(derived[0]?.extractionVersion, EXTRACTION_VERSION);

    assert.equal((await store.listAll())[0]?.text, 'Last coffee 2pm.');
  });
});

describe('bugs the presets exposed', () => {
  test('an earlier drink cannot claim a later drink’s clock', () => {
    // "at 11" is not a time, so the americano has none. Without time ownership
    // it would reach past the cold brew and claim its 2pm.
    const result = parse('Flat white at 8am, americano at 11, cold brew at 2pm.');
    assert.deepEqual(
      result.events.map((e) => [e.presetId, e.time]),
      [
        ['flat-white', '08:00'],
        ['americano', null],
        ['cold-brew', '14:00'],
      ],
    );
    // The dose still counts the americano — an unknown time is not an unknown drink.
    assert.equal(result.totalMg, 407);
  });

  test('a decaf-only day is none, not unclear', () => {
    const result = parse('Decaf americano at 9pm, so should be fine.');
    assert.equal(result.caffeineStatus, 'none');
    assert.equal(result.lastCaffeine, null);
    assert.equal(result.totalMg, 3);
  });

  test('"decaf latte" is one drink, not a decaf plus a latte', () => {
    const result = parse('Decaf latte at 8pm.');
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]?.presetId, 'decaf');
  });
});
