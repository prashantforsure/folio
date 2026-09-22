import type { CharacterId, LocationId, NodeId } from '@folio/script'
import { z } from 'zod'

import type { ArtStyleId, AssetId, ClipId, EpisodeId, ProductionGenerationId, ReelId, ReelShotId, SheetId, UserId } from './ids'
import {
  ArtStyleIdSchema,
  CharacterIdSchema,
  LocationIdSchema,
  NodeIdSchema,
  ReelIdSchema,
  ReelShotIdSchema,
  UserIdSchema,
} from './ids'
import type { Timestamp } from './primitives'

/**
 * The Production route, v12 - `docs/production/production.md` is the
 * contract; the mockup beside it settles what the spec leaves visual.
 *
 * Everything here is one vocabulary: the spec's §6 enumerations are the
 * database's enums (`@folio/db`, `schema/production.ts`), the server's
 * results and the UI's labels, unchanged. A value the spec spells with a
 * space or a capital (`Wide angle`, `Naturalistic`, `2.39:1 scope`) is
 * stored exactly so - a mapping layer between three spellings of one word
 * is where the last route's bugs lived.
 *
 * ## What is derived and never stored
 *
 * The spec's "Derived values" (§7): a reel's used seconds and its over /
 * under state, the four readiness flags and `can_shoot`, a shot's status
 * when the writer has not overridden it, the scene's status dot, the
 * timing-bar widths, the scene summary line. All of it is computed in
 * `apps/web/lib/production/derive.ts` from the rows below; none of it has a
 * column. AGENTS.md, "Nothing is stored that can be computed".
 *
 * Two of the readiness inputs are derived from other routes' rows by the
 * client's ruling (2026-09-22): a character's appearance reference *is* its
 * portrait (`characters.portrait_key`), a location's plate *is* its photo
 * (`locations.photo_key`). Nothing new is written for either.
 *
 * ## What the mockup shows that the spec left unstored
 *
 * The scene-setup row's per-scene overrides (camera, prop, location,
 * INT/EXT, shoot day, priority) are columns on the authored `scenes` row,
 * named as the shot's are. Notes are rows in `notes`, the latest one shown.
 */

// ---------------------------------------------------------------------------
// §6 Enumerations - authoritative
// ---------------------------------------------------------------------------

export const SHOT_STATUSES = ['to_draw', 'proposed', 'queued', 'generating', 'drawn', 'out_of_date', 'refused'] as const
export type ShotStatus = (typeof SHOT_STATUSES)[number]
export const ShotStatusSchema = z.enum(SHOT_STATUSES)

/** How a status reads on the card, in the menu and in the table. Specified copy (the mockup's `STATUS`). */
export const SHOT_STATUS_LABELS: Readonly<Record<ShotStatus, string>> = {
  to_draw: 'To draw',
  proposed: 'Proposed',
  queued: 'Queued',
  generating: 'Generating',
  drawn: 'Drawn',
  out_of_date: 'Out of date',
  refused: 'Refused',
}

export const REEL_STATUSES = ['writing', 'generating', 'rendered', 'stale'] as const
export type ReelStatus = (typeof REEL_STATUSES)[number]
export const ReelStatusSchema = z.enum(REEL_STATUSES)

export const REEL_STATUS_LABELS: Readonly<Record<ReelStatus, string>> = {
  writing: 'Writing',
  generating: 'Generating',
  rendered: 'Rendered',
  stale: 'Out of date',
}

export const FRAME_STATES = [
  'empty',
  'ready',
  'queued',
  'gen',
  'waiting',
  'drawn',
  'uploaded',
  'stale',
  'blocked',
  'failed',
  'cancelled',
] as const
export type FrameState = (typeof FRAME_STATES)[number]
export const FrameStateSchema = z.enum(FRAME_STATES)

export const SHEET_STATES = ['none', 'gen', 'done'] as const
export type SheetState = (typeof SHEET_STATES)[number]
export const SheetStateSchema = z.enum(SHEET_STATES)

