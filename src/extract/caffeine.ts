/**
 * Layer 2 — caffeine timing extraction (PRD §3, §4.1).
 *
 * This is a *deterministic rule set*, not a model prompt. That choice matters:
 *
 *  - `reextract_all` has to be able to re-run over the whole corpus at any time,
 *    offline, with no API key and no cost per entry (PRD §10, §11).
 *  - The same transcript must produce the same value every time, or comparing
 *    baseline against intervention is comparing two different measuring sticks.
 *
 * The PRD calls the version fingerprint `promptHash`. There is no prompt here,
 * so the derived record stores `rulesetHash` instead — same job, honest name.
 *
 * The rules only ever read the transcript text. They never see history, and they
 * never touch `statedMood`: mood is stated, never inferred (PRD §4.2).
 */
import { createHash } from 'node:crypto';

/**
 * Four outcomes, kept apart on purpose. `null` means "not mentioned" and is not
 * `false` and not zero (PRD §4.1) — a day with no caffeine at all and a day
 * where I forgot to say are different facts, and collapsing them would quietly
 * poison the Layer 3 gate ("does the timing actually vary?").
 */
export type CaffeineStatus =
  /** A time was stated and parsed. `lastCaffeine` is set. */
  | 'time'
  /** Caffeine was mentioned and explicitly denied — none that day. */
  | 'none'
  /** Caffeine was mentioned but no usable time came with it. */
  | 'unclear'
  /** Caffeine never came up in the transcript. */
  | 'unmentioned';

export interface CaffeineExtraction {
  /** Strict `HH:MM`, 24-hour, or null. Never a guess (PRD §6). */
  lastCaffeine: string | null;
  caffeineStatus: CaffeineStatus;
}

/** Things that carry caffeine. Order does not matter; longest match wins. */
const CAFFEINE_TERMS = [
  'coffee',
  'espresso',
  'americano',
  'cappuccino',
  'macchiato',
  'cortado',
  'flat white',
  'cold brew',
  'latte',
  'mocha',
  'caffeine',
  'caffeinated',
  'matcha',
  'chai',
  'tea',
  'energy drink',
  'red bull',
  'monster',
  'cola',
  'coke',
];

/**
 * A word right before the drink that takes the caffeine back out of it.
 * "decaf latte" and "peppermint tea" are not caffeine events.
 */
const NON_CAFFEINE_QUALIFIERS = [
  'decaf',
  'decaffeinated',
  'herbal',
  'chamomile',
  'camomile',
  'peppermint',
  'mint',
  'rooibos',
  'ginger',
  'fruit',
  'no-caf',
];

