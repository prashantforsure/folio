import type { Confidence, NodeId, PropId } from '@folio/script'
import { z } from 'zod'

import type { AliasProvenance, SceneRef } from './characters'

/**
 * The Props route: a thing the film has to put in front of the camera.
 *
 * ## A prop is an authored record, and Props is authoritative for one
 *
 * Unlike a character or a set, a prop is **not derived from the node
 * list**. Nothing in a screenplay's grammar names one: a slugline is a
 * set, a cue is a person, and a bat, a letter or a deflated ball is just a
 * noun in a line of action. So `props` is AUTHORED end to end
 * (`packages/db`, `schema/index.ts`) - the writer makes the record - and
 * the script is read back at request time as *evidence* for it
 * (`@folio/script`, `props.ts`), never stored, never a queue, never a
 * source of new records. AGENTS.md, "Nothing is stored that can be
 * computed": the evidence is a reading over rows already in hand for the
 * one request that draws it, exactly as `sets.ts` is for Locations.
 *
 * Being the one authored home for a prop is what makes it authoritative:
 * Production's `scenes.prop` and `reel_shots.prop` were free text, two
 * columns in which "Game ball", "game ball" and "the ball" were three
 * props and none of them was a record. They are `prop_id` foreign keys
 * now, so the Production board and this route name one thing.
 *
 * ## The aliases are the mechanism, again
 *
 * "Game Ball" is a record name; the page writes "the ball". `prop_aliases`
 * is the writer saying the two are one thing, and it is what makes the
 * evidence reading find anything at all - the same alias-table mechanism
 * AGENTS.md, Entity identity names for characters and sets, scored by the
 * same `alias.ts`.
 *
 * With one difference, deliberately: **there is no unique index per
 * project**. Two props may both be "the bag" - the one Meera carries and
 * the one that comes back empty - and both should collect the line. So
 * binding an alias never has a "taken" outcome here, and there is no
 * resolve queue to send an ambiguity to (v1; a third one would need a
 * ruling).
 *
 * ## Category is free text, not an enum
 *
 * A production's vocabulary for props is its own - `Hand prop`, `Set
 * dressing`, `Costume`, `Picture vehicle`, `Practical` - and it differs by
 * department, by country and by show. An enum here would be this file
 * guessing at somebody's breakdown sheet. So `category` is one authored
 * line, and the route's menu offers the values the project already uses,
 * which is a list that grows by being typed in rather than by a migration.
 *
 * ## What v1 deliberately does not do
 *
 * No resolve queue, no tree (a prop is not a sub-prop of a prop; a kit bag
 * containing a ball is two records and the writer's own sentence), and
 * **no rename write-back**. A location rename rewrites every heading that
 * uses it because a heading *is* the set text; a prop's name appears
 * nowhere the app owns, so there is nothing to rewrite - and AGENTS.md's
 * exception table says there are exactly two sanctioned write-backs and
 * "there is no third case. Escalate". Renaming a prop renames the record
 * and nothing else.
 */

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Where a prop is in being got hold of. `needed` is what a new record
 * mints as - the writer has named it and nobody has found one; `sourced`
 * says it exists somewhere; `on set` says it is where the camera is.
 * Three, on the Locations route's reasoning for its three: a status with
 * more steps than a writer will actually keep up to date is a field that
 * goes stale and lies.
 */
export const PROP_STATUSES = ['needed', 'sourced', 'on set'] as const

export type PropStatus = (typeof PROP_STATUSES)[number]

export const PropStatusSchema = z.enum(PROP_STATUSES)

/** How a status reads on the segmented control, the dot's title and the list's cell. */
export const PROP_STATUS_LABELS: Readonly<Record<PropStatus, string>> = {
  needed: 'Needed',
  sourced: 'Sourced',
  'on set': 'On set',
}

/** The photo: the same three formats and the same ceiling as a portrait and a location photo. */
export const PROP_PHOTO_MAX_BYTES = 5 * 1024 * 1024

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const line = (max: number) => z.string().trim().max(max).nullable()

/**
 * The record's authored fields. `.partial()` so one save writes what
 * changed, the Locations route's shape; an empty string is stored as
 * `null`. The name is not here - it is `TitleSchema` at the action, as
 * every record route's is.
 */
export const PropEditSchema = z
  .object({
    /** Free text offered from what the project already uses. Never an enum. */
    category: line(80),
    description: line(20_000),
    status: PropStatusSchema,
  })
  .partial()

export type PropEdit = z.infer<typeof PropEditSchema>

/** One alias as it arrives: a spelling the page uses for this prop. */
export const PropAliasSchema = z.string().trim().min(1).max(200)

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/** One bound alias as the drawer's table prints it. */
export type PropAliasView = {
  readonly alias: string
  readonly provenance: AliasProvenance
  /** Lines of action this spelling reads in. `0` for a spelling the page does not use yet. */
  readonly lines: number
  /** Whether it is the record's own name, which cannot be unbound on its own. */
  readonly isName: boolean
}

/** One line of action the script writes about this prop, as the drawer quotes it. */
export type PropEvidenceRow = {
  readonly nodeId: NodeId
  readonly text: string
  readonly confidence: Confidence
  readonly scene: SceneRef
}

/** One shot of Production's that names this prop - the route being authoritative, read back. */
export type PropShotRow = {
  readonly shotId: string
  readonly label: string
  readonly sceneNodeId: NodeId
  readonly sceneNumber: number
}

/**
 * One prop, whole: what the card, the list row and the drawer print. One
 * shape, because the drawer opens over any card and the list prints every
 * record, so every view reads every field - the `LocationRow` reasoning.
 *
 * `PropRow` is a **type, not a schema**. It is a read model assembled by
 * the loader out of rows and readings, never parsed off a wire: a Zod
 * object for it would be a second, drifting description of what
 * `lib/props/server.ts` already builds, and this package's rule is that
 * types flow from here, not that every type is a schema.
 */
export type PropRow = {
  readonly id: PropId
  readonly name: string
  /** The writer's word for what kind of thing it is, or null. */
  readonly category: string | null
  readonly description: string | null
  readonly status: PropStatus
  /** A public URL for the photo, or null with none set or no storage. */
  readonly photoUrl: string | null
  /** Every bound alias, the name included - the alias table's authored half. */
  readonly aliases: readonly string[]
  /** The same, as the drawer draws it. */
  readonly bound: readonly PropAliasView[]
  /** Lines of action that read as being about it, in document order, capped. */
  readonly evidence: readonly PropEvidenceRow[]
  /** How many lines in total - `evidence` is capped, this is not. */
  readonly lines: number
  /** Distinct scenes the evidence falls in, in reading order. */
  readonly scenes: readonly SceneRef[]
  /** Production shots whose `prop_id` is this record. */
  readonly shots: readonly PropShotRow[]
  /** How many Production scene-setup rows name this record. */
  readonly sceneSetups: number
  readonly firstSeen: SceneRef | null
  readonly lastSeen: SceneRef | null
  readonly createdAt: string
}
