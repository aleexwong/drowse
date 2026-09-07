/**
 * Layer 2 — caffeine extraction (PRD §3, §4.1).
 *
 * Deterministic rules over the transcript, driven entirely by the preset
 * catalogue in `presets.ts`. There is no separate hardcoded word list: what the
 * parser recognises is exactly what you have configured, so teaching it a new
 * drink is a data change, not a code change.
 *
 * Rules rather than a model call, because:
 *
 *  - `reextract_all` re-runs over the whole corpus at will, offline, with no API
 *    key and no per-entry cost (PRD §10, §11).
 *  - The same transcript must give the same numbers forever, or comparing
 *    baseline against intervention compares two different measuring sticks.
 *
 * The PRD calls the version fingerprint `promptHash`. There is no prompt here,
 * so the derived record stores `rulesetHash` — same job, honest name.
 *
 * The rules read the transcript text and nothing else. Never history, and never
 * `statedMood`: mood is stated, never inferred (PRD §4.2).
 */
import { createHash } from 'node:crypto';
import { DOSELESS, aliasIndex, type CaffeinePreset } from './presets.ts';

/**
 * Four outcomes, kept apart. `null` is "not mentioned", which is not `false` and
 * not zero (PRD §4.1) — a day with no caffeine and a day you forgot to mention
 * are different facts, and collapsing them would poison the Layer 3 gate.
 */
export type CaffeineStatus = 'time' | 'none' | 'unclear' | 'unmentioned';

/** One drink, as found in the transcript. */
export interface CaffeineEvent {
  presetId: string;
  label: string;
  /** How many of them: "two coffees" is 2. */
  count: number;
  /** Total milligrams for this event, `count * preset.mg`. Null when the dose is unknown. */
  mg: number | null;
  /** `HH:MM`, or null when the drink was named without a usable time. */
  time: string | null;
}

export interface CaffeineExtraction {
  /** Every drink found, in the order spoken. */
  events: CaffeineEvent[];
  /** Latest stated time across all events. Strict `HH:MM`, or null. */
  lastCaffeine: string | null;
  /**
   * Total dose for the day, milligrams. Null when nothing with a known dose was
   * found — an unknown total is not a zero total.
   */
  totalMg: number | null;
  caffeineStatus: CaffeineStatus;
}

/** "no coffee", "didn't have any", "skipped the espresso". */
const NEGATION =
  /\b(?:no|none|zero|not|never|skipped|skipping|avoided|without|didn['’]?t|hadn['’]?t|haven['’]?t|did not|had no)\b/i;

/**
 * A word that makes a time a boundary rather than a cup. "Coffees before 10am"
 * and "nothing after 2pm" name a limit; the actual last drink was some other
 * time, so the number is refused instead of recorded wrong.
 */
const BOUNDARY = /\b(?:before|until|till|by|prior to|up to|after|past)\s*$/i;

/** "two coffees", "a couple of espressos", "3 teas". */
const COUNT = /\b(a|an|one|two|three|four|five|six|couple(?: of)?|\d{1,2})\s*$/i;
const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  couple: 2, 'couple of': 2,
};

/** Turns a real drink into a decaf one when it sits right in front. */
const DECAF_PREFIX = /\b(?:decaf|decaffeinated|no-caf|caffeine-free)\b[\s-]*$/i;

/**
 * Times, most specific first:
 *   1. `2:15pm` / `2.15 p.m.`   2. `14:00`   3. `2pm`   4. `noon` / `midnight`
 *
 * A bare number is deliberately not a time. "Coffee at 3" could be either end of
 * the day, and the field's whole job is *when*, so it is `unclear` rather than a
 * coin flip (PRD §6). The quick-log path exists so you never have to rely on
 * phrasing anyway.
 */
const TIME_RE =
  /(?<![\w:.])(?:(\d{1,2})[:.](\d{2})\s*([ap])\.?\s?m\.?|(\d{1,2})[:.](\d{2})|(\d{1,2})\s*([ap])\.?\s?m\.?|(noon|midday|midnight))/gi;

/** How far after a drink word a time may sit and still belong to it. */
const AFTER_WINDOW = 45;
/** ...and how far before, for "2pm coffee". Tighter: reading backwards is riskier. */
const BEFORE_WINDOW = 25;
/** How far back to look for a "no" attached to the drink word. */
const NEGATION_WINDOW = 30;

export const EXTRACTION_VERSION = 'caffeine-2.0.0';

/**
 * Fingerprint of the rules *and* the catalogue they run on. Retuning a preset's
 * milligrams changes this, so a mixed-version dataset is visible instead of
 * invisible (PRD §4.3). Every derived record stores it.
 */
export function rulesetHash(presets: CaffeinePreset[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: EXTRACTION_VERSION,
        presets: presets.map((p) => [p.id, p.mg, p.decaf ?? false, [...p.aliases].sort()]),
        negation: NEGATION.source,
        boundary: BOUNDARY.source,
        count: COUNT.source,
        decaf: DECAF_PREFIX.source,
        time: TIME_RE.source,
        windows: [AFTER_WINDOW, BEFORE_WINDOW, NEGATION_WINDOW],
      }),
    )
    .digest('hex')
    .slice(0, 16);
}

