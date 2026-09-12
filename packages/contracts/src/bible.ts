import type { BibleEntryKind, BibleEntryStatus, BibleSection, CharacterId, LocationId } from '@folio/script'
import { BIBLE_ENTRY_KINDS, BIBLE_ENTRY_STATUSES, BIBLE_SECTIONS } from '@folio/script'
import { z } from 'zod'

import type { EpisodeBar, SceneRef } from './characters'
import { assertExact } from './equality'
import type { Equals } from './equality'
import type { BibleEntryId, BibleFactId, BiblePitchFieldId, BibleQuestionId, BibleTermId, UserId } from './ids'
import { NodeIdSchema } from './ids'
import type { Timestamp } from './primitives'
import { TitleSchema } from './primitives'

/**
 * The Bible route: what a writer authors, and the read model the route
 * draws.
 *
 * The brief: "What is true in this world, and what the draft is
 * contradicting. Authored entries whose facts cite derived scenes." Every
 * input here is authored - an entry, a fact, a question, a Pitch field, a
 * glossary term - and the closed sets an input draws on (section, status,
 * kind) are `@folio/script`'s, re-expressed as schemas and held equal by
 * `assertExact`, because the status gate lives in the pure core and a
 * second spelling of the set here would let the two drift.
 *
 * ## A fact cites a scene by its heading node's id
 *
 * "Every fact cites the scene that establishes it." A cite is a `NodeId`
 * with no foreign key - the `key_lines` rule: the route prints the scene's
 * current episode and number at render, so a cite survives a renumbering,
 * and a scene the script has since lost is dropped on read, never shown
 * from a copy. A fact with no live cite is the bundle's "not yet on the
 * page".
 *
 * ## A conflict is a scene and a note
 *
 * "Facts can carry a recorded conflict with the current draft." Recorded:
 * the writer names the scene that contradicts the rule and says how. It is
 * one conflict per fact at a time; deciding it (the check view's three
 * buttons) clears it. Whether it *counts* - only on a canon entry, only
 * while the scene is in the draft - is `openConflicts` in the pure core.
 *
 * ## The Pitch is an entry of another kind
 *
 * "A separate Pitch entry is ordered key/value fields, exportable on its
 * own, and deliberately kept apart from the rules." One per project, kind
 * `pitch`, in the Premise section; it has fields and questions and no
 * facts. `BibleEntryView` carries both shapes and the kind says which is
 * drawn.
 */

// ---------------------------------------------------------------------------
// Vocabulary, borrowed
// ---------------------------------------------------------------------------

export const BibleSectionSchema = z.enum(BIBLE_SECTIONS)
export const BibleEntryStatusSchema = z.enum(BIBLE_ENTRY_STATUSES)
export const BibleEntryKindSchema = z.enum(BIBLE_ENTRY_KINDS)

assertExact<Equals<z.infer<typeof BibleSectionSchema>, BibleSection>>()
assertExact<Equals<z.infer<typeof BibleEntryStatusSchema>, BibleEntryStatus>>()
assertExact<Equals<z.infer<typeof BibleEntryKindSchema>, BibleEntryKind>>()

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const line = (max: number) => z.string().trim().max(max).nullable()

/**
 * A new entry: a title and its section. The kind is `rules` unless the
 * caller asks for the Pitch, which takes its title and section from the
 * pure core and is refused when one exists.
 */
export const BibleEntryCreateSchema = z.object({
  title: TitleSchema,
  section: BibleSectionSchema,
})

export type BibleEntryCreate = z.infer<typeof BibleEntryCreateSchema>

/**
 * The entry's authored text. Optional on the way in so one inline edit
 * saves one field; an empty string is stored as `null`. The title is never
 * empty - an entry with no name cannot be found in the nav.
 */
export const BibleEntryEditSchema = z
  .object({
    title: TitleSchema,
    lede: line(2_000),
    notes: line(20_000),
  })
  .partial()

export type BibleEntryEdit = z.infer<typeof BibleEntryEditSchema>

/** One fact: its text and the scenes it cites, whole. */
export const BibleFactEditSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  cites: z.array(NodeIdSchema).max(20),
})

export type BibleFactEdit = z.infer<typeof BibleFactEditSchema>

