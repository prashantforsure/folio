import type { CharacterId, Confidence, MatchReason, NodeId, Presence } from '@folio/script'
import { z } from 'zod'

import { CharacterIdSchema } from './ids'
import type { EpisodeSlug } from './ids'
import { CanvasPositionSchema } from './storyboard'
import type { CanvasPosition } from './storyboard'

/**
 * The Characters route: what a writer authors on top of a derived record,
 * and the read model the route draws.
 *
 * AGENTS.md, Entity identity: a character is "a stable UUID with a name
 * attribute", derived from cues and `@mentions`. The derived half is
 * `derived.ts` (`CharacterDerivationSchema`, the tallies, the queue). This
 * file is the authored half's *inputs* - what the drawers accept - and the
 * shapes the route reads, which join the two halves by id and never
 * recombine them into a row a re-derive could clobber.
 *
 * ## The fourth pass (2026-09-20)
 *
 * The route is laper.ai's shape by the client's ruling - a canvas of cards,
 * a Relationships graph, a List, a form drawer ("Characters, fourth pass"
 * in `docs/build-decisions.md`). The read model is what those draw:
 * `CastRow` is the profile the writer authors, where the record came from
 * (`origin`), where the canvas left its card (`canvas`, `0024`) and the
 * counts the pass wrote (scenes, lines, words, who they talk to);
 * `Relationship` is one authored row per pair with two directional labels
 * (`0024` reshaped the table). The third pass's evidence - quoted lines,
 * introductions, the presence map, the findings - left the read model
 * with the views that drew it; the `status` / `wants` / `needs` columns
 * stay in the schema unread (dropping them is ask-first).
 *
 * Migration `0013` dropped the first pass's drives, arc turns, voice rules
 * and key lines; `0017` brought back `wants`, `needs` and `status`; `0021`
 * added the voice columns and `origin`; `0022` the findings table (orphaned
 * since this pass); `0024` the canvas position and the relationship shape.
 *
 * ## Colour is a token name
 *
 * `color` is one of `CHARACTER_COLORS` - the name of a `--chip-N` custom
 * property in `packages/ui`, never a hex. The picker shows the display
 * name; the chip reads the token. A colour outside the list is refused at
 * the boundary and by a column check.
 */

export const CHARACTER_GENDERS = ['female', 'male', 'non_binary', 'other'] as const

export type CharacterGender = (typeof CHARACTER_GENDERS)[number]

export const CharacterGenderSchema = z.enum(CHARACTER_GENDERS)

/** How the gender reads on a card and in the casting table. `null` is "Not set", and is not printed. */
export const CHARACTER_GENDER_LABELS: Readonly<Record<CharacterGender, string>> = {
  female: 'Female',
  male: 'Male',
  non_binary: 'Non-binary',
  other: 'Other',
}

/**
 * The ten character colours, by token name. `hue` is the number in the
 * `--chip-N` custom property, which is what `IdentityChip` reads. The names
 * are the swatches' titles.
 */
export const CHARACTER_COLORS = [
  { id: 'chip-1', hue: 1, name: 'Terracotta' },
  { id: 'chip-2', hue: 2, name: 'Violet' },
  { id: 'chip-3', hue: 3, name: 'Slate' },
  { id: 'chip-4', hue: 4, name: 'Forest' },
  { id: 'chip-5', hue: 5, name: 'Ochre' },
  { id: 'chip-6', hue: 6, name: 'Graphite' },
  { id: 'chip-7', hue: 7, name: 'Cobalt' },
  { id: 'chip-8', hue: 8, name: 'Gold' },
  { id: 'chip-9', hue: 9, name: 'Rose' },
  { id: 'chip-10', hue: 10, name: 'Moss' },
] as const

export type CharacterColor = (typeof CHARACTER_COLORS)[number]['id']

export const CHARACTER_COLOR_IDS = [
  'chip-1',
  'chip-2',
  'chip-3',
  'chip-4',
  'chip-5',
  'chip-6',
  'chip-7',
  'chip-8',
  'chip-9',
  'chip-10',
] as const satisfies readonly CharacterColor[]

export const CharacterColorSchema = z.enum(CHARACTER_COLOR_IDS)

export const DEFAULT_CHARACTER_COLOR: CharacterColor = 'chip-1'

/** The `--chip-N` index of a colour token. An unknown token reads as the default's. */
export const hueOfColor = (color: string): number =>
  CHARACTER_COLORS.find((entry) => entry.id === color)?.hue ?? 1

