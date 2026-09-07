# Drowse

A voice journal with derived metrics. Single user, personal tool, not a product.

Talk to Claude for a minute each morning. The transcript is stored permanently
and never edited. Structured data is *extracted from it later* — never typed into
a form. Sleep tracking is the first thing extracted, not the purpose. **The
purpose is the corpus.**

This repository is **Layer 0 (capture) plus the Layer 2 caffeine extractor.**
Transcript in, mood in, one line back — and the last caffeine time pulled back
out of the words.

> **Note on the gate.** The PRD gates Layer 2 behind 7 logged days and a working
> sleep extractor (§13). Neither has happened; the extractor was built anyway, on
> request. Nothing is at risk — transcripts stay append-only and untouched, and a
> derived value can be thrown away and recomputed. But the gate exists because an
> extractor tuned on zero real entries is tuned on guesses, so expect the rules to
> need work once real mornings hit them — and the preset doses are published
> mid-range figures, not your machine and your mug, so override them before the
> numbers get used for anything. Layer 1 (sleep) is still not built. See
> `docs/prd.md` §16 for the first honest accuracy check.

## What exists

| Piece | Where |
|---|---|
| `save_transcript` MCP tool | `src/tools/saveTranscript.ts` |
| **Drink presets — doses, aliases, your overrides** | `src/extract/presets.ts` |
| Caffeine extractor (deterministic, versioned) | `src/extract/caffeine.ts` |
| **Quick log: CLI, HTTP, `log_caffeine`** | `src/caffeine.ts`, `src/http.ts` |
| `reextract_all` MCP tool | `src/tools/reextractAll.ts` |
| Derived records, regenerable | `src/store/*.ts` |
| Remote MCP server (HTTP + token auth) | `src/http.ts`, `src/auth.ts` |
| Firestore storage, append-only | `src/store/firestore.ts` |
| JSON export (CLI + HTTP) | `src/export.ts`, `GET /export.json` |
| Claude Project instructions | `docs/claude-project-instructions.md` |
| Deploy guide | `docs/deploy.md` |

There is deliberately **no** `query_entries`. That is Layer 3, and it is the only
tool that can read history — which is exactly why it is not here yet.

There is no `extract_entry` either. Extraction is deterministic and runs inside
`save_transcript`, so a per-entry tool would add nothing except a way to point
extraction at a day other than the one just spoken.

## Quick start

```bash
npm install
cp .env.example .env          # then fill in DROWSE_TOKEN
npm test                      # 131 tests, no cloud needed
npm run build && npm start
```

To run without Firestore:

```bash
DROWSE_STORE=memory DROWSE_TOKEN=$(openssl rand -hex 32) npm run dev
```

Log a drink without saying anything:

```bash
npm run caffeine -- --list
npm run caffeine -- --preset flat-white --at 14:00
```

Deploying to Cloud Run and wiring up the phone: [`docs/deploy.md`](docs/deploy.md).

## Two ways in

**Talk.** The main path, and still the point — the corpus is the product.

```
save_transcript(text, statedMood?, date?, captureMethod?, phase?)
  -> "Saved — caffeine 14:00 (95mg), mood 3."
```

**Or just log the drink.** No sentence, no phrasing, no model:

```bash
npm run caffeine -- --preset flat-white --at 14:00
# Saved — caffeine 14:00 (130mg), no mood stated.

curl -H "authorization: Bearer $DROWSE_TOKEN" -H 'content-type: application/json' \
     -d '{"preset":"cold-brew","at":"09:30"}' https://…/caffeine
```

Same thing from a phone shortcut, a widget, or `log_caffeine` in a chat. The
preset expands into a plain sentence — `One flat white at 14:00.` — and goes
through the same store and the same extractor as everything else. It is a real,
re-extractable transcript, not a number smuggled past the corpus, and it is
tagged `captureMethod: "form"` so form-vs-voice stays visible as a bias control.

A tracker you can only reach through an LLM is a tracker you cannot use when the
connector is down, when you are offline, or when you simply do not feel like
narrating your morning.

**Tools on the connector:** `save_transcript`, `log_caffeine`, `list_presets`,
`reextract_all`. Every one is a write or a config read. There is no read path a
logging conversation can use — `reextract_all` returns counts, never a
transcript, a date, or a single day's value. That is the bias control in the
schema rather than in a prompt.

## Three rules the code enforces

**The transcript is the source of truth.** `text` is stored word for word. The
store rejects a duplicate id instead of overwriting it (`FirestoreStore.append`
uses `create`, not `set`), and Firestore rules deny every client write. There is
no update path and no delete path.

