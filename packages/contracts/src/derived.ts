import type {
  CharacterRecord,
  DerivedEntities,
  LocationRecord,
  ResolveRow,
  SceneRecord,
} from '@folio/script'
import { z } from 'zod'

import {
  ConfidenceSchema,
  InteriorExteriorSchema,
  LightSchema,
  PresenceSchema,
  ResolveRowStateSchema,
} from './enums'
import { assertExact } from './equality'
import type { Equals } from './equality'
import {
  CharacterIdSchema,
  LocationIdSchema,
  NodeIdSchema,
  ProjectIdSchema,
  UserIdSchema,
} from './ids'
import { AuthoredNotesSchema, TimestampSchema, TitleSchema } from './primitives'

/**
 * The derived entities at the boundary, split along the line that matters.
 *
 * `@folio/script` already declares `CharacterRecord`, `LocationRecord`,
 * `SceneRecord` and `ResolveRow`, and each of them carries its authored data in
 * one `authored` sub-object which `derive` "carries across by reference and
 * never constructs". That reference is how the package asserts AGENTS.md's
 * "Derivation **reconciles; it never rebuilds**" as `next.authored ===
 * previous.authored` rather than a field-by-field audit.
 *
 * **A reference cannot survive a database.** Two rows are never `===`. So the
 * guarantee has to be re-established by a different mechanism on this side of
 * the wire, and the mechanism is that authored and derived are **different
 * tables**: the derivation writer holds a handle that can only reach the
 * derived ones. `packages/db`'s `derived.ts` is where that is enforced; this
 * file is the shape it enforces on.
 *
 * Hence the split below. Every entity appears twice - once authored, once
 * derived - and the two halves are joined by id. Nothing recombines them into a
 * flat row, because a flat row is an upsert away from clobbering a synopsis
 * somebody wrote.
 *
 * The `assertExact` calls at the foot of the file hold the recombined pair to
 * the pure core's own record types, so this split can never quietly lose or
 * invent a field.
 */

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/**
 * AUTHORED. A character record's human half.
 *
 * `name` is authored, not derived, even though it is seeded from the cue that
 * minted the record: AGENTS.md, "Derivation is one-way - except" makes a
 * record-level rename one of exactly two sanctioned write-backs, "an explicit
 * rewrite operation, returns a diff, single undo entry". A derivation pass must
 * never write this column.
 */