/**
 * The status a writer gave a record in the v2 pass (`0017`): `draft`,
 * `defined`, `locked`. Unread by the route since the fourth pass
 * (2026-09-20) - the column stays, and the assistant's Focus block still
 * prints it; dropping it is ask-first.
 */
export const CHARACTER_STATUSES = ['draft', 'defined', 'locked'] as const

export type CharacterStatus = (typeof CHARACTER_STATUSES)[number]

export const CharacterStatusSchema = z.enum(CHARACTER_STATUSES)

export const CHARACTER_STATUS_LABELS: Readonly<Record<CharacterStatus, string>> = {
  draft: 'Draft',
  defined: 'Defined',
  locked: 'Locked',
}

/**
 * Where a record came from - written once, at creation, never changed
 * (migration `0021`): a pass minted it from a cue, the writer made it by
 * hand, an `@` mention made it, or the assistant did. Records made before
 * `0021` carry `null` and print no origin. The drawer's meta line says it
 * in words, so a writer can tell a record they made from one the script
 * made.
 */
export const CHARACTER_ORIGINS = ['derived', 'hand', 'mention', 'agent'] as const

export type CharacterOrigin = (typeof CHARACTER_ORIGINS)[number]

export const CharacterOriginSchema = z.enum(CHARACTER_ORIGINS)

