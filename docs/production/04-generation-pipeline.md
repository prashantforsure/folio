# 04 — The generation pipeline: how consistency actually works

This is the mechanical answer to "how do we make a video from the script with the same character
in every frame". Read it before touching the worker, any `✦` action, or the prompt assembler.

## 1. The principle

Consistency is **reference discipline**, not a model trick. Every generation is conditioned on the
*same* canonical images and the *same* style text, resolved from the records at submit time by the
server — never typed by the writer into a prompt. Modern image and video models accept several
reference images ("elements", "ingredients", "references") and hold identity from them; the
pipeline's job is to hand every model the same references in the same roles, every time, and to
say loudly when a reference is missing (Laper's gate: "otherwise the model invents one").

## 2. The six layers

```
0  Film settings ───────► style prefix + aspect + tier            (project; free)
       │
       ├─► 1  Character Look ──► 1b Turnaround                    (per character; project-wide)
       ├─► 2  Location plate                                      (per location; project-wide)
       │
       └─► 3  Scene still (per reel)      ← plate + cast Looks + heading facts
                 └─► 4  Shot frames (per shot) ← still + Looks + turnarounds + previous frame + camera fields
                          └─► 5  Clip (per reel) ← first/last frames + character elements + shot list + dialogue
                                   └─► the next reel's first frame (match cut)
6  Continuity check (later) ← derived facts vs the kept take
```

| Layer | Job kind | Text inputs | Reference inputs (role) | Output | Model class |
|---|---|---|---|---|---|
| 0 | — | art style prompt block, aspect, camera style | (optional) a style plate → `reference_style` | the style prefix | none |
| 1 | `character_look` | name, `appearance`, description fields, style prefix | none (or the uploaded portrait replaces the layer) | portrait, 3:4 | image |
| 1b | `character_turnaround` | "same person: front, three-quarter, profile, back, wardrobe close-up, neutral grey background, one sheet" | kept Look → `reference_character` | sheet, 16:9 | multi-reference image edit |
| 2 | `location_plate` | name, `sets.ts` reading (INT/EXT, times of day, described details), style prefix | none (or the uploaded photo) | plate, 16:9 | image |
| 3 | `scene_still` | heading facts (I/E, set, time of day → light), the set reading, the cast's names, extra prompt (if targeted), style prefix | plate → `reference_location`; each cast Look → `reference_character`; style plate | still, 16:9 | multi-reference image |
| 4 | `frame_generation` | the shot's camera fields (typed only), the description (mentions → names), scene facts, extra prompt, style prefix | still → `reference_still`; plate; each mentioned character's Look → `reference_character` + turnaround → `reference_turnaround`; previous shot's kept frame → `reference_previous`; Image cards by role; style plate | frame, 16:9 (or 9:16) | multi-reference image |
| 5 | `reel_render` | the shot list serialised (per-shot prompt + seconds), `dialogue[]`, extra prompt, style prefix | shot 1's kept frame → `first_frame`; last shot's kept frame → `last_frame`; each mentioned character's Look (+ turnaround) as elements → `reference_character`; previous reel's kept clip last frame → `first_frame` when match-cut | clip, `clip_seconds` | video with references + first/last frame (+ native audio) |
| 6 | (phase 5) | the derived facts | the kept take | findings rows | vision |

**The sync mechanism.** A character's kept Look is the single source of identity: its R2 key is
what every layer 3–5 job receives as `reference_character` for that character. The Turnaround adds
angles. The still adds this scene's light. The previous frame adds shot-to-shot continuity. The
clip's first frame *is* a kept frame, so the video starts from an image the writer has already
approved. Change the kept Look, the plate, the art style, the appearance line or a node in the
range, and every dependent output's `source_hash` no longer matches: it is **stale** (§6).

## 3. Prompt assembly (`apps/web/lib/production/prompt.ts` — pure, tested)

One function per kind, `assemble<Kind>(facts) → {prompt, negative, inputs}`. The output is stored
in `jobs.spec` exactly as sent, so takes are comparable and provenance is free.

### 3.1 Building blocks

- **Style prefix** = `artStyle.promptBlock.positive` + `, ` + camera style phrase (`academy`: "classical
  composed camera, tripod and dolly moves"; `handheld`: "handheld camera, natural sway, documentary
  immediacy") + `, ` + aspect phrase ("widescreen 16:9" / "vertical 9:16"). `None` → the camera and
  aspect phrases only.
- **Heading facts** (from the derived scene): `INT`/`EXT` → "interior" / "exterior"; set name; time
  of day → a light phrase (`DAWN` "cold pre-dawn light", `DAY` "daylight", `DUSK` "low warm dusk
  light, long shadows", `NIGHT` "night, practical and street light", `CONTINUOUS`/`LATER` → inherit
  the previous heading's). The `time-cues.ts` module already parses these words.
- **Set reading** (`packages/script/src/sets.ts`): what the script says about the set — quoted
  details become a comma list ("chain fence, puddles, floodlights").
- **Cast line**: "Characters present: Ade (seventeen, wiry, close-cropped hair…), Nia (…)" — each
  from the record's `appearance` else the description's first sentence; a character with no Look
  still gets its text (the text is the fallback identity).
- **Shot camera line** (frames only; **provenance rule**): a field contributes only when the shot's
  `origin = 'typed'` or the field was edited after proposal (the Storyboard editor marks edited
  fields — phase 1 adds `shots.edited_fields text[]` if the editor does not already track it; else
  the rule is `origin = 'typed'` only). Size → phrase ("wide shot" … "extreme close-up", "over the
  shoulder", "insert"); angle → ("eye level", "low angle", "high angle", "dutch angle", "overhead",
  "point of view"); movement → ("static", "handheld", "pan", "tilt", "dolly in", …); lens → "35mm
  lens". Fields still at the proposer's default are omitted — never injected.
- **Description**: the inline content flattened; `@mention` runs become the record's name; quoted
  speech is kept in quotes (the video model reads it as dialogue).
- **Extra prompt**: appended last when its target includes the kind.
- **Negative**: `artStyle.promptBlock.negative` + kind extras (frames: "text, caption, watermark,
  split screen, collage"; clips: "text, watermark, jump cut, morphing").

### 3.2 Templates

```
look:        {style prefix}. Character portrait of {name}: {appearance or description}. Head and shoulders,
             neutral expression, looking just off camera, plain background, cinematic key light. Single person.
turnaround:  {style prefix}. The same person as the reference, unchanged face and hair: a character sheet with
             five views — front, three-quarter, profile, back, and a close-up of the wardrobe — on one neutral
             grey sheet, evenly lit, no text.
plate:       {style prefix}. Establishing shot of {location name}, {interior/exterior}, {set reading}. No people.
             {time phrase of the most frequent time of day}.
still:       {style prefix}. {interior/exterior}, {set name}, {set reading}. {light phrase}. {cast line}.
             A single cinematic frame that establishes the space and the people in it. {extra}
frame:       {style prefix}. {camera line}. {description}. {light phrase}, {set name}. Same people, wardrobe
             and place as the references. {extra}
render:      (per shot, in order) Shot {i} ({seconds}s): {camera line}. {description}.
             (then) {light phrase}, {set name}. {cast line}. Dialogue: {name}: "{line}" … Continuous
             action, same people, wardrobe and place as the references. {extra}
```

### 3.3 Reference ranking and the cut

Inputs are assembled in priority order and cut to the candidate model's `refs.max`:

1. `reference_character` for each character **in this shot/still** (mentioned, else in the scene),
   kept Look first, then `reference_turnaround` for each;
2. `reference_still` (frames) / `reference_location` (still, frames);
3. `reference_previous` (frames);
4. Image cards by role (`reference_style`, `reference_location`, `reference_prop`);
5. `reference_style` (the style plate).

`first_frame` / `last_frame` are not references; they are slots and are never cut. When the cut
drops something, the job's `route.dropped[]` records it and the File view lists it ("Not sent: the
plate — this model takes 4 references").

## 4. The clip in detail (phase 3)

- **Mode**: if the tier's chosen candidate has `multiShot`, the whole reel is **one job**: the
  serialised shot list is the prompt (§3.2), `durationSeconds = clip_seconds`. Otherwise (`single`)
  the reel is *N* jobs chained last → first frame and concatenated by the worker — **phase 5**;
  until then a `single`-only tier refuses a multi-shot reel with "This tier renders one shot per
  clip — choose Standard or Cinema, or make the reel one shot". Said on the button.
- **Frames**: `first_frame` = shot 1's kept frame (or the anchor override); `last_frame` = the last
  shot's kept frame when `capabilities.firstLast`; with `match_last_frame` the previous reel's kept
  clip's extracted last frame (`reel_renders.poster_key` is the *first* frame; the worker also stores
  `last_frame_key`) replaces `first_frame`, and shot 1's kept frame moves to a `reference_still`.
- **Elements**: each mentioned character's Look (+ turnaround where `refs.kinds` allows) as
  `reference_character`. Models that bill per reference add `referenceSurchargeUsd` to the quote.
- **Dialogue**: the range's dialogue nodes with the character id; passed as `dialogue[]` in the
  spec and inlined in the prompt for models with `dialogue`; omitted from the prompt for silent
  tiers.
- **Output**: the worker downloads the MP4, extracts the first and last frames (a pure-JS/ffmpeg-
  free approach: request the poster from the provider where offered; otherwise phase 5's ffmpeg
  ruling), uploads all to R2, writes `reel_renders` with `clip_url` (legacy) and `poster_key`.

## 5. The provider adapter and the worker

### 5.1 Adapter interface (`apps/worker/src/providers/types.ts`)

```ts
export type Provider = {
  readonly id: 'fal' | 'google' | 'openai'
  quote(spec: JobSpec, c: Candidate): { usd: number; units: number }            // pure; from the registry
  submit(spec: JobSpec, c: Candidate, signal: AbortSignal): Promise<{ ref: string }>
  poll(ref: string, c: Candidate): Promise<{ status: 'queued' | 'running' | 'done' | 'failed'; progress?: number; position?: number }>
  fetchOutput(ref: string, c: Candidate): Promise<{ files: { url: string; mime: string; role: 'image' | 'video' | 'poster' }[]; seed?: number; costUsd?: number }>
  cancel(ref: string, c: Candidate): Promise<void>
  normaliseError(e: unknown): { code: JobErrorCode; message: string; writerMessage: string }
}
```

**fal** (phase 1, over plain `fetch`, no dependency): `POST https://queue.fal.run/{modelId}` with
the model's input JSON (prompt, `image_urls[]` for references — **signed R2 URLs**, 1 h, since the
provider must fetch them; the worker mints them), `→ {request_id}`; `GET …/requests/{id}/status`
(`IN_QUEUE` with `queue_position`, `IN_PROGRESS`, `COMPLETED`); `GET …/requests/{id}` for the
result (`images[]` / `video.url`); `PUT …/requests/{id}/cancel`. Auth `Authorization: Key ${FAL_KEY}`.
Moderation refusals arrive as a 4xx with a content-policy message → `moderation`. Verify the exact
endpoint ids and input field names on the vendor page when the registry rows are filled in.

**google** / **openai** (later): the same interface; Google's is a long-running operation polled by
name; both go behind the registry as further candidates.

### 5.2 The worker (`apps/worker/src/`)

BullMQ + ioredis (ruled). The queue entry carries **only** the job id; the `jobs` row is the truth
(the schema header already says so). Loop per job:

1. `claim` — `UPDATE jobs SET status='running', started_at=now(), attempt=attempt WHERE id=$1 AND
   status='queued' RETURNING *` (a job already taken or cancelled is a no-op).
2. `pick` — `pickCandidate(spec)` from the registry (pure); write `route`.
3. `mint` — signed R2 URLs for every `inputs[].key`.
4. `submit` → `provider_ref`; write it.
5. `poll` every 3 s (images) / 8 s (video), writing `progress` when given; honour
   `cancel_requested_at` (call `cancel`, then `cancelled` + release); timeout at 10 min images /
   30 min video → `failed` (`timeout`) + refund.
6. `fetchOutput` → download each file → `putObject` to R2 at
   `projects/<projectId>/production/<kind>/<jobId>[-poster].<ext>` → write the output row
   (`frame_generations` / `reel_renders` / `entity_generations` / `reel_stills`) with the key.
7. `settle` — `finished`, `finished_at`, `provider_cost_usd`; ledger `spend` = the quoted credits
   (settle to actual only if the provider reports a lower unit count — never more than the hold).
8. On a provider error: `failed`, `error` (the writer's message), ledger `refund`
   (`refund:job:<id>`), and the output row's `refund_entry_id`. On moderation: `blocked`,
   `blocked_reason` in the writer's terms, ledger release. Retries: none automatic for
   `moderation`/`invalid_input`; one automatic retry for `provider_error`/`timeout` (attempt 2) before
   `failed`.
9. **Sweeper** (a repeat job every 5 min): `running` jobs with `started_at < now() - 15 min` and no
   poll write in 5 min → back to `queued` with `attempt + 1`, or `failed` at attempt 3.

Idempotency: every ledger write uses `<kind>:job:<id>`; every output write is `ON CONFLICT (job_id)
DO NOTHING`; the worker may run twice for a job and the second pass finds nothing to do.

**Reserve race**: the reserve statement in the repositories wraps its balance check and insert in
`pg_advisory_xact_lock(hashtext(project_id::text))` so two clicks on the last credits serialise
(the READ COMMITTED race flagged in both repos).

### 5.3 Env and gating

`packages/db/src/env.ts` gains an all-or-none block `workerEnv`: `REDIS_URL`, `FAL_KEY` (+
`FAL_MODEL_OVERRIDES` optional JSON for dev). `.env.example` documents each (where it comes from,
who reads it). Unset in web → `workerEnv === null` → every `✦` is drawn disabled with "No worker
connected — set REDIS_URL and FAL_KEY". The worker refuses to start without the block **and**
`storageEnv`. `pnpm build`'s `assert-no-server-secrets` must stay green: the names are listed in
its server-secret set.

### 5.4 Client updates

No realtime. The route polls `readJobStates(episodeId)` every 3 s while any job of the episode is
`queued`/`running`, and stops when none is; each tile folds from the fresh rows. Completions raise
a toast once (`Shot 3 drawn`).

## 6. Staleness (`apps/web/lib/production/hash.ts` — pure, tested)

`sourceHashFor(kind, facts)` = sha256 hex over a canonical JSON of, per kind:

| Kind | Hashed |
|---|---|
| look | `characters.appearance`, the description fields used, art style id, camera style |
| turnaround | the kept Look's key, art style id |
| plate | the location's name, the `sets.ts` reading, art style id, camera style |
| still | the scene's node texts (the reel range), heading facts, the plate key, each cast Look key, extra prompt, art style id, aspect, camera style |
| frame | the shot's fields + description text, the still key, the plate key, each mentioned Look/turnaround key, the previous kept frame key, Image card keys, extra prompt, art style id, aspect, camera style |
| render | the reel's shots (fields, descriptions, seconds, kept frame keys), dialogue texts, each Look key, continuity mode + the previous kept clip's last-frame key, extra prompt, settings |

At read, the fold recomputes the hash from current state and compares it with the row's; a
mismatch marks the take `stale` and lists **reasons** by recomputing per component ("line 9",
"Ade's look", "the art style", "the plate", "the still", "shot 2's frame"). Stale never blocks and
never deletes. The Performance card's amber line appears when any of the reel's kept outputs is
stale for a text reason.

## 7. Moderation

The adapter maps the provider's refusal to `{code: 'moderation', writerMessage}` with the category
in plain words (violence, sexual content, real person, minors, hate); the worker writes `blocked`
with `blocked_reason = "The model refused this shot: violence. Rewrite the shot or remove the
blood."` (the detail is the provider's phrase when it gives one, else omitted). The hold is released
(a `release` row, not a `refund`). The row's `Suggest rewrite` opens the assistant with the refusal
as the question (built).

## 8. Cost

- **Quote at click**: `quoteJob(spec)` = `ceil(candidate.unitPrice.usd × units × MARGIN ÷
  CREDIT_USD)` + reference surcharge; printed on the button. Video units = `clip_seconds`; image
  units = 1; a turnaround = 1 sheet.
- **Hold on submit**: the existing reserve-then-execute statement (one statement, `available >=
  cost`), now under the advisory lock.
- **Settle on finish**: `spend` = the hold (or the provider-reported lower amount).
- **Refund on failure / release on cancel-while-queued or blocked**; cancel-while-running per D-9.
- **"Likely 2–3 versions"**: the clip button prints `lo = 2 × quote`, `hi = 3 × quote`; frames print
  the single quote (the take model makes retries explicit).
- **Registry hygiene**: every candidate has `pricedAt`; the worker logs a warning when older than 30
  days; `provider_cost_usd` on every job makes margin a query.
- `CREDIT_USD` and `MARGIN` are two constants beside the registry — decision D-4 sets them; until
  then they are `0.01` and `2.2` with a `// PLACEHOLDER` comment, as `FRAME_GENERATION_COST` was.

## 9. Testing

- **Pure units** (`apps/web/tests/`): `prompt.test.ts` (every template, the provenance rule, the
  ranking cut, the dropped list), `hash.test.ts` (each kind, each reason), `quote.test.ts`,
  `registry.test.ts` (`pickCandidate` per capability), `status.test.ts` extended (stale, progress,
  gate, versions).
- **Adapter contract** (`apps/worker/tests/fal.test.ts`): recorded fixtures for submit / status /
  result / cancel / a moderation 4xx; `normaliseError` table.
- **Worker integration**: a fake provider (in-memory) driving `claim → finished` and
  `claim → blocked` and `claim → timeout → refund` against a test database, asserting the ledger
  rows and the output rows; the sweeper.
- **E2E** (`apps/web/e2e/production-route.spec.ts`, rewritten): the decisive walk of the PRD §12,
  runnable with a fake-provider worker in CI and the real one by hand.