export const SHEET_STATE_LABELS: Readonly<Record<SheetState, string>> = {
  none: 'Not generated',
  gen: 'Generating',
  done: 'Generated',
}

export const SHOT_TYPES = ['Wide angle', 'Medium', 'Close-up', 'Over', 'Point', 'Two shot', 'Tracking', 'Dutch'] as const
export type ShotType = (typeof SHOT_TYPES)[number]
export const ShotTypeSchema = z.enum(SHOT_TYPES)

export const CAMERA_MOTIONS = ['Still', 'Pan', 'Zoom', 'Rotate', 'Tilt', 'Follow', 'Track', 'Dolly', 'Handheld', 'Crane'] as const
export type CameraMotion = (typeof CAMERA_MOTIONS)[number]
export const CameraMotionSchema = z.enum(CAMERA_MOTIONS)

/** The duration menu's seconds. `none` is a null `duration_s`. */
export const DURATION_PRESETS = [2, 3, 4, 5, 8, 10, 15] as const
export type DurationPreset = (typeof DURATION_PRESETS)[number]
export const DurationPresetSchema = z.literal(DURATION_PRESETS)

export const CLIP_LENGTHS = [5, 8, 10, 15] as const
export type ClipLength = (typeof CLIP_LENGTHS)[number]
export const ClipLengthSchema = z.literal(CLIP_LENGTHS)
export const DEFAULT_CLIP_LENGTH: ClipLength = 15

export const PRIORITIES = ['none', 'low', 'medium', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]
export const PrioritySchema = z.enum(PRIORITIES)

export const PRIORITY_LABELS: Readonly<Record<Priority, string>> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const INT_EXT = ['INT', 'EXT'] as const
export type IntExt = (typeof INT_EXT)[number]
export const IntExtSchema = z.enum(INT_EXT)

export const ASPECT_RATIOS = ['16:9 landscape', '9:16 portrait', '2.39:1 scope'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]
export const AspectRatioSchema = z.enum(ASPECT_RATIOS)

/** The modal's three shape cards: label, and the shape's width × height in px. */
export const ASPECT_RATIO_CARDS: readonly { readonly id: AspectRatio; readonly label: string; readonly w: number; readonly h: number }[] = [
  { id: '16:9 landscape', label: 'Landscape 16:9', w: 48, h: 27 },
  { id: '9:16 portrait', label: 'Portrait 9:16', w: 27, h: 48 },
  { id: '2.39:1 scope', label: 'Scope 2.39:1', w: 54, h: 23 },
]

export const PRODUCTION_TYPES = ['Narrative', 'Commercial', 'Documentary'] as const
export type ProductionType = (typeof PRODUCTION_TYPES)[number]
export const ProductionTypeSchema = z.enum(PRODUCTION_TYPES)

export const CAMERA_STYLES = ['Academy', 'Handheld', 'Steadicam'] as const
export type CameraStyle = (typeof CAMERA_STYLES)[number]
export const CameraStyleSchema = z.enum(CAMERA_STYLES)

export const PACINGS = ['Measured', 'Balanced', 'Kinetic'] as const
export type Pacing = (typeof PACINGS)[number]
export const PacingSchema = z.enum(PACINGS)

export const LIGHTINGS = ['Naturalistic', 'Motivated', 'Stylised'] as const
export type Lighting = (typeof LIGHTINGS)[number]
export const LightingSchema = z.enum(LIGHTINGS)

