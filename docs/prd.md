# Drowse — PRD

**Status:** Draft v4, Sep 2026
**Owner:** Alex
**Type:** Personal tool. Single user. Not a product.

---

## 1. What this is

**A voice journal with derived metrics.**

I talk to Claude for a minute or two each morning. The transcript is stored permanently. Structured data points are *extracted* from the transcript later — never typed into a form.

Sleep tracking is the first thing extracted, not the purpose. The purpose is the corpus.

**The experiment question this eventually answers:**

> Does moving my caffeine cutoff earlier measurably change my next-day mood?

That is one use of the corpus, not the point of it.

---

## 2. Core principles

1. **The transcript is the source of truth.** Everything else is derived and regenerable.
2. **Extraction is retroactive.** So capture starts before any extractor exists. Nothing is lost by shipping thin.
3. **Talking costs nothing extra.** Capture everything, decide later what matters. There is no "only log what varies" rule — that rule existed because taps were expensive.
4. **Mood is stated, never inferred.** See §4.2. Non-negotiable.
5. **Never edit a transcript.** If a derived value is wrong, fix the extractor and re-run.

---

## 3. The layers

Each layer ships on its own and is gated by evidence from the layer before it. **v1 is Layer 0.** Everything else is a follow-up, not a commitment.

| Layer | Scope | Gate to proceed |
|---|---|---|
| **0** | Capture only — transcript + stated mood | 7 consecutive days logged |
| **1** | Sleep extraction — bedtime, wake time, duration | Correct on 9 of 10 entries |
| **2** | Caffeine timing extraction | Baseline shows real spread in timing |
| **3** | Read access — `query_entries` in a separate chat | I actually ask something useful |
| **4** | Chart — 30 days, sleep + mood, phase bands | Only if Layer 3 leaves me wanting it |

**Deferred, not layered:** `exercise` (cheap, probably worth adding eventually), `alcohol` (near-constant for me, and a constant explains no variance — recoverable from transcript any time), food (§8), everything in §15.

**Why alcohol is deprioritised:** same reasoning that cut caffeine *amount*. If it barely varies, it cannot explain variance in mood. It stays in the transcript, so extracting it later costs nothing.

---

## 4. Data model

### 4.1 Two collections

**Transcripts (immutable, append-only) — Layer 0**

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `date` | ISO date | |
| `text` | string | full transcript, never edited |
| `capturedAt` | timestamp | |
| `captureMethod` | enum | `voice` / `form` |
| `statedMood` | integer 1–5 or null | **captured here, never derived** |
| `phase` | enum | `baseline` / `intervention` / `washout` |

**Derived (regenerable) — Layer 1+**

| Field | Type | Layer |
|---|---|---|
| `transcriptId` | uuid | 1 |
| `bedtime` | time or null | 1 |
| `wakeTime` | time or null | 1 |
| `sleepDuration` | derived | 1 |
| `lastCaffeine` | time or null | 2 |
| `isWeekend` | boolean | 1 |
| `extractionVersion` | string | 1 |
| `promptHash` | string | 1 |
| `extractedAt` | timestamp | 1 |

`null` means "not mentioned", which is **not** the same as `false` or zero. Do not collapse them.

Note `phase` lives on the transcript, not the derived record — it is a fact about the day, not an extraction result.

### 4.2 Mood is special

`statedMood` is captured at Layer 0 and is **never extracted by a model**.

If mood came from sentiment analysis of my own journaling, I would be correlating my speech with my speech. That is circular and would produce a convincing fake result.

If I don't say a number, Claude asks once. If I still don't, the field is null for that day.

This is also the only thing that cannot be recovered retroactively. Every other variable can be re-extracted from the corpus; a mood I never said is gone forever.

### 4.3 Extraction versioning (Layer 1+)

Every derived record stores `extractionVersion` and `promptHash`.

- Improving the extractor does **not** silently change old numbers.
- Re-extraction is a deliberate, whole-dataset operation that bumps the version.
- Baseline and intervention data must share an extraction version, or the comparison is invalid.

This is what makes retroactive variables safe: in month three I can add a new variable, re-run over every transcript, and get it for all past days at once.

---

## 5. Core loop

Morning, roughly the same time. Open the Claude app and talk.

> "Slept badly, bed around 11:40, up at 7:15. Last coffee was 2pm yesterday. Ran in the evening. Work's been dragging. Mood 3."

At Layer 0, Claude stores the transcript and the mood number, and confirms. That's all. The times in that sentence are just sitting in the text until Layer 1 exists.

**Fallback:** a minimal web form for backfill or when voice fails. Backup only.

---

## 6. MCP tools

| Tool | Layer | Returns |
|---|---|---|
| `save_transcript` | 0 | Confirmation only |
| `extract_entry` | 1 | Parsed values |
| `reextract_all` | 1 | Version bump summary |
| `query_entries` | 3 | Rows + transcripts |

`save_transcript` and `extract_entry` **must not** read history. Only `query_entries` does, and it is never called in a logging conversation.

**Extraction rules (Layer 1+)**
- Times: strict `HH:MM`. Vague input → ask once, then null.
- Booleans: explicit only. Unmentioned is `null`.
- Mood: never extracted (§4.2).

**Confirmation format** — one line, no commentary:

> `Saved — mood 3.` *(Layer 0)*
> `Saved — bed 23:40, up 07:15, caffeine 14:00, mood 3.` *(Layer 2)*

