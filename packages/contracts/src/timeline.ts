import type { CharacterId, ContinuityKind, HeadingBind, Light, LocationId, NodeId, StoryTime } from '@folio/script'
import { STORY_CLOCK_PATTERN } from '@folio/script'
import { z } from 'zod'

import { assertExact } from './equality'
import type { Equals } from './equality'
import type { EpisodeSlug, StoryThreadId } from './ids'
import { NodeIdSchema, ProjectIdSchema, StoryThreadIdSchema } from './ids'
import { TimestampSchema } from './primitives'

/**
 * The Timeline route: the two authored things that power it, and the read
 * model the route draws.
 *
 * The brief: "Story order versus what actually happened, across all
 * episodes. Two authored things power it." Both are inputs a writer types;
 * nothing here is derived, and the pure core (`@folio/script`'s
 * `timeline.ts`) only ever orders and compares what is authored.
 *
 * ## Threads
 *
 * "A named, coloured storyline and the scenes it runs through across
 * episodes. Authored and linked by hand; nothing derives a thread." A
 * thread is a row (`story_threads`); the scenes it runs through are the
 * `scenes.threads` column, which was declared opaque in `0000` for exactly
 * this and now holds thread ids as text. The link is on the scene's
 * authored row - so a re-derive cannot drop it, the same guarantee as a
 * synopsis - and the **first** id in a scene's list is the thread whose
 * row the scene's card sits in. A `StoryThreadId` is never a comment
 * `ThreadId`; the two tables share a word and nothing else.
 *
 * The colour is one of a closed set, each a themed token in `packages/ui`
 * (`--thread-<name>`), because AGENTS.md allows a colour to be written in
 * exactly one place and a free hex on a row would be a second.
 *
 * ## Story time
 *
 * "A story day, a clock, and a flashback flag, independent of page order.
 * Also authored, not parsed." Three columns on `scenes`: `story_day`,
 * `story_clock`, `flashback`. A clock without a day is refused - a time of
 * day on no day orders nothing - and the flashback flag stands alone: a
 * flashback with no day is flagged but unplaced.
 */

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/**
 * The closed colour set. The first four are the Timeline bundle's own
 * (`--t-water`, `--t-fraud`, `--t-love`, `--t-past`, transcribed into
 * `packages/ui` as `--thread-*`); the last two are invented there and say
 * so. Named by hue, not by fixture, because the fixture's names are one
 * project's storylines.
 */
export const STORY_THREAD_COLOURS = ['terracotta', 'slate', 'moss', 'ochre', 'violet', 'teal'] as const

export type StoryThreadColour = (typeof STORY_THREAD_COLOURS)[number]

export const StoryThreadColourSchema = z.enum(STORY_THREAD_COLOURS)

