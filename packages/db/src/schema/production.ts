import { CLIP_LENGTHS } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { assets } from './assets'
import { createdAtColumn, idColumn, projectIdColumn, timestampColumn, updatedAtColumn } from './columns'
import { characters, locations } from './derived'
import {
  aspectRatioEnum,
  boardViewEnum,
  cameraMotionEnum,
  cameraStyleEnum,
  clipStateEnum,
  continuityEnum,
  descriptionPartKindEnum,
  frameStateEnum,
  generationJobEnum,
  generationStateEnum,
  generationTargetEnum,
  intExtEnum,
  lightingEnum,
  noteTargetEnum,
  pacingEnum,
  priorityEnum,
  productionTypeEnum,
  reelStatusEnum,
  sheetStateEnum,
  shotCharacterSourceEnum,
  shotStatusEnum,
  shotTypeEnum,
  sortModeEnum,
  statusFilterEnum,
} from './production-enums'
import { episodes, projects, users } from './tenancy'

/**
 * The Production route, v12 - `docs/production/production.md` §7, table for
 * table, with the deviations each header names. All AUTHORED, or written by
 * the system on a click (`generations`, `activity_log`).
 *
 * ## The vocabulary is the spec's
 *
 * Every enum here is one of `production-enums.ts`, the spec's §6 values as
 * Postgres enums; every column is the spec's field id in `snake_case`. Two
 * names differ, on purpose:
 *
 *   - `reel_shots` is the spec's `shots`. The Storyboard owns `shots` and
 *     its own vocabulary (`ews | ws | …`), and stays untouched by the
 *     client's ruling (2026-09-22); Production's shots are their own table
 *     with the spec's `shot_type` / `camera_motion` / `camera_body` / `lens`.
 *   - `scene_node_id` is the spec's `scene_id`. A scene here is its heading
 *     node's id (AGENTS.md open decision 10), keyed with **no foreign key to
 *     `nodes`** exactly as `scenes` and the Storyboard's `shots` are, so a
 *     heading that leaves by undo and comes back finds its reels.
 *
 * ## What is stored and what is folded
 *
 * `reels.status` is a column (the spec's), moved by the repository: `writing`
 * until a shoot is queued, `generating` while it runs, `rendered` when the
 * clip lands, `stale` when a shot of a rendered reel changes. A shot's
 * `status` is **null unless the writer overrode it** - the menu writes the
 * override, `derive.ts` computes the rest in the spec's order (blocked →
 * refused, proposed, then from `frame_state`). Used seconds, readiness,
 * widths and the scene dot are never columns.
 *
 * `position` is `numeric`, the spec's fractional order: a move is one row's
 * update to the midpoint of its new neighbours. Not the node list's text
 * `order_key` - the spec names the column and its type.
 *
 * ## Credits
 *
 * A generation reserves on the ledger (`credit_ledger`, `reserve`, keyed on
 * the generation's id in `job_id` - the ledger predates this table and its
 * column name stays), spends on success, refunds on failure or refusal,
 * releases on cancel. `credits_reserved` / `credits_charged` on the row
 * mirror those entries for the read; the ledger is the truth and the
 * balance is computed from it, never stored (AGENTS.md).
 */

// ---------------------------------------------------------------------------
// Episode-level: settings and art styles
// ---------------------------------------------------------------------------

export const artStyles = pgTable(
  'art_styles',
  {
    id: idColumn(),
    /** `netflix-prestige-drama`. Unique across presets and projects. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    era: text('era').notNull(),
    referenceFilms: text('reference_films').array().notNull().default(sql`ARRAY[]::text[]`),
    description: text('description').notNull().default(''),
    /** A CSS gradient for the reference plate. */
    plateGradient: text('plate_gradient').notNull().default(''),
    isPreset: boolean('is_preset').notNull().default(false),
    /** Null = a global preset (the 14 the migration seeds). Set = a project's own. */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('art_styles_key_key').on(table.key),
    index('art_styles_project_idx').on(table.projectId),
    /** A preset belongs to no project; a project's style is not a preset. */
    check('art_styles_preset_is_global', sql`(${table.isPreset}) = (${table.projectId} IS NULL)`),
  ],
)