/** The four option groups of the settings modal: label, hint, and each option's sub-line. Specified copy. */
export const SETTINGS_GROUPS = [
  {
    id: 'productionType',
    label: 'Production Type',
    hint: 'Sets the creative direction of the whole film · locked once production starts',
    options: [
      { id: 'Narrative', sub: 'Story-led' },
      { id: 'Commercial', sub: 'Brand-led' },
      { id: 'Documentary', sub: 'Observational' },
    ],
  },
  {
    id: 'cameraStyle',
    label: 'Camera Style',
    hint: 'Defines the camera movement and feel of every shot · locked once shooting begins',
    options: [
      { id: 'Academy', sub: 'Composed, tripod' },
      { id: 'Handheld', sub: 'Loose, reactive' },
      { id: 'Steadicam', sub: 'Gliding, fluid' },
    ],
  },
  {
    id: 'pacing',
    label: 'Pacing',
    hint: 'Average shot length and how often the film cuts',
    options: [
      { id: 'Measured', sub: 'Long takes' },
      { id: 'Balanced', sub: 'Standard cutting' },
      { id: 'Kinetic', sub: 'Fast cutting' },
    ],
  },
  {
    id: 'lighting',
    label: 'Lighting',
    hint: 'The base light source and contrast level under the chosen art style',
    options: [
      { id: 'Naturalistic', sub: 'Available light' },
      { id: 'Motivated', sub: 'Shaped practicals' },
      { id: 'Stylised', sub: 'Hard, designed' },
    ],
  },
] as const

export const SORT_MODES = ['order', 'longest', 'status'] as const
export type SortMode = (typeof SORT_MODES)[number]
export const SortModeSchema = z.enum(SORT_MODES)

export const SORT_MODE_LABELS: Readonly<Record<SortMode, string>> = {
  order: 'Scene order',
  longest: 'Longest first',
  status: 'By status',
}

export const STATUS_FILTERS = ['all', 'todraw', 'drawn', 'attention'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]
export const StatusFilterSchema = z.enum(STATUS_FILTERS)

export const STATUS_FILTER_LABELS: Readonly<Record<StatusFilter, string>> = {
  all: 'All',
  todraw: 'To draw',
  drawn: 'Drawn',
  attention: 'Needs attention',
}

/** `grid` is the spec's Cards, `list` its Columns. */
export const BOARD_VIEWS = ['grid', 'list'] as const
export type BoardView = (typeof BOARD_VIEWS)[number]
export const BoardViewSchema = z.enum(BOARD_VIEWS)

/** The 17 metadata fields, in the mockup's order; the ids are the persisted keys. */
export const FIELD_IDS = [
  'title',
  'status',
  'desc',
  'dialogue',
  'refs',
  'type',
  'motion',
  'duration',
  'cast',
  'prop',
  'lens',
  'date',
  'loc',
  'intext',
  'notes',
  'assignee',
  'priority',
] as const
export type FieldId = (typeof FIELD_IDS)[number]
export const FieldIdSchema = z.enum(FIELD_IDS)

export const FIELD_LABELS: Readonly<Record<FieldId, string>> = {
  title: 'Title',
  status: 'Status',
  desc: 'Description',
  dialogue: 'Dialogue',
  refs: 'References',
  type: 'Shot type',
  motion: 'Camera movement',
  duration: 'Duration',
  cast: 'Character',
  prop: 'Prop',
  lens: 'Lens',
  date: 'Date',
  loc: 'Location',
  intext: 'INT/EXT',
  notes: 'Notes',
  assignee: 'Assignee',
  priority: 'Priority',
}

export const CONTINUITIES = ['natural', 'match'] as const
export type Continuity = (typeof CONTINUITIES)[number]
export const ContinuitySchema = z.enum(CONTINUITIES)

export const DESCRIPTION_PART_KINDS = ['text', 'mention', 'dialogue'] as const
export type DescriptionPartKind = (typeof DESCRIPTION_PART_KINDS)[number]

export const SHOT_CHARACTER_SOURCES = ['auto', 'manual'] as const
export type ShotCharacterSource = (typeof SHOT_CHARACTER_SOURCES)[number]

// ---------------------------------------------------------------------------
// Media and generations
// ---------------------------------------------------------------------------

export const ASSET_KINDS = ['frame', 'sheet', 'still', 'reference', 'clip', 'poster', 'upload'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]
export const AssetKindSchema = z.enum(ASSET_KINDS)

export const ASSET_SOURCES = ['generated', 'uploaded'] as const
export type AssetSource = (typeof ASSET_SOURCES)[number]

export const GENERATION_TARGETS = ['shot', 'reel', 'scene', 'sheet', 'character'] as const
export type GenerationTarget = (typeof GENERATION_TARGETS)[number]

