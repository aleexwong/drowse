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
> need work once real mornings hit them. Layer 1 (sleep) is still not built. See
> `docs/prd.md` §16 for the first honest accuracy check.

## What exists

| Piece | Where |
|---|---|
| `save_transcript` MCP tool | `src/tools/saveTranscript.ts` |
| Caffeine extractor (deterministic, versioned) | `src/extract/caffeine.ts` |
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
npm test                      # 53 tests, no cloud needed
npm run build && npm start
```

To run without Firestore:

```bash
DROWSE_STORE=memory DROWSE_TOKEN=$(openssl rand -hex 32) npm run dev
```

Deploying to Cloud Run and wiring up the phone: [`docs/deploy.md`](docs/deploy.md).

## The two tools

```
save_transcript(text, statedMood?, date?, captureMethod?, phase?)
  -> "Saved — caffeine 14:00, mood 3."

reextract_all()
  -> "Re-extracted 23 transcript(s) at caffeine-1.0.0 (bf90759d7bd29c46) — 18 with a
      caffeine time, 2 with none, 1 unclear, 2 not mentioned."
```

Both return one line and nothing else. Neither has a read path a logging
conversation can use: `save_transcript` reports only the entry just spoken, and
`reextract_all` reports counts — never a transcript, a date, or a single day's
value. That is the bias control in the schema rather than in a prompt.

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
  "extractionVersion": "caffeine-1.0.0",
  "rulesetHash": "bf90759d7bd29c46",
  "extractedAt": "2026-09-07T15:02:00.100Z"
}
```

Transcripts are append-only; derived records are overwritten on every
re-extraction. That asymmetry is the whole design: the words are the asset, the
numbers are a claim about the words.

## Export

```bash
npm run export -- --out exports/drowse-$(date +%F).json
```

Full transcripts included, from day one. **Firebase is not a backup.** Losing the
corpus is the worst realistic failure and it gets worse every month.

## How the caffeine extractor works

Deterministic rules over the transcript text — not a model prompt, and no API
key. That is what lets `reextract_all` re-run over the whole corpus offline, and
what makes the same transcript give the same number every time. A drifting
measuring stick between baseline and intervention would invalidate the
comparison.

The rules, in short:

- **Drink words**: coffee, espresso, latte, matcha, cola, energy drink and so on,
  singular or plural. `decaf`, `herbal`, `peppermint` in front of one cancels it.
- **Times**: `2pm`, `2:15pm`, `14:30`, `2.45pm`, `noon`, `midnight`. A bare number
  is *not* a time — "coffee at 3" could be either end of the day, so it is
  `unclear` rather than a coin flip.
- **Attachment**: the nearest time after the drink word, never across a sentence
  break. "Coffee at 2pm, bed at 11:40pm" gives 14:00, not the bedtime.
- **Boundaries are not cups**: "coffees before 10am", "nothing past 3pm" name a
  limit, not a drink. Refused, marked `unclear`.
- **Negation**: "no coffee yesterday" is `none`. But "no coffee *after 2pm*" is
  `unclear` — something was drunk earlier, so it is not an abstinent day.
- **Last wins**: across several drink words, the latest stated time.

Known limitation: *"coffee at 8am, another at 1:15pm"* returns 08:00, because
"another" is not a drink word. Saying "last coffee at 1:15pm" fixes it, and
under-reporting an earlier cup beats importing a bedtime.

Every derived record stores `extractionVersion` and `rulesetHash`, so improving
the rules cannot silently change old numbers (PRD §4.3). The PRD calls the second
field `promptHash`; there is no prompt here, so the honest name is used.

Fixing a wrong value means fixing the rules and re-running — never editing a
transcript:

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
  extract/
    caffeine.ts         the rules, the version, the ruleset hash
    index.ts            derived-record building, confirmation fragment
  tools/
    saveTranscript.ts   schema, record building, confirmation line
    reextractAll.ts     whole-corpus re-extraction, counts only
```

Full spec: `docs/prd.md`.
