# Drowse

A voice journal with derived metrics. Single user, personal tool, not a product.

Talk to Claude for a minute each morning. The transcript is stored permanently
and never edited. Structured data is *extracted from it later* — never typed into
a form. Sleep tracking is the first thing extracted, not the purpose. **The
purpose is the corpus.**

This repository is **Layer 0: capture only.** Transcript in, mood in, one line
back. That is the whole product right now, on purpose — extraction is retroactive,
so capture has to start before any extractor exists, and nothing is lost by
shipping thin.

## What exists

| Piece | Where |
|---|---|
| `save_transcript` MCP tool | `src/tools/saveTranscript.ts` |
| Remote MCP server (HTTP + token auth) | `src/http.ts`, `src/auth.ts` |
| Firestore storage, append-only | `src/store/firestore.ts` |
| JSON export (CLI + HTTP) | `src/export.ts`, `GET /export.json` |
| Claude Project instructions | `docs/claude-project-instructions.md` |
| Deploy guide | `docs/deploy.md` |

There is deliberately **no** `extract_entry`, `reextract_all`, or `query_entries`.
Those are Layers 1–3 and each one is gated on evidence from the layer before it.

## Quick start

```bash
npm install
cp .env.example .env          # then fill in DROWSE_TOKEN
npm test                      # 22 tests, no cloud needed
npm run build && npm start
```

To run without Firestore:

```bash
DROWSE_STORE=memory DROWSE_TOKEN=$(openssl rand -hex 32) npm run dev
```

Deploying to Cloud Run and wiring up the phone: [`docs/deploy.md`](docs/deploy.md).

## The one tool

```
save_transcript(text, statedMood?, date?, captureMethod?, phase?) -> "Saved — mood 3."
```

It returns a confirmation line and nothing else. It has **no read path at all** —
not restricted, not permissioned, simply absent. A logging conversation cannot
see history even if the model tries, because there is no tool to call.

That is the bias control in the schema rather than in a prompt.

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
code never collapses it.

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

The times in that sentence are just sitting in the text. Layer 1 will pull them
out; until then they cost nothing to keep.

`phase` lives on the transcript, not on a derived record — it is a fact about the
day, not an extraction result. It defaults from `DROWSE_DEFAULT_PHASE`, so you
never say it out loud.

## Export

```bash
npm run export -- --out exports/drowse-$(date +%F).json
```

Full transcripts included, from day one. **Firebase is not a backup.** Losing the
corpus is the worst realistic failure and it gets worse every month.

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
| 2 | Caffeine timing | Sleep extraction correct on 9 of 10 entries |
| 3 | `query_entries` in a separate chat | Baseline shows real spread in caffeine timing |
| 4 | One chart | Layer 3 left you wanting it |

Building any Layer 2+ feature before Layer 0 has run for 7 days is scope creep,
not validation. That is a kill criterion, not a guideline.

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
    types.ts            Transcript + the two-method store interface
    firestore.ts        append-only via create()
    memory.ts           tests and local runs
  tools/
    saveTranscript.ts   schema, record building, confirmation line
```

Full spec: `docs/prd.md`.