export const GENERATION_JOBS = [
  'ai_shotlist',
  'storyboard_sheet',
  'scene_image',
  'shot_frame',
  'shoot_reel',
  'propose_shots',
  'character_look',
] as const
export type GenerationJob = (typeof GENERATION_JOBS)[number]
export const GenerationJobSchema = z.enum(GENERATION_JOBS)

export const GENERATION_STATES = ['queued', 'running', 'succeeded', 'failed', 'refused', 'cancelled'] as const
export type GenerationState = (typeof GENERATION_STATES)[number]

/** A generation that is still going: what the page polls for. */
export const isLiveGeneration = (state: GenerationState): boolean => state === 'queued' || state === 'running'

export const CLIP_STATES = ['gate', 'queued', 'generating', 'rendered', 'stale', 'failed', 'cancelled'] as const
export type ClipState = (typeof CLIP_STATES)[number]

export const NOTE_TARGETS = ['shot', 'scene', 'reel'] as const
export type NoteTarget = (typeof NOTE_TARGETS)[number]
export const NoteTargetSchema = z.enum(NOTE_TARGETS)

/**
 * Credit costs, named on the button before they are spent (AGENTS.md, Jobs,
 * credits and cost). The sheet and the reel are the spec's (§6: "storyboard
 * sheet 40 cr, shoot a reel 375 cr"); the rest the spec is silent on and
 * the client ruled (2026-09-22): a frame reuses the Storyboard's 4, a scene
 * image is one image like the sheet, text-only jobs are free pending
 * AGENTS.md open decision 13.
 */
export const GENERATION_COSTS: Readonly<Record<GenerationJob, number>> = {
  ai_shotlist: 0,
  storyboard_sheet: 40,
  scene_image: 40,
  shot_frame: 4,
  shoot_reel: 375,
  propose_shots: 0,
  character_look: 40,
}

export const TIERS = ['Draft', 'Standard', 'Cinema'] as const
export type Tier = (typeof TIERS)[number]

/**
 * The registry - the only place a model is named (AGENTS.md, Jobs, credits
 * and cost). Google's Gemini API by the client's ruling (2026-09-22); the
 * ids are what `generativelanguage.googleapis.com` listed on that date.
 * `route` on a generation row records which of these ran it. `null` is a
 * job no model runs (`propose_shots` is the pure core's rule-based
 * proposer). The writer sees the tier, never the id.
 */
export const MODEL_REGISTRY: Readonly<
  Record<GenerationJob, { readonly model: string; readonly tier: Tier; readonly kind: 'text' | 'image' | 'video' } | null>
> = {
  ai_shotlist: { model: 'gemini-3.8-flash', tier: 'Standard', kind: 'text' },
  storyboard_sheet: { model: 'gemini-3.1-flash-image', tier: 'Standard', kind: 'image' },
  scene_image: { model: 'gemini-3.1-flash-image', tier: 'Standard', kind: 'image' },
  shot_frame: { model: 'gemini-3.1-flash-image', tier: 'Standard', kind: 'image' },
  shoot_reel: { model: 'veo-3.1-generate-preview', tier: 'Standard', kind: 'video' },
  propose_shots: null,
  character_look: { model: 'gemini-3.1-flash-image', tier: 'Standard', kind: 'image' },
}

// ---------------------------------------------------------------------------
// Rows - what the server reads and hands the client
// ---------------------------------------------------------------------------

export type ArtStyle = {
  readonly id: ArtStyleId
  readonly key: string
  readonly name: string
  readonly era: string
  readonly referenceFilms: readonly string[]
  readonly description: string
  /** A CSS gradient for the reference plate. The seed's 14 presets carry one each. */
  readonly plateGradient: string
  readonly isPreset: boolean
}

export type EpisodeSettings = {
  readonly episodeId: EpisodeId
  readonly aspectRatio: AspectRatio
  readonly productionType: ProductionType
  readonly cameraStyle: CameraStyle
  readonly pacing: Pacing
  readonly lighting: Lighting
  readonly artStyleId: ArtStyleId
  /** Set by the first successful shoot. Settings refuse edits after. */
  readonly lockedAt: Timestamp | null
}