/** AUTHORED. One storyline. */
export const StoryThreadSchema = z.object({
  id: StoryThreadIdSchema,
  projectId: ProjectIdSchema,
  name: z.string().min(1).max(80),
  colour: StoryThreadColourSchema,
  /** Row order on the grid, dense from 0. */
  position: z.number().int().min(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type StoryThread = z.infer<typeof StoryThreadSchema>

/** What creating or editing a thread takes. Both fields, whole. */
export const StoryThreadEditSchema = z.object({
  name: z.string().trim().min(1).max(80),
  colour: StoryThreadColourSchema,
})

export type StoryThreadEdit = z.infer<typeof StoryThreadEditSchema>

// ---------------------------------------------------------------------------
// Story time
// ---------------------------------------------------------------------------

/** `HH:MM`, 24-hour. The pure core's pattern, so the two cannot disagree. */
export const StoryClockSchema = z.string().regex(STORY_CLOCK_PATTERN, 'A clock is HH:MM, 24-hour.')

/** Wide enough for a flashback measured in years; narrow enough to be a typo guard. */
const StoryDaySchema = z.number().int().min(-100_000).max(100_000)

export const StoryTimeSchema = z
  .object({
    day: StoryDaySchema,
    clock: StoryClockSchema.nullable(),
  })
  .readonly()

assertExact<Equals<z.infer<typeof StoryTimeSchema>, StoryTime>>()

/**
 * A scene's story time as the panel writes it. `day: null` clears the
 * placement; a clock is only accepted beside a day.
 */
export const StoryTimeEditSchema = z
  .object({
    day: StoryDaySchema.nullable(),
    clock: StoryClockSchema.nullable(),
    flashback: z.boolean(),
  })
  .refine((edit) => edit.day !== null || edit.clock === null, {
    message: 'A clock needs a day.',
    path: ['clock'],
  })

export type StoryTimeEdit = z.infer<typeof StoryTimeEditSchema>

/**
 * One placement of the proposal queue's bulk accept, and of its undo: a
 * scene and the story time it takes. `placeScenes` writes each only where
 * the scene still has no day; `unplaceScenes` clears each only where the
 * scene still carries exactly this time - a scene the writer retimed in
 * between is theirs.
 */
export const PlacementSchema = z.object({
  sceneNodeId: NodeIdSchema,
  time: StoryTimeSchema,
})

export type Placement = z.infer<typeof PlacementSchema>

export const PlacementsSchema = z.array(PlacementSchema).min(1).max(10_000)

/** A scene's threads, whole, in the writer's order - the first is its row. */
export const SceneThreadsSchema = z.array(StoryThreadIdSchema).max(64)

/** The threads' row order, whole: every thread of the project, once. */
export const ThreadOrderSchema = z.array(StoryThreadIdSchema).min(1).max(256)

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/**
 * One present scene as the Timeline draws it: where it is on the page,
 * what the writer has hung on it, and who is in it. In page order across
 * episodes - episode running order, then scene order within it.
 */
export type TimelineSceneRow = {
  readonly sceneNodeId: NodeId
  readonly episode: EpisodeSlug
  readonly episodeOrdinal: number
  /** The rank within the episode - what `E2 Sc 9` means. */
  readonly number: number
  readonly heading: string
  readonly synopsis: string | null
  /** Start page on the project's measurement, or null when unmeasured. */
  readonly page: number | null
  /** Length in eighths on the same measurement, or null when unmeasured. */
  readonly eighths: number | null
  readonly cast: readonly { readonly id: CharacterId; readonly name: string }[]
  /** The set the heading resolved to (`scene_derivations.location_id`), with the record's name; null while unresolved. Since the rebuild (2026-09-18). */
  readonly set: { readonly id: LocationId; readonly name: string } | null
  readonly storyTime: StoryTime | null
  readonly flashback: boolean
  /** The threads it runs through, in the writer's order. The first is its row. */
  readonly threads: readonly StoryThreadId[]
  /** The heading's light, as `readSlugline` reads it - what `light-vs-clock` checks. */
  readonly light: Light
  /** What the page says about when: the heading's time of day and how it binds, and the first action line naming a time. Read at request time (`@folio/script`'s `time-cues.ts`), never stored. */
  readonly cues: SceneCues | null
}

/** A scene's time cues as the route draws them - `SceneTimeCues` without the id and the light the row already carries. */
export type SceneCues = {
  readonly timeOfDay: string | null
  readonly bind: HeadingBind
  readonly action: { readonly nodeId: NodeId; readonly quote: string; readonly offsetDays: number | null } | null
}

/** A thread with what the grid needs beside it: how many present scenes it runs through. */
export type StoryThreadRow = StoryThread & {
  readonly scenes: number
  /** How many of those sit in its row - scenes whose first thread it is. The rest are `shared`. */
  readonly lanes: number
  /** First and last episode ordinal it touches, or null with no scene. */
  readonly span: { readonly from: number; readonly to: number } | null
}

/** One episode column of the story-order grid. */
export type TimelineEpisodeColumn = {
  readonly episode: EpisodeSlug
  readonly ordinal: number
  readonly title: string
  /** The measured page count, or null when unmeasured. */
  readonly pages: number | null
  readonly scenes: number
  readonly placed: number
  /** The frame story's first and last day in the episode, or null while nothing in it is placed. */
  readonly days: { readonly from: number; readonly to: number } | null
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/**
 * The continuity check's kinds, as the `timeline_findings` enum spells them
 * (`0023`). The check is `@folio/script`'s `continuity.ts`, pure and
 * unstored; a row here is the writer's `It's deliberate` on one of its
 * findings, keyed on the finding's stable `key`. Ruled 2026-09-18: the
 * `character_findings` shape, a row only when the writer says deliberate.
 */
export const CONTINUITY_KINDS = [
  'order',
  'flashback',
  'flashforward',
  'same-day-unclocked',
  'two-places',
  'before-introduction',
  'light-vs-clock',
  'thread-silent',
  'day-gap',
] as const

assertExact<Equals<(typeof CONTINUITY_KINDS)[number], ContinuityKind>>()

export const ContinuityKindSchema = z.enum(CONTINUITY_KINDS)

/** What marking a finding deliberate takes: the finding, as the check identified it. */
export const FindingVerdictSchema = z.object({
  kind: ContinuityKindSchema,
  key: z.string().min(1).max(200),
  aRef: NodeIdSchema,
  bRef: NodeIdSchema.nullable(),
  subject: z.string().max(80).nullable(),
})

export type FindingVerdict = z.infer<typeof FindingVerdictSchema>
