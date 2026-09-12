import type { CharacterId, Confidence, LocationId, NodeId, Presence } from '@folio/script'
import { z } from 'zod'

import type { ArcTurnId, EpisodeSlug } from './ids'
import { CharacterIdSchema, NodeIdSchema } from './ids'

/**
 * The Characters route: what a writer authors on top of a derived record,
 * and the read model the route draws.
 *
 * AGENTS.md, Entity identity: a character is "a stable UUID with a name
 * attribute", derived from cues and `@mentions`, with "profile, arc and
 * relationships authored on top". The derived half is `derived.ts`
 * (`CharacterDerivationSchema`, the tallies, the queue). This file is the
 * authored half's *inputs* - what the profile's fields accept - and the
 * shapes the route reads, which join the two halves by id and never
 * recombine them into a row a re-derive could clobber.
 *
 * ## Group
 *
 * `principal | supporting`, authored, and defaulting to `supporting` for a
 * record derivation minted: the nav's groups are the writer's, and a script
 * with forty cues should not open with forty principals. The bundle's third
 * group, "Walk-ons", is not a group a record can be in - it is the cues the
 * writer said are nobody (`WalkOnRow`), and they have no record at all.
 *
 * ## Drives with a source
 *
 * Wants, Needs and Flaw each carry a `source` line - "stated E1 Sc 5",
 * "never stated", "from the Sunita interview" - because the bundle shows
 * one under each and the spec calls it "each showing its source". Both are
 * authored text: whether a want is stated on the page is the writer's
 * reading of the page, not something derivation can decide.
 *
 * ## Arc turns point at scenes, and an unpointed turn is unwritten
 *
 * A turn either names a heading node or it does not. When it does, the
 * route prints the scene's current episode and number, so a turn survives a
 * renumbering; when it does not - or the scene has left the script - the
 * turn is `unwritten`, the "not on the page" flag the spec asks for. There
 * is no free-text scene reference to go stale.
 *
 * ## Key lines are dialogue node ids
 *
 * "Key lines with refs" are the writer's picks from the character's own
 * dialogue, stored as node ids and read back from the node at render, so the
 * text on the profile is the text on the page. A line the script has since
 * lost is dropped from the list on the next read, not shown from a copy.
 */

export const CHARACTER_GROUPS = ['principal', 'supporting'] as const

export type CharacterGroup = (typeof CHARACTER_GROUPS)[number]

export const CharacterGroupSchema = z.enum(CHARACTER_GROUPS)

/** The six chip hues the Characters bundle draws, by index. `packages/ui`'s `--chip-N`. */
export const CHARACTER_HUES = 6

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const line = (max: number) => z.string().trim().max(max).nullable()

/**
 * The profile's authored fields. Every field is optional on the way in so
 * one inline edit saves one field; a field that is present is written whole,
 * and an empty string is stored as `null` - the column is "no role", not "an
 * empty role".
 */
export const CharacterProfileEditSchema = z
  .object({
    group: CharacterGroupSchema,
    role: line(200),
    age: line(40),
    bio: line(20_000),
    wants: line(2_000),
    wantsSource: line(200),
    needs: line(2_000),
    needsSource: line(200),
    flaw: line(2_000),
    flawSource: line(200),
    voiceRules: z.array(z.string().trim().min(1).max(500)).max(50),
  })
  .partial()

export type CharacterProfileEdit = z.infer<typeof CharacterProfileEditSchema>

export const ArcTurnEditSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  sceneNodeId: NodeIdSchema.nullable(),
})

export type ArcTurnEdit = z.infer<typeof ArcTurnEditSchema>

export const RelationshipEditSchema = z.object({
  otherId: CharacterIdSchema,
  what: z.string().trim().max(200),
  shift: line(500),
})

export type RelationshipEdit = z.infer<typeof RelationshipEditSchema>

export const KeyLinesEditSchema = z.array(NodeIdSchema).max(50)

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

/** One row of the cast nav, and the head of a profile. */
export type CastRow = {
  readonly id: CharacterId
  readonly name: string
  readonly group: CharacterGroup
  readonly role: string | null
  readonly hue: number
  readonly presence: Presence
  readonly appearances: number
  readonly lines: number
  readonly mentions: number
  /** One flag per episode in running order: does the character appear in it. */
  readonly inEpisode: readonly boolean[]
}

/** A cue the writer said is nobody. No record; an open queue row with no proposal. */
export type WalkOnRow = {
  readonly key: string
  readonly cue: string
  readonly scenes: number
}

/** One row of the alias table as the profile shows it: a spelling and what it accounts for. */
export type CueVariantRow = {
  readonly cue: string
  readonly occurrences: number
  readonly lines: number
}

export type ArcTurnRow = {
  readonly id: ArcTurnId
  readonly position: number
  readonly text: string
  /** Null when the turn names no scene, or the scene has left the script. */
  readonly scene: SceneRef | null
}

export type KeyLineRow = {
  readonly nodeId: NodeId
  readonly text: string
  readonly scene: SceneRef | null
}

export type RelationshipRow = {
  readonly other: { readonly id: CharacterId; readonly name: string; readonly hue: number }
  readonly what: string | null
  readonly shift: string | null
  /** Scenes both are in, from derivation. */
  readonly shared: number
  /** Whether a `character_relationships` row exists in this direction. */
  readonly authored: boolean
}

export type PlaceRow = {
  readonly locationId: LocationId
  readonly name: string
  readonly scenes: number
}

export type EpisodeBar = {
  readonly episode: EpisodeSlug
  readonly ordinal: number
  readonly scenes: number
}

/** The longest run of scenes the character is absent for inside one episode. */
export type PresenceGap = {
  readonly episodeOrdinal: number
  readonly from: number
  readonly to: number
}

export type CharacterProfile = CastRow & {
  readonly age: string | null
  readonly bio: string | null
  readonly wants: string | null
  readonly wantsSource: string | null
  readonly needs: string | null
  readonly needsSource: string | null
  readonly flaw: string | null
  readonly flawSource: string | null
  readonly voiceRules: readonly string[]
  /** Counted spellings, first-appearance order. */
  readonly cues: readonly CueVariantRow[]
  /** Every bound spelling, counted or not - the alias table's authored half. */
  readonly boundCues: readonly string[]
  readonly arc: readonly ArcTurnRow[]
  readonly keyLines: readonly KeyLineRow[]
  readonly relationships: readonly RelationshipRow[]
  readonly places: readonly PlaceRow[]
  readonly perEpisode: readonly EpisodeBar[]
  readonly firstSeen: SceneRef | null
  readonly lastSeen: SceneRef | null
  /** This character's dialogue lines over every character's, 0..1. Null with no dialogue at all. */
  readonly voiceShare: number | null
  readonly gap: PresenceGap | null
  /** Cues a record-level rename would rewrite: every counted cue that is the name. */
  readonly nameCues: number
}

export type MapColumn = {
  readonly id: CharacterId
  readonly name: string
  readonly hue: number
  readonly group: CharacterGroup
}

export type CharacterMap = {
  readonly columns: readonly MapColumn[]
  /** `cells[row][column]`: scenes shared. The diagonal is the character's own count. */
  readonly cells: readonly (readonly number[])[]
  /** Pairs of principals with no shared scene. */
  readonly standouts: readonly { readonly a: MapColumn; readonly b: MapColumn }[]
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

/** One open row of the resolve queue, for a cue. */
export type ResolveItem = {
  readonly key: string
  readonly cue: string
  readonly occurrences: number
  readonly scenes: readonly SceneRef[]
  readonly proposal: ResolveProposal | null
}