/** "no coffee", "didn't have any coffee", "skipped the espresso". */
const NEGATION =
  /\b(?:no|none|zero|not|never|skipped|skipping|avoided|without|didn['’]?t|hadn['’]?t|haven['’]?t|did not|had no)\b/i;

/**
 * Times, most specific alternative first:
 *   1. `2:15pm` / `2.15 p.m.`   2. `14:00`   3. `2pm`   4. `noon` / `midnight`
 *
 * A bare number is deliberately NOT a time. "coffee at 3" could be either end of
 * the day, and the whole point of the field is *when*. Vague input is `unclear`,
 * not a coin flip (PRD §6).
 */
const TIME_RE =
  /(?<![\w:.])(?:(\d{1,2})[:.](\d{2})\s*([ap])\.?\s?m\.?|(\d{1,2})[:.](\d{2})|(\d{1,2})\s*([ap])\.?\s?m\.?|(noon|midday|midnight))/gi;

/** How far after a drink word a time may sit and still belong to it. */
const AFTER_WINDOW = 45;
/** ...and how far before, for "2pm coffee". Tighter: reading backwards is riskier. */
const BEFORE_WINDOW = 25;
/** How far back to look for a "no" attached to the drink word. */
const NEGATION_WINDOW = 30;

/**
 * A word that turns a time into a boundary rather than a cup. "Coffees before
 * 10am" and "no caffeine after 2pm" both name a limit — the actual last cup was
 * some other time — so the time is refused and the day is `unclear`.
 */
const BOUNDARY = /\b(?:before|until|till|by|prior to|up to|after|past)\s*$/i;

export const EXTRACTION_VERSION = 'caffeine-1.0.0';

/**
 * Fingerprint of the rules above. Every derived record stores it, so improving
 * the extractor cannot silently change old numbers — a mixed-version dataset is
 * visible instead of invisible (PRD §4.3).
 */
export const RULESET_HASH = createHash('sha256')
  .update(
    JSON.stringify({
      version: EXTRACTION_VERSION,
      terms: CAFFEINE_TERMS,
      qualifiers: NON_CAFFEINE_QUALIFIERS,
      negation: NEGATION.source,
      time: TIME_RE.source,
      windows: [AFTER_WINDOW, BEFORE_WINDOW, NEGATION_WINDOW],
    }),
  )
  .digest('hex')
  .slice(0, 16);

interface Found {
  start: number;
  end: number;
}

interface FoundTime extends Found {
  hhmm: string;
}

function hhmm(hour: number, minute: number, meridiem?: string): string | null {
  if (minute > 59) return null;
  let h = hour;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    h = (hour % 12) + (meridiem.toLowerCase() === 'p' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function findTimes(text: string): FoundTime[] {
  const times: FoundTime[] = [];
  for (const m of text.matchAll(TIME_RE)) {
    const [full, h1, m1, mer1, h2, m2, h3, mer3, word] = m;
    let value: string | null = null;

    if (h1 && m1) value = hhmm(Number(h1), Number(m1), mer1);
    else if (h2 && m2) value = hhmm(Number(h2), Number(m2));
    else if (h3 && mer3) value = hhmm(Number(h3), 0, mer3);
    else if (word) value = word.toLowerCase() === 'midnight' ? '00:00' : '12:00';

    if (value !== null) {
      times.push({ start: m.index, end: m.index + full.length, hhmm: value });
    }
  }
  return times;
}

function findTerms(lower: string): Found[] {
  const found: Found[] = [];
  for (const term of CAFFEINE_TERMS) {
    // `s?` so "two coffees" and "a couple of lattes" still count.
    const re = new RegExp(`\\b${term}s?\\b`, 'g');
    for (const m of lower.matchAll(re)) {
      found.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  // Earliest first, longest first on a tie, then drop anything that overlaps a
  // hit already kept — so "flat white" counts once, not as "flat white" plus a
  // second, shorter match inside it.
  found.sort((a, b) => a.start - b.start || b.end - a.end);

  const kept: Found[] = [];
  let lastEnd = -1;
  for (const hit of found) {
    if (hit.start < lastEnd) continue;
    kept.push(hit);
    lastEnd = hit.end;
  }
  return kept;
}

function isDecaffeinated(lower: string, term: Found): boolean {
  const before = lower.slice(Math.max(0, term.start - 20), term.start);
  return NON_CAFFEINE_QUALIFIERS.some((q) => new RegExp(`\\b${q}\\b[\\s-]*$`).test(before));
}

function isNegated(lower: string, term: Found): boolean {
  return NEGATION.test(lower.slice(Math.max(0, term.start - NEGATION_WINDOW), term.start));
}

/** A sentence break between two spans means they are not talking about each other. */
function separated(text: string, from: number, to: number): boolean {
  return /[.!?;\n]/.test(text.slice(from, to));
}

/**
 * The time nearest a drink word — after it first, then before it, and never
 * across a sentence break. Nearest rather than latest-in-sentence, because
 * "bed at 11:40pm, coffee at 2pm" must not read the bedtime as a coffee.
 *
 * Known limitation: "coffee at 8am, another at 1:15pm" yields 08:00, since
 * "another" is not a drink word. Saying "last coffee at 1:15pm" fixes it, and
 * that is the phrasing the field is built around. Under-reporting an earlier
 * cup is the safer failure than importing a bedtime.
 *
 * `boundaryRefused` reports that a time was there but named a limit rather than
 * a cup. The caller needs that: it is the difference between "no caffeine" and
 * "no caffeine after 2pm", which are not the same day.
 */
function timeFor(
  text: string,
  term: Found,
  times: FoundTime[],
): { hhmm: string | null; boundaryRefused: boolean } {
  let best: FoundTime | undefined;
  let bestGap = Infinity;
  let boundaryRefused = false;

  for (const time of times) {
    const after = time.start >= term.end;
    const distance = after ? time.start - term.end : term.start - time.end;
    if (distance < 0) continue;
    if (distance > (after ? AFTER_WINDOW : BEFORE_WINDOW)) continue;
    if (separated(text, after ? term.end : time.end, after ? time.start : term.start)) continue;
    if (BOUNDARY.test(text.slice(Math.max(0, time.start - 12), time.start))) {
      boundaryRefused = true;
      continue;
    }

    // A time before the word is a weaker signal, so it only wins when nothing
    // sits after the word at all.
    const gap = after ? distance : distance + AFTER_WINDOW;
    if (gap < bestGap) {
      bestGap = gap;
      best = time;
    }
  }
  return { hhmm: best?.hhmm ?? null, boundaryRefused };
}

/**
 * Pure. Same text in, same values out, forever — that is what makes the
 * `extractionVersion` on the derived record mean anything.
 */
export function extractCaffeine(text: string): CaffeineExtraction {
  const lower = text.toLowerCase();
  const terms = findTerms(lower).filter((term) => !isDecaffeinated(lower, term));
  if (terms.length === 0) return { lastCaffeine: null, caffeineStatus: 'unmentioned' };

  const times = findTimes(text);
  let latest: string | null = null;
  let sawPositiveMention = false;

  for (const term of terms) {
    const negated = isNegated(lower, term);
    const { hhmm: time, boundaryRefused } = timeFor(text, term, times);

    // "No coffee after 2pm" is a cutoff, not a cup — and not an abstinent day
    // either. Something was drunk before 2pm, so it is `unclear`, never `none`.
    // Refusing the number costs one unclear day and avoids a wrong time, which
    // is the trade the whole extractor is built around.
    if (negated) {
      if (time !== null || boundaryRefused) sawPositiveMention = true;
      continue;
    }

    sawPositiveMention = true;
    // The field is *last* caffeine, so the latest stated time wins.
    if (time !== null && (latest === null || time > latest)) latest = time;
  }

  if (latest !== null) return { lastCaffeine: latest, caffeineStatus: 'time' };
  return { lastCaffeine: null, caffeineStatus: sawPositiveMention ? 'unclear' : 'none' };
}