**Mood is stated, never inferred.** `statedMood` is a required part of the input
schema, capped at integers 1–5, and no model ever produces it. If the user does
not say a number, Claude asks once and then stores `null`. This is the only field
that cannot be recovered retroactively — every other variable can be re-extracted
from the corpus, but a mood never spoken is gone.

**`null` is not `false` and not zero.** "Not mentioned" is its own answer and the
code never collapses it. This is why the caffeine field has a companion status
with four values rather than a bare time-or-null:

| `caffeineStatus` | Means | `lastCaffeine` |
|---|---|---|
| `time` | A time was stated and parsed | `"14:00"` |
| `none` | Explicitly no caffeine that day | `null` |
| `unclear` | Mentioned, but no usable time | `null` |
| `unmentioned` | Never came up | `null` |

`caffeineMg` follows the same rule: `null` is "no dose I can put a number on",
never `0`. "Caffeine at 2pm" gives a time and a null dose, because it says
nothing about how much.

A day with no coffee and a day where you forgot to say are different facts.
Collapsing them would quietly poison the Layer 3 gate, which asks whether the
timing varies at all.

## Data shape

```json
{
  "id": "0f1c…",
  "date": "2026-09-07",
  "text": "Slept badly, bed around 11:40, up at 7:15. Last coffee was 2pm yesterday…",
  "capturedAt": "2026-09-07T15:02:00.000Z",
  "captureMethod": "voice",
  "statedMood": 3,
  "phase": "baseline"
}
```

The bed and wake times in that sentence are still just sitting in the text —
Layer 1 will pull them out. The caffeine time is extracted now.

`phase` lives on the transcript, not on a derived record — it is a fact about the
day, not an extraction result. It defaults from `DROWSE_DEFAULT_PHASE`, so you
never say it out loud.

The extractor writes a second, regenerable record beside it:

```json
{
  "transcriptId": "0f1c…",
  "date": "2026-09-07",
  "lastCaffeine": "14:00",
  "caffeineStatus": "time",
  "caffeineMg": 225,
  "caffeineEvents": [
    { "presetId": "flat-white", "label": "Flat white", "count": 1, "mg": 130, "time": "08:00" },
    { "presetId": "coffee", "label": "Coffee", "count": 1, "mg": 95, "time": "14:00" }
  ],
  "extractionVersion": "caffeine-2.0.0",
  "rulesetHash": "0fdbfda70e432451",
  "extractedAt": "2026-09-07T15:02:00.100Z"
}
```

`caffeineEvents` is there so a wrong total can be traced to the drink that caused
it, rather than leaving you with one number and no way to argue with it.

Transcripts are append-only; derived records are overwritten on every
re-extraction. That asymmetry is the whole design: the words are the asset, the
numbers are a claim about the words.

## Export

```bash
npm run export -- --out exports/drowse-$(date +%F).json
```

Full transcripts included, from day one. **Firebase is not a backup.** Losing the
corpus is the worst realistic failure and it gets worse every month.

## The presets are the whole vocabulary

`src/extract/presets.ts` is the single place that knows what a drink is called
and what it contains. There is no second hardcoded word list: the aliases in that
file are exactly what the parser matches, and the milligrams are exactly what a
match is worth. Teaching Drowse a new drink is a data change.

```
coffee           95mg    coffee, cup of coffee, drip coffee, filter coffee…
espresso         63mg    espresso, single espresso, shot, shot of espresso
double-espresso  126mg   double espresso, doppio, double shot, two shots
flat-white       130mg   flat white
cold-brew        200mg   cold brew, nitro, nitro cold brew
black-tea        47mg    tea, black tea, english breakfast, earl grey…
…24 in total — `npm run caffeine -- --list`
```

**Override them, because the defaults are wrong for you.** Point `DROWSE_PRESETS`
at your own file (see `presets.example.json`):

```json
{
  "extends": "default",
  "presets": [
    { "id": "coffee", "label": "Coffee", "mg": 140,
      "aliases": ["coffee", "my usual", "the usual"] }
  ]
}
```

Now "my usual at 7am" is 140mg. Omit `extends` to replace the catalogue outright.
A malformed file is fatal at startup — your own milligrams quietly reverting to
mid-range guesses is exactly the drift the versioning exists to prevent, and two
presets claiming the same alias is refused rather than resolved by array order.

