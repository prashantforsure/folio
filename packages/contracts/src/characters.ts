import type { CharacterId, Confidence, NodeId, Presence } from '@folio/script'
import { z } from 'zod'

import type { EpisodeSlug } from './ids'

/**
 * The Characters route: what a writer authors on top of a derived record,
 * and the read model the route draws.
 *
 * AGENTS.md, Entity identity: a character is "a stable UUID with a name
 * attribute", derived from cues and `@mentions`. The derived half is
 * `derived.ts` (`CharacterDerivationSchema`, the tallies, the queue). This
 * file is the authored half's *inputs* - what the modal and the drawer
 * accept - and the shapes the route reads, which join the two halves by id
 * and never recombine them into a row a re-derive could clobber.
 *
 * ## The second pass (2026-09-14)
 *
 * The route was rebuilt to the client's reference - a card grid, a
 * relationships graph, a casting table, one modal to create and one drawer
 * to edit. The profile a writer authors is now the facts a card shows:
 * colour, gender, age, role, a bio, appearance notes for the look sheet a
 * later job will draw, and a portrait. The drives, arc turns, voice rules,
 * key lines and relationship prose of the first pass were dropped with
 * migration `0013` on the client's ruling; `docs/build-decisions.md`,
 * "Characters route, second pass".
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
 * `--chip-N` custom property, which is what `IdentityChip` and the card tile
 * read. The names are the picker's.
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

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const line = (max: number) => z.string().trim().max(max).nullable()

/**
 * The drawer's authored fields, and the modal's. Every field is optional
 * on the way in; a field that is present is written whole, and an empty
 * string is stored as `null` - the column is "no role", not "an empty
 * role". The name is not here: a changed name is a rename, and a rename is
 * the sanctioned write-back with its own action.
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

/** What `＋ New Character` sends: a name, and any of the profile's fields. */
export const NewCharacterSchema = CharacterProfileEditSchema.extend({
  name: z.string().trim().min(1).max(200),
})

export type NewCharacter = z.infer<typeof NewCharacterSchema>

/** What a portrait upload accepts. The bytes are sniffed on the server; this is the declared shape. */
export const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024

export const PORTRAIT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type PortraitType = (typeof PORTRAIT_TYPES)[number]

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/** A scene, named the way the route prints one: `E1 Sc 4`. */
export type SceneRef = {
  readonly sceneNodeId: NodeId
  readonly episode: EpisodeSlug
  readonly episodeOrdinal: number
  readonly number: number
  readonly heading: string
}

/** One card of the grid, one row of the casting table, one node of a graph. */
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
  /** A public URL for the portrait, or null with none set or no storage. */
  readonly portraitUrl: string | null
  readonly presence: Presence
  readonly appearances: number
  readonly lines: number
  readonly mentions: number
  /** Heading node ids the character is in, in document order. The graphs intersect these. */
  readonly scenes: readonly NodeId[]
}

/** One row of the alias table as the drawer shows it: a spelling and what it accounts for. */
export type CueVariantRow = {
  readonly cue: string
  readonly occurrences: number
  readonly lines: number
}

/** What the drawer reads beyond the card: the alias table and the look-sheet notes. */
export type CharacterProfile = CastRow & {
  readonly appearance: string | null
  /** Counted spellings, first-appearance order. */
  readonly cues: readonly CueVariantRow[]
  /** Every bound spelling, counted or not - the alias table's authored half. */
  readonly boundCues: readonly string[]
  /** Cues a record-level rename would rewrite: every counted cue that is the name. */
  readonly nameCues: number
}

/** Scenes per episode, in running order. Read by the Bible route's "cited by episode" bars. */
export type EpisodeBar = {
  readonly episode: EpisodeSlug
  readonly ordinal: number
  readonly scenes: number
}

/** One node of the relationships graphs. */
export type MapColumn = {
  readonly id: CharacterId
  readonly name: string
  readonly hue: number
  readonly lines: number
  readonly scenes: number
}

export type CharacterMap = {
  readonly columns: readonly MapColumn[]
  /** `cells[row][column]`: scenes shared. The diagonal is the character's own count. */
  readonly cells: readonly (readonly number[])[]
}

export type ResolveProposal =
  | {
      readonly kind: 'character'
      readonly id: CharacterId
      readonly name: string
      readonly hue: number
      readonly confidence: Confidence
    }
  | { readonly kind: 'new-record'; readonly confidence: Confidence }

/** One open row of the resolve queue, for a cue. Drawn as a ghost card at the end of the grid. */
export type ResolveItem = {
  readonly key: string
  readonly cue: string
  readonly occurrences: number
  readonly scenes: readonly SceneRef[]
  readonly proposal: ResolveProposal | null
}