interface Span {
  start: number;
  end: number;
}

interface FoundTime extends Span {
  hhmm: string;
}

interface FoundDrink extends Span {
  preset: CaffeinePreset;
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

    if (value !== null) times.push({ start: m.index, end: m.index + full.length, hhmm: value });
  }
  return times;
}

/**
 * Match preset aliases, longest first, and never inside an already-matched span.
 * That is what makes "green tea" beat "tea" and "double espresso" beat
 * "espresso" without a single special case in the code.
 */
function findDrinks(lower: string, presets: CaffeinePreset[]): FoundDrink[] {
  const taken: Span[] = [];
  const found: FoundDrink[] = [];

  for (const { alias, preset } of aliasIndex(presets)) {
    // `s?` so "two coffees" and "a couple of lattes" count.
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'g');
    for (const m of lower.matchAll(re)) {
      const span = { start: m.index, end: m.index + m[0].length };
      if (taken.some((t) => span.start < t.end && t.start < span.end)) continue;
      taken.push(span);
      found.push({ ...span, preset });
    }
  }
  found.sort((a, b) => a.start - b.start);

  // "Decaf latte" is one drink, not a decaf plus a latte. Drop the standalone
  // decaf marker when a real drink follows it immediately; DECAF_PREFIX then
  // scores the pair as a decaf.
  return found.filter((drink, i) => {
    if (drink.preset.id !== 'decaf') return true;
    const next = found[i + 1];
    return !next || next.start - drink.end > 2;
  });
}

function countBefore(lower: string, drink: FoundDrink): number {
  const before = lower.slice(Math.max(0, drink.start - 16), drink.start);
  const m = COUNT.exec(before);
  if (!m?.[1]) return 1;
  const word = m[1].toLowerCase().trim();
  return COUNT_WORDS[word] ?? Math.max(1, Math.min(20, Number(word) || 1));
}

function isNegated(lower: string, drink: FoundDrink): boolean {
  return NEGATION.test(lower.slice(Math.max(0, drink.start - NEGATION_WINDOW), drink.start));
}

/** A sentence break between two spans means they are not talking about each other. */
function separated(text: string, from: number, to: number): boolean {
  return /[.!?;\n]/.test(text.slice(from, to));
}

/**
 * Attach clock times to drinks.
 *
 * A time is scored against every drink — after the drink first, then before it,
 * never across a sentence break — and then goes to whichever drink it sits
 * closest to. That last step matters: in "americano at 11, cold brew at 2pm",
 * the bare "11" is not a time, and without ownership the americano would reach
 * past the cold brew and claim its 2pm. Each clock belongs to one drink.
 *
 * `boundaryRefused` records that a time was there but named a limit, not a cup.
 * The caller needs it: it separates "no caffeine" from "no caffeine after 2pm",
 * which are not the same day.
 */