No comparison to previous days. No reflection. No follow-up question.

---

## 7. The Claude Project

Capture lives in a dedicated Claude Project whose instructions enforce §6:

- After saving: confirm and stop. Do not comment on the data, compare to previous days, reflect anything back, or ask how I'm doing.
- Never call `query_entries` in a logging conversation.
- Analysis happens in a **separate** chat, opened deliberately and later.

This is the bias control.

---

## 8. Why no food tracking

Cut deliberately, not forgotten.

- Food logging has the worst dropout rate of any tracked variable. It is what kills nutrition apps.
- Nutrition databases give false precision — "chicken breast" spans roughly a 2x calorie range depending on what was actually eaten.
- It does not serve the experiment question, which is caffeine timing → mood.

**The transcript contains what I ate anyway.** After 60 days I can extract it retroactively and find out whether it is worth structuring — at zero capture cost. That is the entire argument for transcript-first.

---

## 9. Experiment design (needs Layer 2)

**Phases**
1. **Baseline** — 14 days minimum. Change nothing.
2. **Intervention** — 14 days minimum. Change exactly one input.
3. **Washout** — optional, 7 days.

**First intervention:** caffeine cutoff moved earlier. Target set after baseline shows my actual timing spread. **This is the open item — nothing about the intervention can be decided until baseline data exists.**

**Bias controls**
- Mood is a number I state, before any analysis conversation.
- Logging mode never surfaces history (§6, §7).
- `isWeekend` tagged so weekend effects are not read as intervention effects.
- `captureMethod` tagged so voice-vs-form differences stay visible.
- Baseline and intervention must share an `extractionVersion`.

**Known limitations**
- Talking to an LLM before stating mood is itself a mild intervention. Minimised by §7, not eliminated. Accepted.
- n=1, self-reported, unblinded. Expectation bias cannot be removed.
- No claim of statistical significance. The goal is a personal pattern clear enough to act on.

---

## 10. Analysis (Layer 3)

No Cloud Function. No API key. No analysis button. Cut.

I ask questions in a separate Claude chat, reading via `query_entries`.

Layer 4 adds one chart — sleep duration and stated mood over 30 days, with phase bands — plus a raw table. For eyeballing only, and only if Layer 3 leaves me wanting it.

---

## 11. Technical

**Layer 0 only**
- **MCP server:** must be **remote (HTTP + auth)**, not local stdio, so it works from the phone. This is the main build item. Verify current custom-connector support before starting.
- **Auth:** one long-lived token stored as a secret. Single user, no OAuth flow.
- **Storage:** Firestore, transcripts collection.
- **Hosting:** Cloud Run / Fly / similar.
- **Security rules:** locked to my uid before anything deploys.

**Later layers**
- Derived collection (Layer 1).
- Web fallback PWA — reuse manifest, service worker, icons, offline shell from BurnRate. Offline persistence enabled.
- Static frontend on Vercel (Layer 4).

**Data safety**
- JSON export from day one, including full transcripts. Firebase is not a backup.
- Transcripts are append-only. No delete path except manual.
- Losing the corpus is the worst realistic failure, and it gets worse every month.

**Privacy note:** daily voice journals are the most sensitive data I will ever store. Decide explicitly whether Firestore is where I want it *before* the corpus gets large enough that moving is painful.

---

## 12. Definition of done — Layer 0

This is v1. Nothing below this list is required to ship.

- [ ] Remote MCP server deployed and reachable from the phone's Claude app.
- [ ] `save_transcript` stores a full transcript plus stated mood.
- [ ] Claude Project instructions stop commentary during logging.
- [ ] Export produces valid JSON including transcripts.
- [ ] Logged 3 consecutive days by voice.

---

## 13. Layer gates

Do not start a layer before its gate is met.

- **Layer 1** — 7 consecutive days logged. If I cannot hit that, no extractor is worth writing.
- **Layer 2** — sleep extraction correct on 9 of 10 entries.
- **Layer 3** — baseline shows real spread in caffeine timing. If timing is flat, the experiment is unrunnable as designed and I pick a different variable rather than forcing this one.
- **Layer 4** — I have used Layer 3 and found myself wanting a chart.

---

## 14. Kill criteria

Do not renegotiate later.

- **Voice capture takes over ~2 minutes or needs more than one correction per entry** → it is not easier than a form and the premise is wrong.
- **I miss more than 4 of the first 14 days** → capture is wrong. Fix capture, not analysis.
- **Extraction is wrong on more than 1 in 10 entries** → tighten the schema. Transcripts survive regardless, which is the safety net.
- **I stop stating a mood number** → the experiment is dead even if journaling continues. Decide honestly whether this is still an experiment or just a diary. Both are fine; pretending is not.
- **After a full baseline + intervention cycle (~30 days) there is no visible relationship** → the premise is wrong. Stop adding features to rescue it.
- **I build any Layer 2+ feature before Layer 0 has run for 7 days** → scope creep, not validation.

---

## 15. Explicitly deferred

Revisit only after 60 days of real use:

- `exercise` and `alcohol` extraction (§3)
- Food extraction from existing transcripts (§8)
- General memory bank for routines and projects — this is a second product
- Multi-user support and a non-hacky architecture
- Additional derived variables (screens before bed, work stress)
- Wearable import
- Correlation stats beyond eyeballing a chart
- Any UI polish
