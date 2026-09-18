import type {
  CharacterId,
  Confidence,
  InteriorExterior,
  Light,
  LocationId,
  MatchReason,
  NodeId,
  Presence,
} from '@folio/script'
import { z } from 'zod'

import type { CharacterFindingId, EpisodeSlug } from './ids'

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
 * ## The rebuild (2026-09-17 onward)
 *
 * The route is rebuilt to a written plan rather than a mockup ("Characters
 * rebuild" in `docs/build-decisions.md`, one section per phase). The read
 * model is what that plan reads back to the writer: the script as evidence
 * about each person. `CastRow` carries the voice the pass counts (words,
 * speeches, the first and last and longest line, what is said per scene,
 * who they talk to, where the action introduces them - phase 3), the
 * profile the writer authors, and where the record came from (`origin`).
 * `SceneFacts` is the scene index as the route reads it - a subtype of
 * `SceneRef`, which Locations and Research still construct as it was.
 *
 * Migration `0013` dropped the first pass's drives, arc turns, voice rules
 * and key lines; `0017` brought back `wants`, `needs` and `status`; `0021`
 * added the voice columns and `origin`; `0022` the findings table.
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
 * The status a writer gives a record. `draft` is what a derivation pass
 * mints and what `New` creates; `defined` says the profile is written;
 * `locked` says stop changing it. README, "Status as a dot plus a pill":
 * amber for a draft (a decision waiting), green for defined (settled),
 * accent for locked. The tone is the route's (`lib/characters/cast.ts`).
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
    status: CharacterStatusSchema,
    wants: line(2_000),
    needs: line(2_000),
  })
  .partial()

export type CharacterProfileEdit = z.infer<typeof CharacterProfileEditSchema>

/** What `+ New` sends: a name, and any of the profile's fields. */
export const NewCharacterSchema = CharacterProfileEditSchema.extend({
  name: z.string().trim().min(1).max(200),
})

export type NewCharacter = z.infer<typeof NewCharacterSchema>

/** What a portrait upload accepts. The bytes are sniffed on the server; this is the declared shape. */
export const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024

export const PORTRAIT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type PortraitType = (typeof PORTRAIT_TYPES)[number]

/**
 * The three prose fields the assistant may draft into - unsaved, into the
 * drawer's draft, for the writer to keep or not with the existing Save
 * (`lib/characters/model-actions.ts`). Closed: a fourth field is a
 * widening of what the model writes, which AGENTS.md puts behind a question.
 */
export const DRAFT_FIELDS = ['bio', 'wants', 'needs'] as const

export type DraftField = (typeof DRAFT_FIELDS)[number]

export const DraftFieldSchema = z.enum(DRAFT_FIELDS)

export const DRAFT_FIELD_LABELS: Readonly<Record<DraftField, string>> = {
  bio: 'Description',
  wants: 'Wants',
  needs: 'Needs',
}

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

/**
 * The scene index as the Characters route reads it: a `SceneRef` with the
 * heading's reading, its set, who speaks and who is mentioned, its measured
 * length and its dialogue words. The presence strip, the drawer's `Scenes`
 * breakdown and `Sets`, the share figure and the Presence view all read
 * from here; nothing is counted twice.
 */
