import type { CharacterId, Confidence, InteriorExterior, Light, LocationId, Presence } from '@folio/script'
import { z } from 'zod'

import type { SceneRef } from './characters'
import type { EpisodeId, EpisodeSlug } from './ids'
import { EpisodeIdSchema, LocationIdSchema } from './ids'

/**
 * The Locations route: what a writer authors on top of a derived record,
 * and the read model the route draws.
 *
 * AGENTS.md, Entity identity: "Same identity model as Characters, with two
 * differences that matter": a location is **a tree, not a list**, and
 * renaming one **rewrites every scene heading that uses it**. The derived
 * half is `derived.ts` (`LocationDerivationSchema`, the tallies, the queue).
 * This file is the authored half's *inputs* - the description, the arc note
 * per episode, the tree edge - and the shapes the route reads, which join
 * the two halves by id and never recombine them into a row a re-derive
 * could clobber.
 *
 * ## Counts are the roll-up
 *
 * "Breakdown and scheduling count shooting days **by set**, and a flat list
 * cannot answer 'how many days in the chawl'." Every count on a nav row, a
 * breakdown row and a record head is `location_derivations.rollup_*` - this
 * set plus every descendant. The record view says so on its sub-location
 * strip: "counted in the parent total". `own` is carried beside it for the
 * breakdown's sub-rows, which count themselves.
 *
 * ## Interior / exterior is read, not stored
 *
 * A record has no `ie` column: it is a set, and the same set is `INT.` in one
 * heading and `EXT.` in the next. The route reads its scenes' readings and
 * prints `INT`, `EXT`, or `INT/EXT` when both occur - `null` for a record
 * with no scene in the script, which prints `—`.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const line = (max: number) => z.string().trim().max(max).nullable()

/**
 * The record's authored fields. Optional on the way in so one inline edit
 * saves one field; an empty string is stored as `null`.
 */
export const LocationEditSchema = z
  .object({
    description: line(20_000),
    /** Shooting days scheduled at this set. Authored: nothing in a node list implies one. */
    scheduledDays: z.int().min(0).max(10_000),
  })
  .partial()

export type LocationEdit = z.infer<typeof LocationEditSchema>

/** One arc note, keyed by the episode row. An empty text clears it. */
export const ArcNoteEditSchema = z.object({
  episodeId: EpisodeIdSchema,
  text: z.string().trim().max(2_000),
})

export type ArcNoteEdit = z.infer<typeof ArcNoteEditSchema>

/** The tree edge: a parent, or `null` for a primary set. */
export const ParentEditSchema = LocationIdSchema.nullable()

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

export type LocationCounts = {
  readonly scenes: number
  readonly sluglines: number
  readonly dayScenes: number
  readonly nightScenes: number
  readonly shootingDays: number
}

/** One row of the location nav, and the head of a record. */
export type LocationRow = {
  readonly id: LocationId
  readonly name: string
  readonly parentId: LocationId | null
  /** 0 for a primary set. */
  readonly depth: number
  /** Read from the scenes' headings; `null` with no scene in the script. */
  readonly ie: InteriorExterior | null
  readonly presence: Presence
  /** This set alone. */
  readonly own: LocationCounts
  /** This set plus every descendant. What every count on the route prints. */
  readonly rollup: LocationCounts
  readonly children: number
}

/** One row of the alias table as the record shows it: a heading spelling and its count. */
export type SluglineVariantRow = {
  readonly slugline: string
  readonly occurrences: number
}

/** One scene at this set or a descendant, as the "Scenes here" list prints it. */
export type LocationSceneRow = {
  readonly scene: SceneRef
  readonly light: Light
  readonly timeOfDay: string | null
  /** The authored synopsis, when the writer wrote one. */
  readonly gist: string | null
  readonly cast: readonly { readonly id: CharacterId; readonly name: string; readonly hue: number }[]
  /** From the measurement record; `null` when the episode is unmeasured. */
  readonly eighths: number | null
  /** Which set in the tree the heading resolved to - the sub-set, for a primary set's list. */
  readonly at: { readonly id: LocationId; readonly name: string }
}

export type LocationArcNoteRow = {
  readonly episodeId: EpisodeId
  readonly episode: EpisodeSlug
  readonly ordinal: number
  readonly text: string | null
}

export type LocationEpisodeBar = {
  readonly episode: EpisodeSlug
  readonly ordinal: number
  readonly scenes: number
  readonly dayScenes: number
  readonly nightScenes: number
  /** Summed over the measured scenes; `null` when none of them is measured. */
  readonly eighths: number | null
}

export type LocationPersonRow = {
  readonly id: CharacterId
  readonly name: string
  readonly hue: number
  readonly scenes: number
}

export type LocationRecordView = LocationRow & {
  readonly description: string | null
  readonly scheduledDays: number
  readonly parent: { readonly id: LocationId; readonly name: string } | null
  /** The sub-sets, in nav order, each with its own counts. */
  readonly subLocations: readonly LocationRow[]
  /** Counted heading spellings, first-appearance order. Derived. */
  readonly sluglines: readonly SluglineVariantRow[]
  /** Every bound set text, counted or not - the alias table's authored half. */
  readonly boundSluglines: readonly string[]
  /** Every scene here or below, in reading order. */
  readonly scenes: readonly LocationSceneRow[]
  /** One row per episode in running order, the note null where none is written. */
  readonly arc: readonly LocationArcNoteRow[]
  readonly people: readonly LocationPersonRow[]
  readonly perEpisode: readonly LocationEpisodeBar[]
  /** Summed over every measured scene here or below; `null` when none is. */
  readonly eighths: number | null
  readonly firstSeen: SceneRef | null
  readonly lastSeen: SceneRef | null
  /** Headings a record-level rename would rewrite: every counted heading whose set is the name. */
  readonly nameHeadings: number
}

/** One cell of the breakdown: this set's scenes in one episode. */
export type BreakdownCell = {
  readonly scenes: number
  readonly dayScenes: number
  readonly nightScenes: number
  readonly eighths: number | null
}

export type BreakdownRow = LocationRow & {
  /** One cell per episode in running order. A primary set's cells are the roll-up. */
  readonly cells: readonly BreakdownCell[]
  readonly eighths: number | null
}

export type SluglineResolveProposal =
  | {
      readonly kind: 'location'
      readonly id: LocationId
      readonly name: string
      readonly confidence: Confidence
    }
  | { readonly kind: 'new-record'; readonly confidence: Confidence }

/** One open row of the resolve queue, for a slugline pointing at no record. */
export type SluglineResolveItem = {
  readonly key: string
  /** The set text as first authored. */
  readonly slugline: string
  readonly occurrences: number
  readonly scenes: readonly SceneRef[]
  readonly proposal: SluglineResolveProposal | null
}

export type StructureResolveProposal =
  | {
      readonly kind: 'attach'
      readonly parent: { readonly id: LocationId; readonly name: string }
      readonly confidence: Confidence
    }
  | { readonly kind: 'new-parent'; readonly name: string; readonly confidence: Confidence }

/** One open row for a record whose own name reads like a sub-set of another. */
export type StructureResolveItem = {
  readonly key: string
  readonly location: { readonly id: LocationId; readonly name: string }
  readonly scenes: number
  readonly proposal: StructureResolveProposal
}