/** A recorded conflict: the scene, and what it says that the rule forbids. */
export const BibleConflictEditSchema = z.object({
  sceneNodeId: NodeIdSchema,
  note: z.string().trim().min(1).max(2_000),
})

export type BibleConflictEdit = z.infer<typeof BibleConflictEditSchema>

export const BibleQuestionEditSchema = z.object({
  text: z.string().trim().min(1).max(1_000),
})

export type BibleQuestionEdit = z.infer<typeof BibleQuestionEditSchema>

/** A Pitch field, whole. The key is never empty; the value may be. */
export const BiblePitchFieldEditSchema = z.object({
  key: z.string().trim().min(1).max(60),
  value: z.string().trim().max(4_000),
})

export type BiblePitchFieldEdit = z.infer<typeof BiblePitchFieldEditSchema>

/** A glossary term, whole. The definition may be empty while the writer thinks. */
export const BibleTermEditSchema = z.object({
  term: z.string().trim().min(1).max(80),
  definition: z.string().trim().max(1_000),
})

export type BibleTermEdit = z.infer<typeof BibleTermEditSchema>

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/** One row of the bible nav. In section order, then the writer's order. */
export type BibleNavEntry = {
  readonly id: BibleEntryId
  readonly section: BibleSection
  readonly kind: BibleEntryKind
  readonly status: BibleEntryStatus
  readonly title: string
  /** Carries an open conflict - the nav's amber dot. */
  readonly contradicted: boolean
}

export type BibleFactRow = {
  readonly id: BibleFactId
  readonly position: number
  readonly text: string
  /** The cited scenes still in the draft, in the writer's order. */
  readonly cites: readonly SceneRef[]
  /** The recorded conflict, when its scene is still in the draft. */
  readonly conflict: { readonly scene: SceneRef; readonly note: string } | null
}

export type BibleQuestionRow = {
  readonly id: BibleQuestionId
  readonly text: string
  readonly author: { readonly id: UserId; readonly name: string; readonly initials: string }
  readonly resolved: boolean
}

export type BiblePitchFieldRow = {
  readonly id: BiblePitchFieldId
  readonly key: string
  readonly value: string
}

/** What an entry is linked to in the script - all read off its cited scenes. */
export type BibleEntryLinks = {
  readonly characters: readonly { readonly id: CharacterId; readonly name: string }[]
  readonly locations: readonly { readonly id: LocationId; readonly name: string }[]
  /** Other entries in the same section. */
  readonly related: readonly { readonly id: BibleEntryId; readonly title: string }[]
}

export type BibleEntryView = {
  readonly id: BibleEntryId
  readonly section: BibleSection
  readonly kind: BibleEntryKind
  readonly status: BibleEntryStatus
  readonly title: string
  readonly lede: string | null
  readonly notes: string | null
  readonly updatedAt: Timestamp
  /** Empty for the Pitch. */
  readonly facts: readonly BibleFactRow[]
  readonly questions: readonly BibleQuestionRow[]
  /** Empty for a rules entry. */
  readonly fields: readonly BiblePitchFieldRow[]
  readonly links: BibleEntryLinks
  /** Distinct scenes the entry's facts cite - "Scenes that touch this". */
  readonly mentions: number
  readonly perEpisode: readonly EpisodeBar[]
}

/** One open conflict as the canon check draws it. */
export type CanonConflictRow = {
  readonly factId: BibleFactId
  readonly entryId: BibleEntryId
  readonly entryTitle: string
  readonly rule: string
  /** The first cite and its opening line, or null for an uncited rule. */
  readonly established: { readonly scene: SceneRef; readonly excerpt: string } | null
  readonly contradicts: { readonly scene: SceneRef; readonly excerpt: string; readonly note: string }
}

export type GlossaryRow = {
  readonly id: BibleTermId
  readonly term: string
  readonly definition: string
  /** Derived: where the term is first said, or null when it is not said. */
  readonly firstSaid: SceneRef | null
  /** Derived: whole-word uses across the script. */
  readonly uses: number
}

/** The footer's and the nav footer's numbers. Every one a count of rows. */
export type BibleCounts = {
  readonly entries: number
  readonly facts: number
  readonly canonFacts: number
  readonly conflicts: number
  readonly terms: number
}