export const DEFAULT_SETTINGS: Omit<EpisodeSettings, 'episodeId' | 'artStyleId' | 'lockedAt'> = {
  aspectRatio: '16:9 landscape',
  productionType: 'Narrative',
  cameraStyle: 'Academy',
  pacing: 'Balanced',
  lighting: 'Motivated',
}

/** The preset the mockup selects by default. */
export const DEFAULT_ART_STYLE_KEY = 'netflix-prestige-drama'

export type DescriptionPart = {
  readonly kind: DescriptionPartKind
  readonly text: string
  /** The record a `mention` resolved to, or null for an unmatched `@Name`. */
  readonly characterId: CharacterId | null
}

export type Asset = {
  readonly id: AssetId
  readonly kind: AssetKind
  /** The public URL, or null when storage is not configured. */
  readonly url: string | null
  readonly mime: string
  readonly width: number | null
  readonly height: number | null
  readonly source: AssetSource
}

export type ReelShot = {
  readonly id: ReelShotId
  readonly reelId: ReelId
  readonly number: number
  readonly position: string
  readonly title: string | null
  readonly durationS: DurationPreset | null
  /** The writer's override, or null: derive it (`derive.ts`, the spec's order). */
  readonly status: ShotStatus | null
  readonly shotType: ShotType
  readonly cameraAngle: string
  readonly cameraMotion: CameraMotion
  readonly cameraBody: string
  readonly lens: string
  /** The description as plain text; `parts` is the same text as runs. */
  readonly description: string
  readonly parts: readonly DescriptionPart[]
  readonly dialogue: string | null
  readonly proposed: boolean
  readonly blocked: boolean
  readonly blockReason: string | null
  readonly prop: string | null
  readonly locationId: LocationId | null
  readonly intExt: IntExt | null
  /** `YYYY-MM-DD`. */
  readonly shootDate: string | null
  readonly notes: string | null
  readonly assigneeId: UserId | null
  readonly priority: Priority
  readonly frameState: FrameState
  readonly frame: Asset | null
  readonly frameProgress: number | null
  readonly frameKept: boolean
  readonly takeIndex: readonly number[] | null
  /** The Character field: manual rows when any exist, else the auto rows from `@mentions`. */
  readonly characters: readonly { readonly characterId: CharacterId; readonly source: ShotCharacterSource }[]
  readonly references: readonly Asset[]
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
}

export type SheetFrame = {
  readonly shotId: ReelShotId
  readonly position: number
  readonly heading: string
  readonly cameraNote: string
  readonly timeFromS: number
  readonly timeToS: number
  readonly asset: Asset | null
}

export type Sheet = {
  readonly id: SheetId
  readonly reelId: ReelId
  readonly state: SheetState
  readonly asset: Asset | null
  readonly progress: number | null
  readonly generatedAt: Timestamp | null
  readonly creditsSpent: number
  readonly artStyleId: ArtStyleId | null
  readonly generationId: ProductionGenerationId | null
  readonly frames: readonly SheetFrame[]
}

export type Clip = {
  readonly id: ClipId
  readonly reelId: ReelId
  readonly state: ClipState
  readonly version: number
  readonly poster: Asset | null
  readonly video: Asset | null
  readonly creditsSpent: number
  readonly generationId: ProductionGenerationId | null
  readonly createdAt: Timestamp
}

export type Generation = {
  readonly id: ProductionGenerationId
  readonly targetType: GenerationTarget
  readonly targetId: string
  readonly job: GenerationJob
  readonly state: GenerationState
  readonly progress: number | null
  readonly refusalReason: string | null
  readonly creditsReserved: number
  readonly creditsCharged: number
  readonly route: string | null
  readonly startedAt: Timestamp | null
  readonly finishedAt: Timestamp | null
  readonly createdAt: Timestamp
}