Doses are typical servings, not measurements. A "coffee" spans a 2x range, which
is the same false-precision problem that got food tracking cut (PRD §8). They are
here because *relative* dose across your own days is the useful signal — a 200mg
cold brew and a 63mg latte are not the same input — and because a number you can
override beats a category you cannot.

## How the extractor reads a sentence

Deterministic rules, no API key, no model call. That is what lets
`reextract_all` re-run over the whole corpus offline, and what makes the same
transcript give the same number forever — a drifting measuring stick between
baseline and intervention would invalidate the comparison.

- **Longest alias wins.** "Green tea" beats "tea", "double espresso" beats
  "espresso", "instant coffee" beats "coffee" — from the catalogue, with no
  special cases in the code.
- **Counts multiply.** "Two coffees" is 190mg. "A couple of lattes" is 126mg.
- **Times**: `2pm`, `2:15pm`, `14:30`, `2.45pm`, `noon`, `midnight`. A bare number
  is *not* a time — "coffee at 3" could be either end of the day, so it is
  `unclear` rather than a coin flip. Use the quick-log path and the question
  never arises.
- **Each clock belongs to one drink.** In "americano at 11, cold brew at 2pm" the
  bare "11" is not a time, and the americano does not get to reach past the cold
  brew and claim its 2pm. Its time is null; its dose still counts.
- **Never across a sentence break.** "Coffee at 2pm. Woke at 7:15." gives 14:00.
- **Boundaries are not cups.** "Coffees before 10am", "nothing past 3pm" name a
  limit. Refused, marked `unclear`, rather than recorded wrong.
- **Negation**: "no coffee yesterday" is `none`; "no coffee *after 2pm*" is
  `unclear`, because something was drunk earlier.
- **Decaf is scored, not ignored.** "Decaf latte" is one drink worth 3mg, and it
  does not move `lastCaffeine`. A decaf-only day is `none`.

Known limitation: *"coffee at 8am, another at 1:15pm"* returns 08:00, because
"another" is not a drink word. Say "last coffee at 1:15pm", or add "another" as
an alias, or just log it with a preset.

Every derived record stores `extractionVersion` and `rulesetHash` — a hash of the
rules *and* the catalogue, so retuning a dose makes old records visibly stale
rather than silently mixed (PRD §4.3). The PRD calls the second field
`promptHash`; there is no prompt here, so the honest name is used.

Fixing a wrong value means fixing the rules or the preset and re-running — never
editing a transcript:

```
reextract_all()
```

## Definition of done — Layer 0

- [x] Remote MCP server, HTTP + auth, phone-reachable — code done, needs deploying
- [x] `save_transcript` stores a full transcript plus stated mood
- [x] Claude Project instructions stop commentary during logging
- [x] Export produces valid JSON including transcripts
- [ ] **Logged 3 consecutive days by voice** — only you can tick this one

## What happens next, and what has to be true first

| Layer | Scope | Gate |
|---|---|---|
| 1 | Sleep extraction | 7 consecutive days logged |
| ~~2~~ | ~~Caffeine timing~~ | **Built early, out of order — see the note at the top** |
| 3 | `query_entries` in a separate chat | Baseline shows real spread in caffeine timing |
| 4 | One chart | Layer 3 left you wanting it |

The PRD calls building a Layer 2 feature before Layer 0 has run 7 days a kill
criterion, not a guideline. It was built anyway, deliberately. The honest reading:
the *code* is cheap and reversible, but the *evidence* the gate was protecting is
still missing — the extractor has never seen a real morning, and the rules above
are guesses about how you talk until it has.

The experiment this eventually answers: *does moving my caffeine cutoff earlier
measurably change my next-day mood?* That is one use of the corpus, not the point
of it.

## Layout

```
src/
  index.ts              server entrypoint
  config.ts             env, timezone, defaults
  auth.ts               bearer / x-api-key / path token
  http.ts               express app, MCP endpoint, export endpoint
  mcp.ts                MCP server — one tool
  export.ts             JSON export CLI
  store/
    types.ts            Transcript, DerivedEntry, the store interfaces
    firestore.ts        append-only via create()
    memory.ts           tests and local runs
  caffeine.ts           quick-log CLI — no server, no model
  extract/
    presets.ts          the drink catalogue: doses, aliases, your overrides
    caffeine.ts         the rules, the version, the ruleset hash
    index.ts            derived records, preset expansion
  tools/
    saveTranscript.ts   schema, record building, confirmation line
    logCaffeine.ts      the preset path
    reextractAll.ts     whole-corpus re-extraction, counts only
```

Full spec: `docs/prd.md`.
