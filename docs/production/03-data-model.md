# 03 — Data model, contracts and the registry

Everything the Production feature stores, in the repo's own terms. Read `packages/db/CLAUDE.md`
before writing a migration (which migrations are applied to the dev project, the drizzle-kit traps).
Latest migration at the time of writing: `0023` (timeline findings). This feature adds `0024`,
`0025`, `0026` — one per build phase, forward-only.

## 1. Principles (from `AGENTS.md` and `packages/db/src/schema/index.ts`)

- Every table carries `project_id`; every query goes through a project-scoped repository.
- **Classification**: each table is AUTHORED (the writer's), DERIVED (a re-derivable cache), a JOB
  (the queue's truth), or the LEDGER. Generation outputs are AUTHORED-by-job rows: which job made
  them and the writer's keep decision are facts that must survive re-derivation.
- **Nothing stored that can be computed**: reel/shot status, staleness, counts and the balance are
  folded at read. Only `source_hash` is stored (it is an input, not a derivation — it records what
  the job *saw*).
- **Keys, not URLs**: every new storage column stores an R2 object key (`portrait_key` and
  `photo_key` already do); the URL is composed at read. The three legacy URL columns
  (`shots.frame_upload_url`, `frame_generations.frame_url`, `reel_renders.clip_url`) stay as they are
  until a separate data migration is ruled (D-14).
- **No foreign key to `nodes`** for `scene_node_id`, `from_node_id`, `to_node_id`: a heading that
  leaves by undo and comes back finds its reels (the existing rule).
- A new enum value is `ALTER TYPE … ADD VALUE`; a dropped column needs a ruling.

## 2. What exists and is kept (migrations `0006`, `0007`, `0014`, `0020`)

| Table | Class | Kept as | Notes |
|---|---|---|---|
| `shots` | AUTHORED | is | `reel_id`, `canvas_x/y`, `frame_upload_url`, the closed vocabularies, `origin`, `state` |
| `jobs` | JOB | extended (§3.1) | status enum `queued · running · finished · failed · blocked · cancelled`; `cost`, `payload`, `cancel_requested_at`, `error`, `blocked_reason` |
| `frame_generations` | AUTHORED (job output) | is | one per job; `kept_at` partial unique per shot; `refund_entry_id` |
| `reels` | AUTHORED | extended (§3.4) | `scene_node_id`, `order_key`, `name`, `clip_seconds`, `finalized_at` |
| `reel_renders` | AUTHORED (job output) | extended (§3.5) | one per job; `clip_url`; `refund_entry_id` |
| `credit_ledger` | LEDGER | is | kinds `grant · purchase · reserve · release · spend · refund · expire · adjust`; balance = the `credit_balances` view / `readBalance` |
| `projects.render_resolution` | AUTHORED | is | `720p \| 1080p`; folded into film settings (§3.6) |
| `characters.portrait_key`, `locations.photo_key` | AUTHORED | is | the "no AI" upload path; wins over generations until cleared |

## 3. Changes and additions

### 3.1 `jobs` — extended (migration `0024`)

| Column | Type | Meaning |
|---|---|---|
| `kind` | `job_kind` enum | + `character_look`, `character_turnaround`, `location_plate`, `scene_still` (phase 1/2); + `tts`, `lipsync`, `upscale` (phase 5) |
| `spec` | `jsonb not null default '{}'` | the provider-neutral request (§5). Replaces the ad-hoc `payload` for new kinds; `payload` stays for the two existing kinds until phase 3 moves them |
| `route` | `jsonb` | what the worker chose at submit: `{provider, modelId, unitPrice, capabilities}` — audit, never read by the UI except the File view |
| `provider_ref` | `text` | the provider's request id; unique per provider (index) |
| `progress` | `integer` | 0–100, null when the provider gives none |
| `attempt` | `integer not null default 1` | incremented by the sweeper |
| `provider_cost_usd` | `numeric(10,4)` | the actual, from the provider's response or the registry's unit price × units |
| `parent_job_id` | `uuid references jobs(id) on delete set null` | lineage for redraw / turnaround / reshoot (phase 5 uses it; add now, cheap) |
| `source_hash` | `text` | sha256 hex of what the job saw ([04](04-generation-pipeline.md) §6); indexed with `project_id` |

Checks: `progress between 0 and 100`; `attempt >= 1`. Index `(project_id, kind, status)`.

### 3.2 `entity_generations` — new (migration `0024`) · AUTHORED (job output)

A character Look / Turnaround or a location plate, as `frame_generations` is for a shot.

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid | |
| `project_id` | uuid → projects, cascade | |
| `entity_kind` | `entity_kind` enum `character \| location` | |
| `entity_id` | uuid | the record's id (checked in the repository against the kind; no polymorphic FK) |
| `role` | `entity_generation_role` enum `look \| turnaround \| plate` | `plate` only with `location`, `look`/`turnaround` only with `character` (check) |
| `job_id` | uuid → jobs, restrict, unique | |
| `image_key` | text | R2 key; null until finished |
| `refund_entry_id` | uuid → credit_ledger, set null | |
| `kept_at` | timestamptz | partial unique on `(entity_id, role) where kept_at is not null` |
| `created_at` | | |

Indexes: `(entity_id, role, created_at)`, `(project_id)`. On character/location delete: cascade via
a repository delete (no FK to two tables); the job rows stay.

### 3.3 `reel_stills` — new (migration `0025`) · AUTHORED (job output)

`reel_id → reels cascade`, `job_id → jobs restrict unique`, `image_key`, `refund_entry_id`,
`kept_at` (partial unique per reel), `created_at`. Index `(reel_id, created_at)`.

### 3.4 `reels` — extended (migration `0025`)

| Column | Type | Meaning |
|---|---|---|
| `from_node_id`, `to_node_id` | uuid, nullable, no FK | the range; both or neither (check); null = whole scene; non-overlap within a scene is a repository check |
| `continuity` | `continuity_mode` enum `natural \| match_last_frame`, default `natural` | |
| `anchor_generation_id` | uuid → frame_generations, set null | null = "shot 1's kept frame" (the default fold); set only when the writer picks another take as anchor |
| `extra_prompt` | text | the Extra prompt card |
| `extra_prompt_targets` | `text[]` default `{still,frames,clip}` | |
| `layout` | `jsonb not null default '{}'` | `{cards: [{id, kind: 'performance'\|'shots'\|'scene'\|'cast'\|'clip'\|'extra'\|'image', x, y, characterId?, extra?, key?, role?}]}` — cosmetic; validated by `ReelLayoutSchema` |
| `clip_seconds` | is | the CHECK constraint against `CLIP_SECONDS` is **dropped in `0026`** and replaced by validation against the registry (D-6) |

### 3.5 `reel_renders` — extended (migration `0026`)

`kept_at timestamptz` + partial unique on `(reel_id) where kept_at is not null` (the version pointer);
`poster_key text` (the first frame the worker extracts, for thumbnails; null → the anchor).

### 3.6 `projects.production_settings` — new column (migration `0024`) · AUTHORED

`jsonb not null default '{}'` validated by `FilmSettingsSchema`:
`{artStyle: ArtStyleId | null, aspect: '16:9' | '9:16', cameraStyle: 'academy' | 'handheld',
qualityTier: 'draft' | 'standard' | 'cinema'}`. `render_resolution` stays a column (it exists and
is checked). Decision D-10 lets this become four columns instead; the schema module is the one
place to change.

### 3.7 `characters.appearance` — new column (migration `0024`)

`text` — the one-line appearance prompt. Saved with the sheet. Part of the Look's `source_hash`.

## 4. Enums (in `packages/contracts/src/enums.ts`, mirrored as `pgEnum`s)

```ts
export const JOB_KINDS = ['frame_generation', 'reel_render', 'character_look', 'character_turnaround', 'location_plate', 'scene_still'] as const   // + 'tts' | 'lipsync' | 'upscale' in phase 5
export const ENTITY_KINDS = ['character', 'location'] as const
export const ENTITY_GENERATION_ROLES = ['look', 'turnaround', 'plate'] as const
export const CONTINUITY_MODES = ['natural', 'match_last_frame'] as const
export const QUALITY_TIERS = ['draft', 'standard', 'cinema'] as const
export const ASPECTS = ['16:9', '9:16'] as const
export const CAMERA_STYLES = ['academy', 'handheld'] as const
export const REFERENCE_ROLES = ['reference_character', 'reference_turnaround', 'reference_location', 'reference_still', 'reference_previous', 'reference_style', 'reference_prop', 'first_frame', 'last_frame', 'source_image'] as const
export const JOB_ERROR_CODES = ['moderation', 'invalid_input', 'provider_error', 'timeout', 'quota', 'cancelled'] as const
```

`JOB_STATUSES` is unchanged. `CLIP_SECONDS` stays exported as the *default* set; the allowed set at
runtime is `registry.video[tier].clipSeconds` (D-6).

## 5. The job `spec` and `route` (Zod, `packages/contracts/src/generation.ts`)

```ts
const InputSchema = z.object({
  role: z.enum(REFERENCE_ROLES),
  key: z.string(),                 // R2 key
  entityId: z.string().uuid().optional(),   // the character/location/generation it came from
  label: z.string(),               // "Ade — look" (for the File view's chips)
})

const SpecCommon = z.object({
  version: z.literal(1),
  kind: z.enum(JOB_KINDS),
  tier: z.enum(QUALITY_TIERS),
  aspect: z.enum(ASPECTS),
  settings: FilmSettingsSchema,    // snapshot
  prompt: z.string(),              // the assembled text, as sent
  negative: z.string().optional(),
  inputs: z.array(InputSchema),    // ranked, already cut to refs.max
  sourceHash: z.string(),          // duplicated on the row for the index
  seed: z.number().int().optional(),
})

export const FrameSpecSchema  = SpecCommon.extend({ kind: z.literal('frame_generation'), shotId, resolution: z.enum(RENDER_RESOLUTIONS) })
export const StillSpecSchema  = SpecCommon.extend({ kind: z.literal('scene_still'), reelId, resolution })
export const LookSpecSchema   = SpecCommon.extend({ kind: z.literal('character_look'), characterId })
export const TurnaroundSpecSchema = SpecCommon.extend({ kind: z.literal('character_turnaround'), characterId })
export const PlateSpecSchema  = SpecCommon.extend({ kind: z.literal('location_plate'), locationId })
export const RenderSpecSchema = SpecCommon.extend({
  kind: z.literal('reel_render'), reelId,
  durationSeconds: z.number().int(), resolution,
  shots: z.array(z.object({ shotId, seconds: z.number().int(), prompt: z.string() })),   // serialised in order
  dialogue: z.array(z.object({ characterId, name: z.string(), text: z.string() })),
  continuity: z.enum(CONTINUITY_MODES),
  mode: z.enum(['multi_shot', 'single']),   // what the registry allowed
})
export const JobSpecSchema = z.discriminatedUnion('kind', [...])

export const JobRouteSchema = z.object({
  provider: z.string(), modelId: z.string(), unitPrice: z.number(), unit: z.enum(['image', 'second', 'sheet']),
  capabilities: CapabilitiesSchema, quotedCredits: z.number().int(), chosenAt: TimestampSchema,
})
```

`payload` for the two existing kinds (`{shotId}`, `{reelId}`) keeps working in phase 1; phase 3
writes `spec` for renders and phase 1 writes `spec` for frames alongside `payload`.

## 6. The registry (`packages/contracts/src/generation-registry.ts`)

One `const`, typed, the **only** place a model id appears. Shape:

```ts
type Capabilities = {
  imageToVideo: boolean; firstLast: boolean; multiShot: boolean; nativeAudio: boolean; dialogue: boolean;
  refs: { max: number; kinds: ReferenceRole[] };
  maxDurationSeconds: number; clipSeconds: readonly number[]; resolutions: RenderResolution[]; aspects: Aspect[];
}
type Candidate = {
  provider: 'fal' | 'google' | 'openai';   // adapters that exist
  modelId: string;                          // the provider's endpoint id — verify on the vendor page before shipping
  capabilities: Capabilities;
  unitPrice: { usd: number; unit: 'image' | 'second' | 'sheet' };
  referenceSurchargeUsd?: number;           // per reference image where billed
  moderationProfile: 'strict' | 'standard';
  deprecatesOn?: string;                    // ISO date; the worker logs a warning within 30 days
}
export const REGISTRY: { [K in 'image' | 'video']: { [T in QualityTier]: Candidate[] } }
```

Rules: candidates are tried in order (the first whose capabilities satisfy the spec wins); the
quote is `ceil(usd × MARGIN ÷ CREDIT_USD)` where `CREDIT_USD` and `MARGIN` are two constants beside
the registry — **their values are decision D-4**. `quoteJob(spec)` and `pickCandidate(spec)` are pure
and tested. The initial rows (placeholders — ids from the 2026-09-18 sweep, unverified):

| Kind · tier | Provider · model class | Why |
|---|---|---|
| image · draft | fal · a fast multi-reference image editor (Nano-Banana-class, up to 14 refs) | cheap frames, refs for identity |
| image · standard | fal · the same at higher resolution | the default |
| image · cinema | fal · a Pro-class multi-reference model (2K) or FLUX.2-class edit | hero frames, stills, Looks |
| video · draft | fal · a lite image-to-video model, 5–10 s, silent | proofs |
| video · standard | fal · a reference/element-capable model, 5–15 s, first+last frame, native audio, `multiShot` | the default reel |
| video · cinema | fal or google · the top reference-capable model with dialogue | finals |

## 7. Art styles (`packages/contracts/src/art-styles.ts`) — data, verbatim names

`ArtStyle = {id, name, era, notableWorks: [3], traits, promptBlock: {positive: string, negative:
string}, swatch: [3 oklch strings]}`. The twelve, with the prompt blocks this feature ships (the
names, eras, works and traits are Laper's presets as the user supplied them; the prompt blocks are
ours):

| id | name | era | notable works | traits (verbatim) | promptBlock.positive (ours) |
|---|---|---|---|---|---|
| `netflix_prestige` | Netflix Prestige Drama | 2010s – 2020s | Stranger Things · Mindhunter · The Crown | Restrained, refined, low-saturation contemporary streaming texture, precisely controlled light and shadow, an effortless high-budget cinematic feel throughout. | "contemporary prestige drama, restrained low-saturation grade, controlled soft key and deep clean shadows, shallow depth of field, anamorphic-clean digital cinema, high-budget streaming look" |
| `wes_anderson` | Wes Anderson Symmetrical Fairytale | 2000s – 2010s | The Royal Tenenbaums · The Life Aquatic · The Grand Budapest Hotel | Obsessive symmetry and pastels, a retro toy-box precision and ritual, flat, cute, meticulous to the last detail. | "centred symmetrical composition, planimetric staging, pastel palette, flat even lighting, meticulous production design, storybook precision" |
| `hk_neon_noir` | Hong Kong Neon Modernism / Pre-Wong Kar-wai | 1990s – 2000s | Chungking Express · Fallen Angels · Happy Together | Humid, ambiguous neon reflections, loneliness and desire drifting through suspended time, a lyrical, detached Eastern urban poetry. | "humid night city, neon reflections on wet streets, handheld intimacy, step-printed motion blur, saturated cyan and magenta, lonely urban poetry" |
| `cyberpunk` | Cyberpunk / Neon Futurism | 1980s – 1990s | Blade Runner · Tron · Brazil | A dystopia of high tech and low life, blue-violet neon soaking the rainy night, technological oppression and the suffocating density of the city. | "rain-soaked neon dystopia, blue-violet light, dense vertical city, volumetric haze, high-tech low-life, oppressive scale" |
| `new_hollywood` | New Hollywood / Modern American Realism | 1970s | The Graduate · Taxi Driver · Kramer vs. Kramer | Gritty, world-weary American realism, faded warm-yellow film grain, adult social pressure and loneliness. | "1970s American realism, faded warm-yellow 35mm film grain, available light, long lenses, unglamorous locations, world-weary intimacy" |
| `french_new_wave` | French New Wave | 1960s | The 400 Blows · Breathless · Jules and Jim | Light, free, improvised, an anti-polished street-level breath, young and relaxed freshness under natural light. | "black-and-white or muted 1960s street realism, handheld natural light, improvised framing, jump-cut energy, youthful looseness" |
| `italian_neorealism` | Italian Neorealism | 1940s – 1950s | Rome, Open City · Bicycle Thieves · Umberto D. | The documentary weight of postwar poverty, rough truth under pure natural light, human warmth carried through hard times. | "postwar documentary realism, black-and-white, pure natural light, non-actors' faces, worn locations, human warmth under hardship" |
| `film_noir` | Film Noir | 1940s | Double Indemnity · The Third Man · The Big Sleep | High-contrast black-and-white fatalism, hard light and heavy shadow slicing the frame, a smoke-wreathed midnight menace. | "high-contrast black-and-white, hard key light, venetian-blind shadows, deep blacks, wet night streets, cigarette smoke, fatalistic menace" |
| `golden_age_deco` | Hollywood Golden Age / Art Deco Studio Glamour | 1930s – 1940s | Grand Hotel · Top Hat · The Wizard of Oz | Lavish symmetrical studio fantasy, gilded geometric ornament, a palatial golden aura under soft star lighting. | "1930s studio glamour, soft star lighting, art deco ornament, gilded symmetrical sets, glossy three-strip colour or silvery black-and-white" |
| `german_expressionism` | German Expressionism | 1920s | The Cabinet of Dr. Caligari · Nosferatu · Metropolis | Distorted, tilting nightmare architecture, knife-cut hard shadows, inner fear externalized into imbalance and oppression. | "1920s expressionism, painted distorted sets, tilted angles, knife-edged shadows, black-and-white, theatrical menace" |
| `anime` | Anime Cinematic Style | 1980s – Now | Spirited Away · Your Name · Ghost in the Shell | Clean, translucent cel-shaded light, a bright and poetic emotional space, young, gentle and full of breath. | "cinematic anime, clean cel shading, translucent light and lens flares, painted backgrounds, bright poetic colour, gentle emotional space" |
| `graphic_novel` | Graphic Novel Style | 1980s – Now | Spider-Man: Into the Spider-Verse · Batman: The Animated Series · Sin City | Bold outlines and strong color blocks, the dramatic tension of exaggerated perspective, the hard-edged impact of a single. | "graphic novel illustration, bold ink outlines, flat strong colour blocks, exaggerated perspective, halftone texture, hard-edged panels" |

`promptBlock.negative` for the photographic styles: "cartoon, illustration, text, watermark, extra
limbs, deformed hands"; for the two drawn styles: "photorealistic, photograph, text, watermark".
`None` = no prefix. The Cast card's swatch strip is `swatch` (three oklch values per style, chosen
when the mockups are drawn).

## 8. Read model (contracts, `packages/contracts/src/production.ts`, extended)

- `TakeSchema` + `stale: boolean`, `staleReasons: string[]`, `progress: number | null`,
  `provenance: {parentGenerationId, seed, heldCredits, chargedCredits, refundEntryId}`,
  `inputs: InputSchema[]` (for the File view; from the job's `spec`).
- `ProductionShotSchema` + `waitingOn: shotId | null`.
- `ReelRowSchema` + `range`, `continuity`, `still: StillState`, `anchor: {generationId, key} | null`,
  `versions: Version[]` (each `{renderId, clip: ClipState, kept, posterKey, stale, createdAt}`),
  `gate: {required: GateItem[], recommended: GateItem[]}`, `quote: {startShooting: {credits, lo, hi}
  | null, generateFrames: {credits, count} | null, still: number}`, `layout`.
- `ProductionSceneSchema` + `status: SceneStatus`, `range nodes` are read by the Performance card
  through the existing script read (`loadEpisode`), not duplicated here.
- `FilmSettingsSchema`, `EntityGenerationSchema`, `ReelStillSchema`, `JobRowSchema` (for the Tasks
  panel: kind, target label, status, progress, cost, createdBy, createdAt, blockedReason, error).

## 9. Repository surface (per phase; all in `packages/db/src/repositories/`)

**Phase 1** — `generation.ts` (new): `queueEntityGeneration(kind, entityId, role, spec, cost)`
(the reserve-then-execute CTE, the `queueFrameGeneration` shape); `listEntityGenerations(entityId,
role)`; `keepEntityGeneration`; `deleteEntityGeneration` (never the kept). `jobs.ts` (new, split
from `storyboard.ts`): `claimNextJob()` (`FOR UPDATE SKIP LOCKED` — used by the worker even with
BullMQ, to make the row the truth), `startJob`, `progressJob`, `finishJob(outputWrite)`,
`failJob(+refund)`, `blockJob(reason, +release)`, `cancelJob` (exists), `sweepStuckJobs(15 min)`;
`credits.ts`: `spendForJob`, `refundForJob` (idempotent keys `spend:job:<id>` / `refund:job:<id>`).
`storyboard.ts`: `queueFrameGeneration(s)` gains `spec`; the advisory lock
(`pg_advisory_xact_lock(hashtext(project_id))`) inside the reserve statement.

**Phase 2** — `production.ts`: `readProductionScene` extended (stills, gate inputs, layout,
range); `setReelRange` (with the non-overlap check), `setReelContinuity`, `setReelLayout`,
`setReelExtraPrompt`, `queueSceneStill`, `keepReelStill`, `autoAssignReels(sceneNodeId, clipSeconds)`
(one statement per reel created + the `shots.reel_id` updates in one transaction).

**Phase 3** — `queueReelRender` gains `spec`; `keepReelRender`, `deleteReelRender`; `readPreviousKeptClip(reelId)`.

**Phase 4** — `listJobs(projectId, filters)` for the Tasks panel; `setFilmSettings` (projects).

## 10. Contracts to add (`packages/contracts/src/`)

`generation.ts` (§5), `generation-registry.ts` (§6), `art-styles.ts` (§7), `film-settings.ts`
(`FilmSettingsSchema`, `FilmSettingsEditSchema`), `production.ts` extensions (§8), `enums.ts`
additions (§4), and the ids `EntityGenerationIdSchema`, `ReelStillIdSchema`. Every new type flows
from here; nothing is redeclared downstream.

## 11. Migration outline

- **`0024_production_generation.sql`** (phase 1): `ALTER TYPE job_kind ADD VALUE` ×4; `ALTER TABLE
  jobs ADD COLUMN spec, route, provider_ref, progress, attempt, provider_cost_usd, parent_job_id,
  source_hash` + checks + indexes; `CREATE TYPE entity_kind, entity_generation_role`; `CREATE TABLE
  entity_generations` + indexes; `ALTER TABLE projects ADD COLUMN production_settings`; `ALTER TABLE
  characters ADD COLUMN appearance`.
- **`0025_production_reels.sql`** (phase 2): `CREATE TYPE continuity_mode`; `ALTER TABLE reels ADD
  COLUMN from_node_id, to_node_id, continuity, anchor_generation_id, extra_prompt,
  extra_prompt_targets, layout` + the both-or-neither check; `CREATE TABLE reel_stills`.
- **`0026_production_versions.sql`** (phase 3): `ALTER TABLE reel_renders ADD COLUMN kept_at,
  poster_key` + partial unique; `ALTER TABLE reels DROP CONSTRAINT reels_clip_seconds_allowed`
  (a dropped constraint, not a dropped column — still logged as a ruling, D-6).

`drizzle-kit generate` needs a TTY on drop+create (the memory trap) — use `drizzle-kit/api` or write
the SQL by hand in the house style (a header comment explaining every statement, `--> statement-breakpoint`).
