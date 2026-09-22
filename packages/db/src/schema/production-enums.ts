import {
  ASPECT_RATIOS,
  ASSET_KINDS,
  ASSET_SOURCES,
  BOARD_VIEWS,
  CAMERA_MOTIONS,
  CAMERA_STYLES,
  CLIP_STATES,
  CONTINUITIES,
  DESCRIPTION_PART_KINDS,
  GENERATION_JOBS,
  GENERATION_STATES,
  GENERATION_TARGETS,
  INT_EXT,
  LIGHTINGS,
  NOTE_TARGETS,
  PACINGS,
  PRIORITIES,
  PRODUCTION_FRAME_STATES,
  PRODUCTION_TYPES,
  REEL_STATUSES,
  SHEET_STATES,
  SHOT_CHARACTER_SOURCES,
  SHOT_STATUSES,
  SHOT_TYPES,
  SORT_MODES,
  STATUS_FILTERS,
} from '@folio/contracts'
import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * The Production route's enums - `docs/production/production.md` §6, the
 * values unchanged, each a real Postgres enum. In their own file so that
 * `derived.ts` (the `scenes` row takes `frame_state` and `int_ext` for its
 * still and its setup overrides) and `production.ts` (which references
 * `locations`) can both import them without importing each other: an enum
 * is used at column-definition time, where a circular binding would be
 * `undefined`; a table reference is a thunk and would not.
 *
 * The Storyboard's `camera_angle` enum (`storyboard.ts`) is its own; the
 * spec's shot `camera_angle` is free text ("Eye level", "Low", "High").
 */
export const shotStatusEnum = pgEnum('shot_status', SHOT_STATUSES)
export const reelStatusEnum = pgEnum('reel_status', REEL_STATUSES)
export const frameStateEnum = pgEnum('frame_state', PRODUCTION_FRAME_STATES)
export const sheetStateEnum = pgEnum('sheet_state', SHEET_STATES)
export const shotTypeEnum = pgEnum('shot_type', SHOT_TYPES)
export const cameraMotionEnum = pgEnum('camera_motion', CAMERA_MOTIONS)
export const priorityEnum = pgEnum('priority', PRIORITIES)
export const intExtEnum = pgEnum('int_ext', INT_EXT)
export const aspectRatioEnum = pgEnum('aspect_ratio', ASPECT_RATIOS)
export const productionTypeEnum = pgEnum('production_type', PRODUCTION_TYPES)
export const cameraStyleEnum = pgEnum('camera_style', CAMERA_STYLES)
export const pacingEnum = pgEnum('pacing', PACINGS)
export const lightingEnum = pgEnum('lighting', LIGHTINGS)
export const sortModeEnum = pgEnum('sort_mode', SORT_MODES)
export const statusFilterEnum = pgEnum('status_filter', STATUS_FILTERS)
export const boardViewEnum = pgEnum('board_view', BOARD_VIEWS)
export const assetKindEnum = pgEnum('asset_kind', ASSET_KINDS)
export const assetSourceEnum = pgEnum('asset_source', ASSET_SOURCES)
export const generationTargetEnum = pgEnum('generation_target', GENERATION_TARGETS)
export const generationJobEnum = pgEnum('generation_job', GENERATION_JOBS)
export const generationStateEnum = pgEnum('generation_state', GENERATION_STATES)
export const clipStateEnum = pgEnum('clip_state', CLIP_STATES)
export const noteTargetEnum = pgEnum('note_target', NOTE_TARGETS)
export const descriptionPartKindEnum = pgEnum('description_part_kind', DESCRIPTION_PART_KINDS)
export const continuityEnum = pgEnum('continuity', CONTINUITIES)
export const shotCharacterSourceEnum = pgEnum('shot_character_source', SHOT_CHARACTER_SOURCES)
