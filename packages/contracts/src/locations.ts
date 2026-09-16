import type { CharacterId, Confidence, InteriorExterior, Light, LocationId, Presence } from '@folio/script'
import { z } from 'zod'

import type { SceneRef } from './characters'
import { LocationIdSchema } from './ids'

/**
 * The Locations route: what a writer authors on top of a derived record,
 * and the read model the route draws.
 *
 * AGENTS.md, Entity identity: "Same identity model as Characters, with two
 * differences that matter": a location is **a tree, not a list**, and
 * renaming one **rewrites every scene heading that uses it**. The derived
 * half is `derived.ts` (`LocationDerivationSchema`, the tallies, the queue).
 * This file is the authored half's *inputs* - the description, the address,
 * the scouting status, the tree edge - and the shapes the route reads, which
 * join the two halves by id and never recombine them into a row a re-derive
 * could clobber.
 *
 * ## The v2 pass (2026-09-16)
 *
 * `docs/ui design/Route - Locations v2.dc.html` draws a scouting status the
 * writer sets (`Pending | Scouted | Locked` - a segmented control in the
 * drawer, a badge on the card, a pill in the sheet), an address, and a
 * photo. Migration `0018` adds the three columns. The arc note per episode
 * ("How this place changes") is gone with the same migration: nothing in
 * the v2 package draws one and nothing else read the table.
 *
 * ## Counts are the roll-up
 *
 * "Breakdown and scheduling count shooting days **by set**, and a flat list
 * cannot answer 'how many days in the chawl'." Every count on a card, a
 * sheet row and the drawer's head is `location_derivations.rollup_*` - this
 * set plus every descendant. `own` is carried beside it for a sub-set's own
 * line.
 *
 * ## Interior / exterior is read, not stored
 *
 * A record has no `ie` column: it is a set, and the same set is `INT.` in one
 * heading and `EXT.` in the next. The route reads its scenes' readings and
 * prints `INT`, `EXT`, or `INT/EXT` when both occur - `null` for a record
 * with no scene in the script, which prints `—`.
 */

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The scouting status a writer gives a record. `pending` is what a
 * derivation pass mints and what `New` creates; `scouted` says the place is
 * found; `locked` says stop looking. README, "Status as a dot plus a pill":
 * amber for pending (a decision waiting), green for scouted (settled),
 * accent for locked. The tone is the route's (`lib/locations/view.ts`).
 */
export const LOCATION_STATUSES = ['pending', 'scouted', 'locked'] as const

export type LocationStatus = (typeof LOCATION_STATUSES)[number]

export const LocationStatusSchema = z.enum(LOCATION_STATUSES)

/** How a status reads. Specified copy - the mockup's segmented control. */
export const LOCATION_STATUS_LABELS: Readonly<Record<LocationStatus, string>> = {
  pending: 'Pending',
  scouted: 'Scouted',
  locked: 'Locked',
}

/** The photo: the same three formats and the same ceiling as a portrait. */
export const LOCATION_PHOTO_MAX_BYTES = 5 * 1024 * 1024

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const line = (max: number) => z.string().trim().max(max).nullable()

/**
 * The record's authored fields. Optional on the way in so one save writes
 * what changed; an empty string is stored as `null`. `scheduled_days` is
 * not here: the v2 drawer has no field for it (see `docs/build-decisions.md`,
 * "Redesign phase 4").
 */
export const LocationEditSchema = z
  .object({
    description: line(20_000),
    /** "Actual or fictional address…" - one line. */
    address: line(400),
    status: LocationStatusSchema,
  })
  .partial()

export type LocationEdit = z.infer<typeof LocationEditSchema>

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

/**
 * What kind of place a record is, read off the tree and its counts - the
 * mockup's `kind` (`Primary set`, `Recurring exterior`, `One-off`), which
 * it authors and this route derives. `lib/locations/view.ts` says how.
 */
export type LocationKind = 'primary' | 'sub' | 'recurring' | 'one-off' | 'off-page'

/** One row of the alias table as the record shows it: a heading spelling and its count. */
export type SluglineVariantRow = {
  readonly slugline: string
  readonly occurrences: number
}

/** One scene at this set or a descendant, as the "Scenes here" view prints it. */
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

export type LocationPersonRow = {
  readonly id: CharacterId
  readonly name: string
  readonly hue: number
  readonly scenes: number
}

export type StructureResolveProposal =
  | {
      readonly kind: 'attach'
      readonly parent: { readonly id: LocationId; readonly name: string }
      readonly confidence: Confidence
    }
  | { readonly kind: 'new-parent'; readonly name: string; readonly confidence: Confidence }

/**
 * One open row for a record whose own name reads like a sub-set of another.
 * The one disagreement between a record and the script the model detects
 * here - README, "Conflict blocks": the card's border turns `--warn` and an
 * amber block offers to accept the edge or mark the record deliberate.
 */
export type StructureResolveItem = {
  readonly key: string
  readonly location: { readonly id: LocationId; readonly name: string }
  readonly scenes: number
  readonly proposal: StructureResolveProposal
}

/**
 * One location, whole: what the sidebar row, the card, the sheet row, the
 * "Scenes here" section and the drawer print. One shape, because the drawer
 * opens over any card and the "Scenes here" view lists every record's
 * scenes, so every view reads every field.
 */
export type LocationRow = {
  readonly id: LocationId
  readonly name: string
  readonly parentId: LocationId | null
  readonly parent: { readonly id: LocationId; readonly name: string } | null
  /** 0 for a primary set. */
  readonly depth: number
  /** Read from the scenes' headings; `null` with no scene in the script. */
  readonly ie: InteriorExterior | null
  readonly presence: Presence
  readonly kind: LocationKind
  /** This set alone. */
  readonly own: LocationCounts
  /** This set plus every descendant. What every count on the route prints. */
  readonly rollup: LocationCounts
  readonly children: number
  readonly status: LocationStatus
  readonly address: string | null
  readonly description: string | null
  /** A public URL for the photo, or null with none set or no storage. */
  readonly photoUrl: string | null
  /** Counted heading spellings here or below, first-appearance order. Derived. */
  readonly sluglines: readonly SluglineVariantRow[]
  /** Every bound set text of this record, counted or not - the alias table's authored half. */
  readonly boundSluglines: readonly string[]
  /** Every scene here or below, in reading order. */
  readonly scenes: readonly LocationSceneRow[]
  /** Who is here, most scenes first. */
  readonly people: readonly LocationPersonRow[]
  /** Scenes here or below per episode, in running order - the README's episode bars. */
  readonly perEpisode: readonly number[]
  /** Summed over every measured scene here or below; `null` when none is. */
  readonly eighths: number | null
  readonly firstSeen: SceneRef | null
  readonly lastSeen: SceneRef | null
  /** Headings a record-level rename would rewrite: every counted heading whose set is the name. */
  readonly nameHeadings: number
  /** Open structure proposals about this record - the conflict block. */
  readonly conflicts: readonly StructureResolveItem[]
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