function assignTimes(
  text: string,
  drinks: FoundDrink[],
  times: FoundTime[],
): { hhmm: string | null; boundaryRefused: boolean }[] {
  const result = drinks.map(() => ({ hhmm: null as string | null, boundaryRefused: false }));
  const gaps: number[][] = drinks.map(() => times.map(() => Infinity));

  for (let d = 0; d < drinks.length; d += 1) {
    const drink = drinks[d]!;
    for (let t = 0; t < times.length; t += 1) {
      const time = times[t]!;
      const after = time.start >= drink.end;
      const distance = after ? time.start - drink.end : drink.start - time.end;
      if (distance < 0) continue;
      if (distance > (after ? AFTER_WINDOW : BEFORE_WINDOW)) continue;
      if (separated(text, after ? drink.end : time.end, after ? time.start : drink.start)) continue;
      if (BOUNDARY.test(text.slice(Math.max(0, time.start - 12), time.start))) {
        result[d]!.boundaryRefused = true;
        continue;
      }
      // A time before the drink is a weaker signal, so it only wins when
      // nothing sits after the drink at all.
      gaps[d]![t] = after ? distance : distance + AFTER_WINDOW;
    }
  }

  const bestForDrink = drinks.map(() => Infinity);

  for (let t = 0; t < times.length; t += 1) {
    let owner = -1;
    let ownerGap = Infinity;
    for (let d = 0; d < drinks.length; d += 1) {
      if (gaps[d]![t]! < ownerGap) {
        ownerGap = gaps[d]![t]!;
        owner = d;
      }
    }
    if (owner === -1) continue;

    // A drink keeps the closest of the times that chose it.
    if (ownerGap < bestForDrink[owner]!) {
      bestForDrink[owner] = ownerGap;
      result[owner]!.hhmm = times[t]!.hhmm;
    }
  }
  return result;
}

/**
 * Pure. Same text and same catalogue in, same values out, forever — that is what
 * makes `extractionVersion` and `rulesetHash` mean anything.
 */
export function extractCaffeine(text: string, presets: CaffeinePreset[]): CaffeineExtraction {
  const lower = text.toLowerCase();
  const drinks = findDrinks(lower, presets);
  const empty = { events: [], lastCaffeine: null, totalMg: null };

  if (drinks.length === 0) return { ...empty, caffeineStatus: 'unmentioned' };

  const times = findTimes(text);
  const decafPreset = presets.find((preset) => preset.id === 'decaf');
  const events: CaffeineEvent[] = [];
  let latest: string | null = null;
  let totalMg: number | null = null;
  let sawPositiveMention = false;

  const attached = assignTimes(text, drinks, times);
  let sawCaffeinated = false;

  for (const [index, drink] of drinks.entries()) {
    const negated = isNegated(lower, drink);
    const { hhmm: time, boundaryRefused } = attached[index]!;

    // "No coffee after 2pm" is a cutoff, not a cup — and not an abstinent day
    // either, since something was drunk earlier. Refusing the number costs one
    // unclear day and avoids a wrong time, which is the trade throughout.
    if (negated) {
      if (time !== null || boundaryRefused) {
        sawPositiveMention = true;
        if (!drink.preset.decaf) sawCaffeinated = true;
      }
      continue;
    }
    sawPositiveMention = true;

    const count = countBefore(lower, drink);

    // "Decaf latte" is a latte by name and a decaf by dose, so it is scored as
    // whatever the catalogue says decaf costs — not as a latte, and not as a
    // guessed zero.
    const prefixDecaf = !drink.preset.decaf && DECAF_PREFIX.test(lower.slice(Math.max(0, drink.start - 20), drink.start));
    const effective = prefixDecaf ? (decafPreset ?? { ...drink.preset, mg: 0, decaf: true }) : drink.preset;
    const decaf = effective.decaf ?? false;
    const mg = DOSELESS.has(effective.id) ? null : count * effective.mg;

    events.push({
      presetId: effective.id,
      label: prefixDecaf ? `Decaf ${drink.preset.label.toLowerCase()}` : drink.preset.label,
      count,
      mg,
      time,
    });

    if (mg !== null) totalMg = (totalMg ?? 0) + mg;
    if (!decaf) sawCaffeinated = true;
    // The field is *last* caffeine, and a decaf does not move it.
    if (!decaf && time !== null && (latest === null || time > latest)) latest = time;
  }

  if (latest !== null) return { events, lastCaffeine: latest, totalMg, caffeineStatus: 'time' };

  // A decaf-only day is a day with no caffeine in it. Reporting that as
  // `unclear` would hide a real answer behind a shrug.
  const status: CaffeineStatus = sawPositiveMention && sawCaffeinated ? 'unclear' : 'none';
  return { events, lastCaffeine: null, totalMg, caffeineStatus: status };
}