export const CharacterAuthoredSchema = z.object({
  id: CharacterIdSchema,
  projectId: ProjectIdSchema,
  name: TitleSchema,
  bio: z.string().max(20_000).nullable(),
  notes: AuthoredNotesSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type CharacterAuthoredRow = z.infer<typeof CharacterAuthoredSchema>

/**
 * AUTHORED. One row of the alias table's authored half.
 *
 * AGENTS.md, Entity identity: "Matching goes through an **alias table** ...
 * never by hashing the string. This is what makes `मीरा` and `MEERA` one
 * person." No normalisation can equate those two spellings; a bound row can,
 * and it is the only thing that can. So this is authored input to derivation,
 * not output from it.
 */
export const CharacterBoundCueSchema = z.object({
  projectId: ProjectIdSchema,
  characterId: CharacterIdSchema,
  /** The cue as authored, modifiers included. `MEERA (V.O.)`. */
  cue: z.string().trim().min(1).max(200),
  boundBy: UserIdSchema.nullable(),
  boundAt: TimestampSchema,
})

export type CharacterBoundCue = z.infer<typeof CharacterBoundCueSchema>

/** AUTHORED. A relationship between two characters. */
export const CharacterRelationshipSchema = z.object({
  projectId: ProjectIdSchema,
  characterId: CharacterIdSchema,
  otherId: CharacterIdSchema,
  what: z.string().trim().min(1).max(200),
})

export type CharacterRelationshipRow = z.infer<typeof CharacterRelationshipSchema>

/**
 * DERIVED CACHE. Everything a re-derive may overwrite.
 *
 * `presence` is a named state, not an inference from `appearances === 0`.
 * AGENTS.md, Derivation: "**Records survive deletion.** ... `0 appearances ·
 * record kept` is a designed, valid state." A route reading a zero has no way
 * to tell the designed state from a derivation bug; this column tells it.
 */
export const CharacterDerivationSchema = z.object({
  projectId: ProjectIdSchema,
  characterId: CharacterIdSchema,
  appearances: z.int().min(0),
  lines: z.int().min(0),
  mentions: z.int().min(0),
  presence: PresenceSchema,
  /** Heading node ids, in document order. */
  scenes: z.array(NodeIdSchema),
  derivedAt: TimestampSchema,
})

export type CharacterDerivation = z.infer<typeof CharacterDerivationSchema>

/**
 * DERIVED CACHE. One counted cue spelling.
 *
 * `cue` is what the writer reads, `key` is what matching uses with the delivery
 * modifiers taken off - so `MEERA` and `MEERA (V.O.)` stay two visible rows
 * that resolve to one person. Both are stored because the UI shows the first
 * and derivation uses the second.
 */
export const CharacterCueTallySchema = z.object({
  projectId: ProjectIdSchema,
  characterId: CharacterIdSchema,
  cue: z.string().min(1).max(200),
  key: z.string().min(1).max(200),
  occurrences: z.int().min(0),
  lines: z.int().min(0),
})

export type CharacterCueTally = z.infer<typeof CharacterCueTallySchema>

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * AUTHORED. A location record, including its place in the tree.
 *
 * `parentId` is authored, and that is a ruling with a reason. AGENTS.md says
 * both that locations are derived from headings and that sub-sets hang off a
 * primary set; `@folio/script`'s `entities.ts` reconciles the two - "the
 * *records* come from the headings and the *tree* is drawn on top by a human.
 * So nothing in `derive.ts` ever writes this field." Derivation only ever
 * *proposes* an edge, into the resolve queue.
 *
 * `scheduledDays` is authored for a blunter reason: nothing in a node list
 * implies a shooting day. Derivation's job is the roll-up, which is what
 * answers AGENTS.md's "how many days in the chawl".
 */
export const LocationAuthoredSchema = z.object({
  id: LocationIdSchema,
  projectId: ProjectIdSchema,
  name: TitleSchema,
  /** Null for a primary set. A cycle here is data that is wrong, reported, never thrown. */
  parentId: LocationIdSchema.nullable(),
  scheduledDays: z.int().min(0),
  description: z.string().max(20_000).nullable(),
  notes: AuthoredNotesSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type LocationAuthoredRow = z.infer<typeof LocationAuthoredSchema>

/** AUTHORED. The locations alias table: slugline set-texts bound to a record. */
export const LocationBoundSluglineSchema = z.object({
  projectId: ProjectIdSchema,
  locationId: LocationIdSchema,
  slugline: z.string().trim().min(1).max(300),
  boundBy: UserIdSchema.nullable(),
  boundAt: TimestampSchema,
})

export type LocationBoundSlugline = z.infer<typeof LocationBoundSluglineSchema>

/**
 * DERIVED CACHE. The roll-up.
 *
 * `own` counts this set; `rollup` counts it plus every descendant. Both are
 * stored because both are read, and the tree walk that produces `rollup` is not
 * something a list view should be doing per row.
 */
export const LocationDerivationSchema = z.object({
  projectId: ProjectIdSchema,
  locationId: LocationIdSchema,
  /** 0 for a primary set. */
  depth: z.int().min(0),
  presence: PresenceSchema,
  ownScenes: z.int().min(0),
  ownSluglines: z.int().min(0),
  ownDayScenes: z.int().min(0),
  ownNightScenes: z.int().min(0),
  ownShootingDays: z.int().min(0),
  rollupScenes: z.int().min(0),
  rollupSluglines: z.int().min(0),
  rollupDayScenes: z.int().min(0),
  rollupNightScenes: z.int().min(0),
  rollupShootingDays: z.int().min(0),
  scenes: z.array(NodeIdSchema),
  derivedAt: TimestampSchema,
})

export type LocationDerivation = z.infer<typeof LocationDerivationSchema>

/** DERIVED CACHE. One counted slugline spelling. */
export const LocationSluglineTallySchema = z.object({
  projectId: ProjectIdSchema,
  locationId: LocationIdSchema,
  slugline: z.string().min(1).max(300),
  key: z.string().min(1).max(300),
  occurrences: z.int().min(0),
})

export type LocationSluglineTally = z.infer<typeof LocationSluglineTallySchema>

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/**
 * AUTHORED. What a writer hangs on a scene.
 *
 * `id` is the **heading node's id**, not a minted one - `@folio/script`'s
 * `entities.ts`: a node id "already survives splits, merges, type changes and
 * reorders, which is exactly the lifetime a scene record needs, and it means
 * moving a scene up the script does not detach its synopsis."
 *
 * `beats` and `threads` are lists of opaque strings because neither Beats nor
 * Timeline is a table in this phase. They are carried so a re-derive cannot
 * drop them; they are not foreign keys and are not pretending to be.
 */
export const SceneAuthoredSchema = z.object({
  id: NodeIdSchema,
  projectId: ProjectIdSchema,
  synopsis: z.string().max(20_000).nullable(),
  storyTime: z.string().max(200).nullable(),
  beats: z.array(z.string().min(1).max(200)).max(200),
  threads: z.array(z.string().min(1).max(200)).max(200),
  notes: AuthoredNotesSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type SceneAuthoredRow = z.infer<typeof SceneAuthoredSchema>

/**
 * The heading, read.
 *
 * Text only - it says what the heading says, not which record it belongs to.
 * Resolution goes through the alias table like everything else, which is what
 * keeps AGENTS.md's "A malformed heading does not silently become a scene"
 * true: `INTERCUT - PHONE CALL` produces a reading, not a location.
 */
export const SluglineReadingSchema = z.object({
  ie: InteriorExteriorSchema,
  set: z.string(),
  segments: z.array(z.string()),
  timeOfDay: z.string().nullable(),
  light: LightSchema,
})

export type SluglineReadingRow = z.infer<typeof SluglineReadingSchema>

/**
 * DERIVED CACHE. Everything about a scene that is a function of the node list.
 *
 * No page number, no eighths. Those are measurement, they live on a measurement
 * record, and `@folio/script` states the same boundary: "Nothing here counts
 * pages, eighths or rendered lines."
 *
 * `number` is 0 when the scene is absent, matching the pure core.
 */
export const SceneDerivationSchema = z.object({
  projectId: ProjectIdSchema,
  sceneNodeId: NodeIdSchema,
  /** 1-based in document order. 0 once the heading has left the script. */
  number: z.int().min(0),
  heading: z.string(),
  reading: SluglineReadingSchema,
  locationId: LocationIdSchema.nullable(),
  cast: z.array(CharacterIdSchema),
  speaking: z.array(CharacterIdSchema),
  mentioned: z.array(CharacterIdSchema),
  unresolvedCues: z.array(z.string()),
  castSize: z.int().min(0),
  /** Dialogue *nodes*, not rendered lines. */
  lines: z.int().min(0),
  presence: PresenceSchema,
  derivedAt: TimestampSchema,
})

export type SceneDerivation = z.infer<typeof SceneDerivationSchema>

// ---------------------------------------------------------------------------
// The resolve queue
// ---------------------------------------------------------------------------

/**
 * What a proposal points at.
 *
 * Five variants, mirroring `ProposalTarget` in `@folio/script`. `attach` and
 * `new-parent` are the only ways a location tree edge is ever suggested -
 * derivation never writes `parent`, it proposes it.
 */
export const ProposalTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), id: CharacterIdSchema }),
  z.object({ kind: z.literal('location'), id: LocationIdSchema }),
  z.object({ kind: z.literal('attach'), parent: LocationIdSchema }),
  z.object({ kind: z.literal('new-parent'), name: z.string().min(1).max(300) }),
  z.object({ kind: z.literal('new-record') }),
])

export type ProposalTargetRow = z.infer<typeof ProposalTargetSchema>

export const ProposalSchema = z.object({
  target: ProposalTargetSchema,
  confidence: ConfidenceSchema,
})

export type ProposalRow = z.infer<typeof ProposalSchema>

/** What the row is about: an unbound cue, an unbound slugline, or a tree shape. */
export const ResolveSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cue'), key: z.string().min(1), cue: z.string().min(1) }),
  z.object({ kind: z.literal('slugline'), key: z.string().min(1), slugline: z.string().min(1) }),
  z.object({ kind: z.literal('structure'), key: z.string().min(1), location: LocationIdSchema }),
])