export type Reel = {
  readonly id: ReelId
  readonly sceneNodeId: NodeId
  readonly name: string
  readonly clipLengthS: ClipLength
  readonly continuity: Continuity
  readonly status: ReelStatus
  readonly finalized: boolean
  readonly position: string
  readonly shots: readonly ReelShot[]
  /** One per reel, or null before the first draw. */
  readonly sheet: Sheet | null
  /** The latest clip, or null before the first shoot. */
  readonly clip: Clip | null
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
}

/** A cast member of a scene, as the readiness bar and the Character menu need them. */
export type ProductionCastMember = {
  readonly id: CharacterId
  readonly name: string
  readonly initials: string
  readonly hue: number
  readonly portraitUrl: string | null
  /** The client's ruling: the portrait is the appearance reference. */
  readonly appearanceReady: boolean
}

/** The scene-setup row's per-scene overrides. Null = default from the scene / first shot. */
export type SceneSetup = {
  readonly cameraBody: string | null
  readonly lens: string | null
  readonly prop: string | null
  readonly locationId: LocationId | null
  readonly intExt: IntExt | null
  readonly shootDate: string | null
  readonly priority: Priority | null
  readonly note: string | null
}

export type ProductionScene = {
  readonly sceneNodeId: NodeId
  readonly number: number
  readonly heading: string
  /** The slugline's set, as the tab's `title` and the Columns header read it. */
  readonly set: string
  readonly locationId: LocationId | null
  readonly locationName: string | null
  readonly intExt: IntExt | null
  readonly timeOfDay: string | null
  /** The first action line under the heading, for the Columns view. */
  readonly logline: string
  readonly cast: readonly ProductionCastMember[]
  /** The location's photo is the plate (the client's ruling). */
  readonly plateReady: boolean
  readonly still: Asset | null
  readonly stillState: FrameState
  readonly setup: SceneSetup
  readonly reels: readonly Reel[]
}

export type ViewPreferences = {
  readonly view: BoardView
  readonly fieldVisibility: Readonly<Record<FieldId, boolean>>
  readonly fieldOrder: readonly FieldId[]
  readonly statusFilter: StatusFilter
  readonly unassignedOnly: boolean
  readonly sort: SortMode
}

export const DEFAULT_VIEW_PREFERENCES: ViewPreferences = {
  view: 'grid',
  fieldVisibility: Object.fromEntries(FIELD_IDS.map((id) => [id, true])) as Record<FieldId, boolean>,
  fieldOrder: FIELD_IDS,
  statusFilter: 'all',
  unassignedOnly: false,
  sort: 'order',
}

/** A project member, for the Assignee menu. */
export type Assignee = {
  readonly id: UserId
  readonly name: string
}

// ---------------------------------------------------------------------------
// Readiness - the four flags, derived
// ---------------------------------------------------------------------------

export const READINESS_FLAGS = ['shotlist', 'sheet', 'scene_image', 'characters'] as const
export type ReadinessFlag = (typeof READINESS_FLAGS)[number]

export type Readiness = {
  readonly shotlist: boolean
  readonly sheet: boolean
  readonly sceneImage: boolean
  readonly characters: boolean
  readonly canShoot: boolean
  /** The flags that fail, in step order - what `shootReel` returns with `not_ready`. */
  readonly failed: readonly ReadinessFlag[]
}

/** The tooltip on a disabled `Start shooting`. Specified copy. */
export const NOT_READY_TITLE = 'Finish the shotlist, storyboard sheet, scene image and character references first'

// ---------------------------------------------------------------------------
// Edits - what the actions accept
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max)
const isoDate = z.iso.date()

export const SettingsInputSchema = z
  .object({
    aspectRatio: AspectRatioSchema,
    productionType: ProductionTypeSchema,
    cameraStyle: CameraStyleSchema,
    pacing: PacingSchema,
    lighting: LightingSchema,
    artStyleId: ArtStyleIdSchema,
  })
  .strict()
export type SettingsInput = z.infer<typeof SettingsInputSchema>

export const ReelPatchSchema = z
  .object({
    name: text(80).min(1).optional(),
    clipLengthS: ClipLengthSchema.optional(),
  })
  .strict()