export type SceneFacts = SceneRef & {
  readonly ie: InteriorExterior
  readonly light: Light
  readonly timeOfDay: string | null
  readonly set: { readonly id: LocationId; readonly name: string } | null
  readonly speaking: readonly CharacterId[]
  readonly mentioned: readonly CharacterId[]
  /** Eighths of a page, from the last measurement; null when the scene is unmeasured. */
  readonly eighths: number | null
  /** Dialogue words under the heading, every cue counted - the share denominator. */
  readonly words: number
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

/** A dialogue or action node the route quotes, with the scene that proves it. */
export type QuotedLine = {
  readonly nodeId: NodeId
  readonly text: string
  readonly sceneNodeId: NodeId | null
}

/** The action line that introduces a character, with the age it gives and whether the writer waved the timing finding. */
export type IntroLine = QuotedLine & {
  readonly age: number | null
  /** `true` once the writer said the character speaking before this line is deliberate. */
  readonly deliberate: boolean
}

export type SceneCountRow = {
  readonly scene: NodeId
  readonly lines: number
  readonly words: number
}

export type ExchangeRow = {
  readonly other: CharacterId
  readonly count: number
  readonly scenes: readonly NodeId[]
}

/** One card of the grid, one row of the sheet, one row of the Presence grid. */
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
  readonly status: CharacterStatus
  readonly wants: string | null
  readonly needs: string | null
  /** A public URL for the portrait, or null with none set or no storage. */
  readonly portraitUrl: string | null
  readonly origin: CharacterOrigin | null
  readonly presence: Presence
  readonly appearances: number
  readonly lines: number
  readonly mentions: number
  /** Heading node ids the character is in, in document order. */
  readonly scenes: readonly NodeId[]
  /** Counted spellings, first-appearance order - the card's alias line. */
  readonly cues: readonly CueVariantRow[]
  // The voice (phase 3).
  readonly words: number
  readonly speeches: number
  readonly parens: number
  /** Action lines naming the character. */
  readonly namedIn: number
  readonly firstLine: { readonly nodeId: NodeId; readonly sceneNodeId: NodeId | null } | null
  readonly lastLine: { readonly nodeId: NodeId; readonly sceneNodeId: NodeId | null } | null
  readonly longest: { readonly nodeId: NodeId; readonly sceneNodeId: NodeId | null; readonly words: number } | null
  readonly introducedAt: { readonly nodeId: NodeId; readonly sceneNodeId: NodeId | null } | null
  readonly sceneCounts: readonly SceneCountRow[]
  readonly exchanges: readonly ExchangeRow[]
  /** The first line, quoted; null until the loader reads the node, or with no line. */
  readonly quote: QuotedLine | null
  /** The introduction, quoted; null with none. */
  readonly intro: IntroLine | null
}

/**
 * Who bound a spelling: derivation (`bound_by` null - the name's own spelling,
 * or a mint), the signed-in writer, or another member. Drawn as a mono tag on
 * the alias row so a wrong accept can be told from a pass's own binding.
 */
export type AliasProvenance = 'derived' | 'you' | 'member'

export type BoundCueView = {
  readonly cue: string
  readonly provenance: AliasProvenance
}

/** One record the character talks to, for the drawer's `Talks to`. */
export type TalksToRow = {
  readonly id: CharacterId
  readonly name: string
  readonly hue: number
  readonly count: number
  readonly scenes: readonly NodeId[]
  /** Scenes the two are both in, exchanges or not. */
  readonly shared: number
}

/** What the drawer reads beyond the card. */
export type CharacterProfile = CastRow & {
  /** Every bound spelling, counted or not - the alias table's authored half. */
  readonly boundCues: readonly string[]
  /** The same list with who bound each - the alias table as the drawer draws it. */
  readonly bound: readonly BoundCueView[]
  /** Cues a record-level rename would rewrite: every counted cue that is the name. */
  readonly nameCues: number
  /** The first, last and longest line, quoted. */
  readonly voice: {
    readonly first: QuotedLine | null
    readonly last: QuotedLine | null
    readonly longest: (QuotedLine & { readonly words: number }) | null
  }
  readonly talksTo: readonly TalksToRow[]
  /** The continuity findings the assistant recorded (phase 4), open and deliberate. */
  readonly findings: readonly CharacterFinding[]
}

/** One node of the presence map. */
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

// ---------------------------------------------------------------------------
// Findings (phase 4)
// ---------------------------------------------------------------------------

/**
 * A continuity finding: the script against itself, for one character. The
 * assistant reads the scenes the character is in and returns the pairs of
 * quotes that contradict each other; the row is kept so the writer's
 * verdict (`deliberate`) survives a re-check, and so a finding is a row
 * with two citations rather than prose in a chat. Never a Bible: nothing
 * here is a fact the writer asserted, only two lines of the page.
 */
export const CHARACTER_FINDING_KINDS = ['contradiction'] as const

export type CharacterFindingKind = (typeof CHARACTER_FINDING_KINDS)[number]

export const CHARACTER_FINDING_STATUSES = ['open', 'deliberate'] as const

export type CharacterFindingStatus = (typeof CHARACTER_FINDING_STATUSES)[number]

export const CharacterFindingStatusSchema = z.enum(CHARACTER_FINDING_STATUSES)

export type FindingSide = {
  readonly ref: SceneRef
  readonly quote: string
}

export type CharacterFinding = {
  readonly id: CharacterFindingId
  readonly characterId: CharacterId
  readonly kind: CharacterFindingKind
  readonly status: CharacterFindingStatus
  readonly claim: string
  readonly a: FindingSide
  readonly b: FindingSide
  readonly createdAt: string
}