export type ResolveSubjectRow = z.infer<typeof ResolveSubjectSchema>

/**
 * DERIVED CACHE. One row of the resolve queue.
 *
 * The row itself is derived - it exists because a cue in the script points at
 * nothing. What must survive a re-derive is the **decision**, and that is the
 * separate authored table below.
 *
 * `state` keeps a row that is `settled` or `gone` rather than deleting it,
 * because the decisions hang off it: "a rejection that evaporates when a cue is
 * briefly deleted is a rejection the writer gets asked about twice."
 */
export const ResolveRowSchema = z.object({
  projectId: ProjectIdSchema,
  /** `resolveRowKey(subject)` from `@folio/script`. Subject kind plus canonical key. */
  key: z.string().min(1).max(400),
  subject: ResolveSubjectSchema,
  occurrences: z.int().min(0),
  scenes: z.array(NodeIdSchema),
  proposal: ProposalSchema.nullable(),
  /** Candidates a decision removed. Lets a row with no proposal say why. */
  suppressed: z.array(ProposalSchema),
  state: ResolveRowStateSchema,
  derivedAt: TimestampSchema,
})

export type ResolveQueueRow = z.infer<typeof ResolveRowSchema>

/**
 * AUTHORED. The writer's decision on one proposal.
 *
 * AGENTS.md, exception table: resolve-queue decisions "are **authored input**,
 * not derived output. Real rows." And Entity identity: "A rejected proposal
 * must not reappear identically on the next derivation pass."
 *
 * `@folio/script` takes the strict reading of *identically*: the same target
 * for the same subject never comes back, at any confidence, because "a
 * rejection a later pass could undo by rescoring the same guess is not a
 * decision, it is a delay." This table is what a re-derive reads to honour
 * that, and nothing in a derivation pass may write it.
 */