export type ReelPatch = z.infer<typeof ReelPatchSchema>

export const NewShotSchema = z
  .object({
    reelId: ReelIdSchema,
    description: text(2000).optional(),
    durationS: DurationPresetSchema.nullable().optional(),
  })
  .strict()
export type NewShot = z.infer<typeof NewShotSchema>

/** Every field the drawer, the card chips, the menus and the table can write. */
export const ShotPatchSchema = z
  .object({
    title: text(120).nullable().optional(),
    description: text(2000).optional(),
    dialogue: text(2000).nullable().optional(),
    durationS: DurationPresetSchema.nullable().optional(),
    status: ShotStatusSchema.nullable().optional(),
    shotType: ShotTypeSchema.optional(),
    cameraAngle: text(60).optional(),
    cameraMotion: CameraMotionSchema.optional(),
    cameraBody: text(80).optional(),
    lens: text(40).optional(),
    prop: text(80).nullable().optional(),
    locationId: LocationIdSchema.nullable().optional(),
    intExt: IntExtSchema.nullable().optional(),
    shootDate: isoDate.nullable().optional(),
    notes: text(2000).nullable().optional(),
    assigneeId: UserIdSchema.nullable().optional(),
    priority: PrioritySchema.optional(),
    /** The Character field, set by hand. Empty clears to the auto rows. */
    characters: z.array(CharacterIdSchema).max(12).optional(),
  })
  .strict()
export type ShotPatch = z.infer<typeof ShotPatchSchema>

/** The bulk bar's three menus, over the picked shots. */
export const BulkPatchSchema = z
  .object({
    ids: z.array(ReelShotIdSchema).min(1).max(200),
    patch: z
      .object({
        status: ShotStatusSchema.nullable().optional(),
        assigneeId: UserIdSchema.nullable().optional(),
        priority: PrioritySchema.optional(),
      })
      .strict(),
  })
  .strict()
export type BulkPatch = z.infer<typeof BulkPatchSchema>

export const MoveShotSchema = z
  .object({
    shotId: ReelShotIdSchema,
    reelId: ReelIdSchema,
    /** The shot to land before, or null for the end of the reel. */
    beforeId: ReelShotIdSchema.nullable(),
  })
  .strict()
export type MoveShot = z.infer<typeof MoveShotSchema>

export const RetimeShotSchema = z
  .object({
    shotId: ReelShotIdSchema,
    durationS: z.number().int().min(1).max(15),
  })
  .strict()
export type RetimeShot = z.infer<typeof RetimeShotSchema>

export const SceneSetupPatchSchema = z
  .object({
    sceneNodeId: NodeIdSchema,
    cameraBody: text(80).nullable().optional(),
    lens: text(40).nullable().optional(),
    prop: text(80).nullable().optional(),
    locationId: LocationIdSchema.nullable().optional(),
    intExt: IntExtSchema.nullable().optional(),
    shootDate: isoDate.nullable().optional(),
    priority: PrioritySchema.nullable().optional(),
  })
  .strict()
export type SceneSetupPatch = z.infer<typeof SceneSetupPatchSchema>

export const NoteInputSchema = z
  .object({
    targetType: NoteTargetSchema,
    targetId: z.uuid(),
    /** Empty removes the note (the popover's `Remove`). */
    body: text(4000),
  })
  .strict()
export type NoteInput = z.infer<typeof NoteInputSchema>

export const ViewPreferencesPatchSchema = z
  .object({
    view: BoardViewSchema.optional(),
    fieldVisibility: z.partialRecord(FieldIdSchema, z.boolean()).optional(),
    fieldOrder: z.array(FieldIdSchema).length(FIELD_IDS.length).optional(),
    statusFilter: StatusFilterSchema.optional(),
    unassignedOnly: z.boolean().optional(),
    sort: SortModeSchema.optional(),
  })
  .strict()
export type ViewPreferencesPatch = z.infer<typeof ViewPreferencesPatchSchema>

/** An uploaded image: the scene image, a reference. */
export const PRODUCTION_IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const PRODUCTION_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