export const CHARACTER_ORIGIN_LABELS: Readonly<Record<CharacterOrigin, string>> = {
  derived: 'minted from the script',
  hand: 'added by hand',
  mention: 'added from an @ mention',
  agent: 'added by the assistant',
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const line = (max: number) => z.string().trim().max(max).nullable()

/**
 * The drawer's authored fields, and the New drawer's. Every field is
 * optional on the way in; a field that is present is written whole, and an
 * empty string is stored as `null` - the column is "no role", not "an
 * empty role". The name is not here: a changed name is a rename, and a
 * rename is the sanctioned write-back with its own action. `status`,
 * `wants` and `needs` left the edit with the fourth pass; the columns keep
 * whatever an earlier pass wrote.
 */
export const CharacterProfileEditSchema = z
  .object({
    color: CharacterColorSchema,
    gender: CharacterGenderSchema.nullable(),
    age: line(40),
    role: line(200),
    bio: line(20_000),
    appearance: line(4_000),
  })
  .partial()

export type CharacterProfileEdit = z.infer<typeof CharacterProfileEditSchema>

/** What `+ New` sends: a name, and any of the profile's fields. */
export const NewCharacterSchema = CharacterProfileEditSchema.extend({
  name: z.string().trim().min(1).max(200),
})

export type NewCharacter = z.infer<typeof NewCharacterSchema>

/**
 * A relationship as the modal sends it (the fourth pass, `0024`): the two
 * records, what `a` is to `b` and `b` to `a` - at most one word or two
 * (`sister`, `former partner`) - and a line under them. The pair arrives in
 * either order; `orderInput` (`lib/characters/relationships.ts`) sorts it
 * and swaps the labels with it before the write, so the row's `a` is the
 * lower id. At least one label is written: a relationship nobody named is
 * not one.
 */
const label = z.string().trim().max(40)

export const RelationshipInputSchema = z
  .object({
    aId: CharacterIdSchema,
    bId: CharacterIdSchema,
    aIs: label,
    bIs: label,
    description: z.string().trim().max(500).nullable(),
  })
  .refine((input) => input.aId !== input.bId, { message: 'A relationship is between two different characters.' })
  .refine((input) => input.aIs !== '' || input.bIs !== '', { message: 'Name at least one side of the relationship.' })

export type RelationshipInput = z.infer<typeof RelationshipInputSchema>

/** The row as the route reads it: the pair sorted, both labels, the line, the stamps. */
export type Relationship = {
  readonly aId: CharacterId
  readonly bId: CharacterId
  readonly aIs: string
  readonly bIs: string
  readonly description: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** Where a card sits on the Characters canvas: the Storyboard's shape, reused whole. */
export { CanvasPositionSchema }
export type { CanvasPosition }

/** What a portrait upload accepts. The bytes are sniffed on the server; this is the declared shape. */
export const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024

export const PORTRAIT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type PortraitType = (typeof PORTRAIT_TYPES)[number]

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/** A scene, named the way the route prints one: `E1 Sc 4`. Locations and Research construct it too. */
export type SceneRef = {
  readonly sceneNodeId: NodeId
  readonly episode: EpisodeSlug
  readonly episodeOrdinal: number
  readonly number: number
  readonly heading: string
}

/** One row of the alias table: a counted spelling and what it accounts for. */
export type CueVariantRow = {
  readonly cue: string
  /** The canonical key the tally is grouped by - what bound spellings are matched against. */
  readonly key: string
  readonly occurrences: number
  readonly lines: number
  readonly words: number
}

export type ExchangeRow = {
  readonly other: CharacterId
  readonly count: number
  readonly scenes: readonly NodeId[]
}

/** One card of the canvas, one tile of the graph, one row of the List. Production reads the same row for its cast column. */
export type CastRow = {
  readonly id: CharacterId
  readonly name: string
  readonly color: CharacterColor
  /** `--chip-N`, from `color`. */
  readonly hue: number
  readonly gender: CharacterGender | null
  readonly age: string | null
  readonly role: string | null
  readonly bio: string | null
  /** The look-sheet notes. Production's cast column prints it under the name. */
  readonly appearance: string | null
  /** A public URL for the portrait, or null with none set or no storage. */
  readonly portraitUrl: string | null
  readonly origin: CharacterOrigin | null
  readonly presence: Presence
  readonly appearances: number
  readonly lines: number
  /** Dialogue words, the share's numerator. */
  readonly words: number
  /** Heading node ids the character is in, in document order. */
  readonly scenes: readonly NodeId[]
  /** Counted spellings, first-appearance order - what a rename counts against. */
  readonly cues: readonly CueVariantRow[]
  /** Who they exchange lines with - the graph's `Dialogue` layout. */
  readonly exchanges: readonly ExchangeRow[]
  /** Where the canvas left the card (`0024`); null when nobody has moved it. */
  readonly canvas: CanvasPosition | null
}

/** What the drawer reads beyond the card. */
export type CharacterProfile = CastRow & {
  /** Cues a record-level rename would rewrite: every counted cue that is the name. */
  readonly nameCues: number
  /** This record's authored relationships, either side (`0024`). */
  readonly relationships: readonly Relationship[]
}

/**
 * Who bound a spelling: derivation (`bound_by` null - the name's own spelling,
 * or a mint), the signed-in writer, or another member. The Characters
 * alias table left with the fourth pass; Locations' slugline table still
 * prints it as a mono tag.
 */
export type AliasProvenance = 'derived' | 'you' | 'member'

export type ResolveProposal =
  | {
      readonly kind: 'character'
      readonly id: CharacterId
      readonly name: string
      readonly hue: number
      readonly confidence: Confidence
      /** Why the pass proposed this record - recomputed at load from the same scoring; null when the pool has moved on. */
      readonly reason: MatchReason | null
    }
  | { readonly kind: 'new-record'; readonly confidence: Confidence }

/** One record a cue resembles, for the queue's `Someone else…` menu: best first. */
export type ResolveCandidate = {
  readonly id: CharacterId
  readonly name: string
  readonly hue: number
  readonly confidence: Confidence
  readonly reason: MatchReason
}

/**
 * One open row of the resolve queue, for a cue. Drawn as a row of the queue
 * at the head of the Cast view, and as a conflict block on the card its
 * proposal names. A row with no proposal is a walk-on: the writer said this
 * cue is nobody, and it is listed under the queue, not in it.
 */
export type ResolveItem = {
  readonly key: string
  readonly cue: string
  readonly occurrences: number
  readonly scenes: readonly SceneRef[]
  readonly proposal: ResolveProposal | null
  /** The records this cue resembles, best first, the proposal's included. */
  readonly candidates: readonly ResolveCandidate[]
}

/** One side of a pair of records that read as one person. */
export type PairSide = {
  readonly id: CharacterId
  readonly name: string
  readonly hue: number
  readonly appearances: number
}

/**
 * Two records that read as one person (`similarRecords`), drawn as a row of
 * the queue: `MEERA PAWAR reads like Meera - two records.` `keep` is the
 * record with more scenes (the earlier on a tie), `other` the one a merge
 * would fold into it. `key` is the decision row's (`record:<a>:<b>`, ids
 * sorted) so `They're different people` is remembered across passes.
 */
export type PairItem = {
  readonly key: string
  readonly keep: PairSide
  readonly other: PairSide
  readonly confidence: Confidence
}

/** What the Script editor needs to colour and label a cue: the record, its name, its colour, its scene count. */
export type CueBookEntry = {
  readonly key: string
  readonly id: CharacterId
  readonly name: string
  readonly color: CharacterColor
  readonly appearances: number
}