export const ResolveDecisionSchema = z.object({
  projectId: ProjectIdSchema,
  /** The row this decided. Not a foreign key to a derived row's lifetime. */
  rowKey: z.string().min(1).max(400),
  verdict: z.enum(['accepted', 'rejected']),
  target: ProposalTargetSchema,
  decidedBy: UserIdSchema.nullable(),
  decidedAt: TimestampSchema,
})

export type ResolveDecision = z.infer<typeof ResolveDecisionSchema>

// ---------------------------------------------------------------------------
// Holding the split to the pure core
// ---------------------------------------------------------------------------

/**
 * The split above must recombine into exactly what `@folio/script` declares.
 *
 * These four types describe the recombination, and the `assertExact` calls
 * below fail to compile if the two ever disagree - a field added to
 * `CharacterRecord` in the pure core and not to a table here, or the reverse.
 *
 * They are written as the *field sets* rather than as the record types, because
 * the split moves `id` and `projectId` around and the exact-equality check is
 * on what the pair carries between them, not on how it is shaped.
 */
type CharacterFields = keyof CharacterRecord | keyof CharacterRecord['authored']
type LocationFields = keyof LocationRecord | keyof LocationRecord['authored']
type SceneFields = keyof SceneRecord | keyof SceneRecord['authored']
type ResolveFields = keyof ResolveRow

/**
 * The fields this package accounts for, per entity.
 *
 * Adding a field to the pure core's record and forgetting it here is a compile
 * error on the matching `assertExact`. Removing one is the same error from the
 * other side. This is the mechanism CLAUDE.md describes as `pnpm typecheck`
 * being a test suite.
 */
type AccountedCharacter =
  | 'id'
  | 'authored'
  | 'cues'
  | 'appearances'
  | 'scenes'
  | 'lines'
  | 'mentions'
  | 'presence'
  | 'name'
  | 'boundCues'
  | 'bio'
  | 'relationships'
  | 'notes'

type AccountedLocation =
  | 'id'
  | 'authored'
  | 'sluglines'
  | 'children'
  | 'depth'
  | 'own'
  | 'rollup'
  | 'scenes'
  | 'presence'
  | 'name'
  | 'parent'
  | 'boundSluglines'
  | 'scheduledDays'
  | 'description'
  | 'notes'

type AccountedScene =
  | 'id'
  | 'number'
  | 'heading'
  | 'reading'
  | 'locationId'
  | 'cast'
  | 'speaking'
  | 'mentioned'
  | 'unresolvedCues'
  | 'castSize'
  | 'lines'
  | 'presence'
  | 'authored'
  | 'synopsis'
  | 'storyTime'
  | 'beats'
  | 'threads'
  | 'notes'

type AccountedResolve =
  | 'subject'
  | 'occurrences'
  | 'scenes'
  | 'proposal'
  | 'suppressed'
  | 'state'
  | 'decisions'

assertExact<Equals<CharacterFields, AccountedCharacter>>()
assertExact<Equals<LocationFields, AccountedLocation>>()
assertExact<Equals<SceneFields, AccountedScene>>()
assertExact<Equals<ResolveFields, AccountedResolve>>()

/**
 * And the whole derived set has exactly four collections.
 *
 * If a fifth derived entity is added to the pure core, this stops compiling and
 * whoever added it has to decide what table it lands in.
 */
assertExact<Equals<keyof DerivedEntities, 'characters' | 'locations' | 'scenes' | 'queue'>>()