export const episodeSettings = pgTable(
  'episode_settings',
  {
    episodeId: uuid('episode_id')
      .primaryKey()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    aspectRatio: aspectRatioEnum('aspect_ratio').notNull(),
    productionType: productionTypeEnum('production_type').notNull(),
    cameraStyle: cameraStyleEnum('camera_style').notNull(),
    pacing: pacingEnum('pacing').notNull(),
    lighting: lightingEnum('lighting').notNull(),
    artStyleId: uuid('art_style_id')
      .notNull()
      .references(() => artStyles.id, { onDelete: 'restrict' }),
    /** Set by the first successful shoot. Every write refuses after. */
    lockedAt: timestampColumn('locked_at'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index('episode_settings_project_idx').on(table.projectId)],
)

// ---------------------------------------------------------------------------
// Reels and shots
// ---------------------------------------------------------------------------

export const reels = pgTable(
  'reels',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    /** The heading node's id. Not a foreign key - see the header. */
    sceneNodeId: uuid('scene_node_id').notNull(),
    name: text('name').notNull(),
    clipLengthS: smallint('clip_length_s').notNull().default(15),
    continuity: continuityEnum('continuity').notNull().default('natural'),
    status: reelStatusEnum('status').notNull().default('writing'),
    finalized: boolean('finalized').notNull().default(false),
    position: numeric('position', { precision: 30, scale: 15, mode: 'number' }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: timestampColumn('deleted_at'),
  },
  (table) => [
    index('reels_project_scene_position_idx').on(table.projectId, table.sceneNodeId, table.position),
    check('reels_name_not_empty', sql`length(btrim(${table.name})) > 0`),
    check(
      'reels_clip_length_allowed',
      sql`${table.clipLengthS} = any(${sql.raw(`ARRAY[${CLIP_LENGTHS.join(', ')}]::smallint[]`)})`,
    ),
  ],
)

export const reelShots = pgTable(
  'reel_shots',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    reelId: uuid('reel_id')
      .notNull()
      .references(() => reels.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    position: numeric('position', { precision: 30, scale: 15, mode: 'number' }).notNull(),
    title: text('title'),
    /** Whole seconds, 1–15 (the menu's presets, or any second the timing bar's drag lands on), or null for `none`. */
    durationS: smallint('duration_s'),
    /** The writer's override. Null = derive (`apps/web/lib/production/derive.ts`). */
    status: shotStatusEnum('status'),
    shotType: shotTypeEnum('shot_type').notNull().default('Medium'),
    cameraAngle: text('camera_angle').notNull().default('Eye level'),
    cameraMotion: cameraMotionEnum('camera_motion').notNull().default('Still'),
    cameraBody: text('camera_body').notNull().default(''),
    lens: text('lens').notNull().default(''),
    /** The description as plain text; `shot_description_parts` holds the same text as runs. */
    description: text('description').notNull().default(''),
    dialogue: text('dialogue'),
    proposed: boolean('proposed').notNull().default(false),
    blocked: boolean('blocked').notNull().default(false),
    blockReason: text('block_reason'),
    prop: text('prop'),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    intExt: intExtEnum('int_ext'),
    shootDate: date('shoot_date'),
    notes: text('notes'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    priority: priorityEnum('priority').notNull().default('none'),
    frameState: frameStateEnum('frame_state').notNull().default('empty'),
    frameAssetId: uuid('frame_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    frameProgress: smallint('frame_progress'),
    frameKept: boolean('frame_kept').notNull().default(false),
    takeIndex: integer('take_index').array(),
    /**
     * The drawer's References row: assets of kind `reference` the writer
     * uploaded for this shot (the client's ruling on the `＋`, 2026-09-22).
     * Not in the spec's `shots`; an id list rather than a join table because
     * a reference belongs to one shot and is deleted with it.
     */
    referenceAssetIds: uuid('reference_asset_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: timestampColumn('deleted_at'),
  },
  (table) => [
    /** The spec's `unique (reel_id, number)` - over the live rows, so a deleted shot's number is free again. */
    uniqueIndex('reel_shots_reel_number_key')
      .on(table.reelId, table.number)
      .where(sql`${table.deletedAt} IS NULL`),
    index('reel_shots_reel_position_idx').on(table.reelId, table.position),
    index('reel_shots_project_idx').on(table.projectId),
    check('reel_shots_duration_range', sql`${table.durationS} IS NULL OR (${table.durationS} BETWEEN 1 AND 15)`),
    /** "`blocked` means moderation refused a shot, and it must show the refusal reason." */
    check('reel_shots_blocked_states_reason', sql`(NOT ${table.blocked}) OR ${table.blockReason} IS NOT NULL`),
    check(
      'reel_shots_frame_progress_percent',
      sql`${table.frameProgress} IS NULL OR (${table.frameProgress} BETWEEN 0 AND 100)`,
    ),
  ],
)

/** The description as runs: `@mentions` stay structured. Rewritten whole on every save. */
export const shotDescriptionParts = pgTable(
  'shot_description_parts',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    shotId: uuid('shot_id')
      .notNull()
      .references(() => reelShots.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: descriptionPartKindEnum('kind').notNull(),
    text: text('text').notNull(),
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'set null' }),
  },
  (table) => [index('shot_description_parts_shot_position_idx').on(table.shotId, table.position)],
)

/** The Character field. `auto` rows follow the mention parts until a `manual` row exists. */
export const shotCharacters = pgTable(
  'shot_characters',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    shotId: uuid('shot_id')
      .notNull()
      .references(() => reelShots.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    source: shotCharacterSourceEnum('source').notNull(),
  },
  (table) => [primaryKey({ columns: [table.shotId, table.characterId] }), index('shot_characters_project_idx').on(table.projectId)],
)

// ---------------------------------------------------------------------------
// Storyboard sheet, clips, generations
// ---------------------------------------------------------------------------

export const storyboardSheets = pgTable(
  'storyboard_sheets',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    reelId: uuid('reel_id')
      .notNull()
      .references(() => reels.id, { onDelete: 'cascade' }),
    state: sheetStateEnum('state').notNull().default('none'),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    progress: smallint('progress'),
    generatedAt: timestampColumn('generated_at'),
    creditsSpent: integer('credits_spent').notNull().default(0),
    artStyleId: uuid('art_style_id').references(() => artStyles.id, { onDelete: 'set null' }),
    generationId: uuid('generation_id').references(() => generations.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    /** One sheet per reel - the spec's rule 2. */
    uniqueIndex('storyboard_sheets_reel_key').on(table.reelId),
    index('storyboard_sheets_project_idx').on(table.projectId),
    check('storyboard_sheets_progress_percent', sql`${table.progress} IS NULL OR (${table.progress} BETWEEN 0 AND 100)`),
  ],
)

export const storyboardFrames = pgTable(
  'storyboard_frames',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    sheetId: uuid('sheet_id')
      .notNull()
      .references(() => storyboardSheets.id, { onDelete: 'cascade' }),
    shotId: uuid('shot_id')
      .notNull()
      .references(() => reelShots.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    heading: text('heading').notNull().default(''),
    cameraNote: text('camera_note').notNull().default(''),
    timeFromS: integer('time_from_s').notNull().default(0),
    timeToS: integer('time_to_s').notNull().default(0),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('storyboard_frames_sheet_shot_key').on(table.sheetId, table.shotId),
    index('storyboard_frames_sheet_position_idx').on(table.sheetId, table.position),
  ],
)

export const clips = pgTable(
  'clips',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    reelId: uuid('reel_id')
      .notNull()
      .references(() => reels.id, { onDelete: 'cascade' }),
    state: clipStateEnum('state').notNull().default('gate'),
    version: integer('version').notNull().default(1),
    posterAssetId: uuid('poster_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    videoAssetId: uuid('video_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    creditsSpent: integer('credits_spent').notNull().default(0),
    generationId: uuid('generation_id').references(() => generations.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => [index('clips_reel_created_idx').on(table.reelId, table.createdAt), index('clips_project_idx').on(table.projectId)],
)

/**
 * Every AI job - the spec's `generations`. Two columns the spec does not
 * list, both AGENTS.md's (Jobs, credits and cost): `route`, the model the
 * registry chose, and `source_hash`, the inputs' hash that says whether an
 * output is still current. `error` carries a failure in the writer's terms;
 * `refusal_reason` a moderation refusal, and the shot's `block_reason`
 * copies it (the spec's rule).
 */
export const generations = pgTable(
  'generations',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    targetType: generationTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    job: generationJobEnum('job').notNull(),
    state: generationStateEnum('state').notNull().default('queued'),
    progress: smallint('progress'),
    /** The assembled, provider-neutral prompt: text plus role-tagged reference keys. */
    prompt: jsonb('prompt').notNull().default(sql`'{}'::jsonb`),
    /** The episode's settings as they were at the click. */
    settingsSnapshot: jsonb('settings_snapshot').notNull().default(sql`'{}'::jsonb`),
    refusalReason: text('refusal_reason'),
    error: text('error'),
    creditsReserved: integer('credits_reserved').notNull().default(0),
    creditsCharged: integer('credits_charged').notNull().default(0),
    route: text('route'),
    sourceHash: text('source_hash'),
    startedAt: timestampColumn('started_at'),
    finishedAt: timestampColumn('finished_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('generations_project_state_idx').on(table.projectId, table.state),
    index('generations_episode_idx').on(table.episodeId),
    index('generations_target_idx').on(table.targetType, table.targetId),
    check('generations_progress_percent', sql`${table.progress} IS NULL OR (${table.progress} BETWEEN 0 AND 100)`),
    check('generations_refused_states_reason', sql`(${table.state} <> 'refused') OR ${table.refusalReason} IS NOT NULL`),
    check(
      'generations_finished_at_matches_state',
      sql`(${table.state} IN ('succeeded', 'failed', 'refused', 'cancelled')) = (${table.finishedAt} IS NOT NULL)`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Collaboration and preferences
// ---------------------------------------------------------------------------

/** The notes popover writes here; the UI shows the latest note as the field. */
export const notes = pgTable(
  'notes',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    targetType: noteTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    body: text('body').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => [index('notes_target_created_idx').on(table.targetType, table.targetId, table.createdAt)],
)

/**
 * What View options and Filter & sort persist, per user per episode. The
 * spec's `view_preferences` less its `theme`: the theme is the app's, on
 * `<html data-theme>`, and one route may not own it.
 */
export const viewPreferences = pgTable(
  'view_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    view: boardViewEnum('view').notNull().default('grid'),
    /** `{ [fieldId]: boolean }`. A field not present is visible. */
    fieldVisibility: jsonb('field_visibility').notNull().default(sql`'{}'::jsonb`),
    fieldOrder: text('field_order').array().notNull().default(sql`ARRAY[]::text[]`),
    statusFilter: statusFilterEnum('status_filter').notNull().default('all'),
    unassignedOnly: boolean('unassigned_only').notNull().default(false),
    sort: sortModeEnum('sort').notNull().default('order'),
    updatedAt: updatedAtColumn(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.episodeId] }), index('view_preferences_project_idx').on(table.projectId)],
)

/** One row per Production mutation: the verb is the action's name, the diff its patch. No reader yet. */
export const activityLog = pgTable(
  'activity_log',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    verb: text('verb').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    diff: jsonb('diff').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
  },
  (table) => [index('activity_log_project_created_idx').on(table.projectId, table.createdAt)],
)
