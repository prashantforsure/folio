import type { CharacterId, LocationId, NodeId } from './ids'
import type { DeliveryModifier } from './node'

/**
 * The derived entities.
 *
 * AGENTS.md, Development philosophy 1: "Derive, never duplicate." Everything in
 * this file is a *view* of the node list - scenes, characters, locations - plus
 * the authored data that hangs off those views and is not a function of the
 * script at all.
 *
 * ## Why every record has an `authored` sub-object
 *
 * AGENTS.md, Derivation: "Derivation **reconciles; it never rebuilds.** Authored
 * data hanging off derived rows - resolve decisions, synopses, beat links, story
 * time, threads - must survive a full re-derive intact."
 *
 * "Intact" is a promise that is easy to make and hard to keep, because the
 * natural way to write a derivation is to build a fresh record and copy over the
 * fields worth keeping - and the bug is always a field someone forgot to copy.
 * So the authored fields are not mixed in with the derived ones: they sit in one
 * sub-object which `derive.ts` **carries across by reference and never
 * constructs** except at the instant a record is minted. That turns "survives
 * intact" from a field-by-field audit into one reference comparison, which is
 * what `derive-properties.test.ts` asserts: `next.authored === previous.authored`,
 * not `deepEqual`.
 *
 * `notes` is deliberately opaque. Portrait, casting, arc notes and everything
 * else the Characters and Locations routes hang off a record are *schema*
 * (`packages/db`), and the pure core has no business knowing their shape. It
 * knows only that it must not touch them. The fields that *are* named here -
 * `name`, `bio`, `relationships`, `parent`, `boundCues`, `scheduledDays` - are
 * named because derivation has to **read** them: matching, the location tree and
 * the shooting-day roll-up all consume authored input.
 *
 * ## Why a record is a UUID and not a name
 *
 * AGENTS.md, Entity identity: "A character is a **stable UUID with a name
 * attribute**. It is *not* its cue text." So `CharacterRecord.id` comes from the
 * caller's `freshIds` and lives in the previously derived entities forever
 * after; nothing in here is keyed by, hashed from, or reconstructed out of the
 * cue string. The cue strings live in `cues`, which is the alias table, which is
 * a derived tally *pointing at* the record - never the thing that identifies it.
 */

// ---------------------------------------------------------------------------
// Authored payloads
// ---------------------------------------------------------------------------

/**
 * Authored data this package does not interpret.
 *
 * A JSON value, written out rather than imported, because the alternative is
 * `unknown` (which the caller then has to assert its way out of) or `any`
 * (which AGENTS.md, Conventions > Typing bans outright).
 */
export type AuthoredValue =
  | string
  | number
  | boolean
  | null
  | readonly AuthoredValue[]
  | { readonly [key: string]: AuthoredValue }

export type AuthoredNotes = { readonly [key: string]: AuthoredValue }

/**
 * Whether the script still contains this record.
 *
 * AGENTS.md, Derivation: "**Records survive deletion.** A name removed from the
 * script keeps its record with zero occurrences. `0 appearances · record kept`
 * is a designed, valid state."
 *
 * A named state rather than an inference from `appearances === 0`, because a
 * record can legitimately have no *scene* appearances while still occurring - a
 * cue outside any scene heading, for instance - and because a route that has to
 * ask "is this the designed empty state or a derivation bug?" from a zero has no
 * way to tell.
 */
export const PRESENCE_STATES = ['present', 'absent'] as const

export type Presence = (typeof PRESENCE_STATES)[number]

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export type CharacterRelationship = {
  readonly other: CharacterId
  readonly what: string
}

export type CharacterAuthored = {
  /**
   * The display name. Seeded from the cue that minted the record and authored
   * from then on - a record-level rename is one of the two sanctioned
   * write-backs (AGENTS.md, "Derivation is one-way - except"), an explicit
   * diffed operation, and emphatically not something a derivation pass does.
   */
  readonly name: string
  /**
   * Cue spellings bound to this record: the alias table's *authored* half.
   *
   * This is the mechanism AGENTS.md names - "Matching goes through an **alias
   * table** ... never by hashing the string. This is what makes the Devanagari
   * spelling and `MEERA` one person." No amount of string normalisation can
   * equate those two; a row in this list can, and it is the only thing that can.
   */
  readonly boundCues: readonly string[]
  readonly bio: string | null
  readonly relationships: readonly CharacterRelationship[]
  readonly notes: AuthoredNotes
}

/**
 * One alias-table row: a cue spelling and what it accounts for.
 *
 * `cue` is the cue as the writer would read it, modifiers included - AGENTS.md's
 * own example table has `MEERA` and `MEERA (V.O.)` as two rows with separate
 * counts. `key` is what matching actually uses, with the modifiers taken off, so
 * those two rows resolve to one person. Both are here because the UI shows the
 * first and derivation uses the second, and collapsing them would mean the
 * screen could only show what the matcher happened to keep.
 */
export type CueTally = {
  readonly cue: string
  readonly key: string
  readonly modifiers: readonly DeliveryModifier[]
  /** Cue nodes carrying this spelling. */
  readonly occurrences: number
  /** Dialogue nodes spoken under this spelling. Not a rendered-line count. */
  readonly lines: number
}

export type CharacterRecord = {
  readonly id: CharacterId
  readonly authored: CharacterAuthored
  /** The alias table, in first-appearance order. Empty when `presence` is absent. */
  readonly cues: readonly CueTally[]
  /** Scenes the character speaks in or is mentioned in. */
  readonly appearances: number
  readonly scenes: readonly NodeId[]
  readonly lines: number
  /** `@mention` edges pointing at this record. Same resolution path as a cue. */
  readonly mentions: number
  readonly presence: Presence
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * Time of day, reduced to the only distinction the breakdown makes.
 *
 * `unspecified` is not a failure - `CONTINUOUS`, `LATER` and `SAME` are all
 * legitimate and none of them says day or night.
 */
export const LIGHT_STATES = ['day', 'night', 'unspecified'] as const

export type Light = (typeof LIGHT_STATES)[number]

export const INTERIOR_EXTERIOR = ['INT', 'EXT', 'INT/EXT', 'EST'] as const

export type InteriorExterior = (typeof INTERIOR_EXTERIOR)[number]

/**
 * A scene heading, read.
 *
 * Text only. It says what the heading *says*; it does not say which record it
 * belongs to, because that goes through the alias table like everything else.
 */
export type SluglineReading = {
  readonly ie: InteriorExterior
  /** The set as authored, with the time of day taken off. */
  readonly set: string
  /** `set` split on the ` - ` separator. The raw material a structure proposal reads. */
  readonly segments: readonly string[]
  readonly timeOfDay: string | null
  readonly light: Light
}

export type LocationAuthored = {
  readonly name: string
  /**
   * The tree edge, and the reason it is in `authored`.
   *
   * Ruled with the client: the parent/child structure is **authored**, and
   * derivation only ever *proposes* an edge into the resolve queue. AGENTS.md
   * says both that locations are derived from headings and that sub-sets hang
   * off a primary set; the reconciliation is that the *records* come from the
   * headings and the *tree* is drawn on top by a human. So nothing in
   * `derive.ts` ever writes this field.
   *
   * `null` means a primary set. A parent naming a record that does not exist, or
   * a cycle, is authored input that is wrong - it is reported as data and the
   * record rolls up as a root, never thrown over.
   */
  readonly parent: LocationId | null
  /** Slugline set-texts bound to this record. The locations alias table. */
  readonly boundSluglines: readonly string[]
  /**
   * Shooting days scheduled at this set.
   *
   * Authored, because a shooting day is a *scheduling* fact and there is nothing
   * in a node list that implies one. Derivation's whole job here is the roll-up:
   * AGENTS.md, Entity identity - "Breakdown and scheduling count shooting days
   * **by set**, and a flat list cannot answer 'how many days in the chawl'."
   */
  readonly scheduledDays: number
  readonly description: string | null
  readonly notes: AuthoredNotes
}

export type SluglineTally = {
  readonly slugline: string
  readonly key: string
  readonly occurrences: number
}

export type LocationCounts = {
  readonly scenes: number
  readonly sluglines: number
  readonly dayScenes: number
  readonly nightScenes: number
  readonly shootingDays: number
}

export const NO_COUNTS: LocationCounts = {
  scenes: 0,
  sluglines: 0,
  dayScenes: 0,
  nightScenes: 0,
  shootingDays: 0,
}

export type LocationRecord = {
  readonly id: LocationId
  readonly authored: LocationAuthored
  readonly sluglines: readonly SluglineTally[]
  /** Derived from every other record's authored `parent`. In record order. */
  readonly children: readonly LocationId[]
  /** 0 for a primary set. */
  readonly depth: number
  /** This set alone. */
  readonly own: LocationCounts
  /** This set plus every descendant. What "how many days in the chawl" reads. */
  readonly rollup: LocationCounts
  readonly scenes: readonly NodeId[]
  readonly presence: Presence
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export type SceneAuthored = {
  readonly synopsis: string | null
  readonly storyTime: string | null
  readonly beats: readonly string[]
  readonly threads: readonly string[]
  readonly notes: AuthoredNotes
}

/**
 * A scene.
 *
 * `id` is the **heading node's id**, not a minted one. A node id already
 * survives splits, merges, type changes and reorders (AGENTS.md, The node
 * model), which is exactly the lifetime a scene record needs, and it means
 * moving a scene up the script does not detach its synopsis. It also spends no
 * entropy: 220 scenes cost zero ids.
 *
 * That leaves the `SCENE_xxx` casing question AGENTS.md flags under Naming
 * untouched, which is deliberate - it is a ruling nobody has made, and this is a
 * derived id space either way.
 *
 * Nothing here counts pages, eighths or rendered lines. `lines` is a count of
 * dialogue *nodes*. Measurement is pagination's, it lives on a measurement
 * record, and it is not in this package.
 */
export type SceneRecord = {
  readonly id: NodeId
  /** 1-based, in document order. `0` when the scene is absent from the script. */
  readonly number: number
  readonly heading: string
  readonly reading: SluglineReading
  readonly locationId: LocationId | null
  /** Everyone in the scene: speaking or mentioned, first-appearance order. */
  readonly cast: readonly CharacterId[]
  readonly speaking: readonly CharacterId[]
  readonly mentioned: readonly CharacterId[]
  /** Cues in this scene that point at no record yet. Each has a queue row. */
  readonly unresolvedCues: readonly string[]
  readonly castSize: number
  readonly lines: number
  /**
   * `absent` once the heading node has left the script.
   *
   * The same rule as a character record, applied to a scene, and it is an
   * extension of AGENTS.md rather than a quotation of it: the file says records
   * survive deletion for names. Doing it here too keeps one rule instead of two,
   * and it is what stops a briefly-deleted heading taking its synopsis, story
   * time and beat links with it. The cost is a list that only grows; flagged.
   */
  readonly presence: Presence
  readonly authored: SceneAuthored
}

// ---------------------------------------------------------------------------
// The resolve queue
// ---------------------------------------------------------------------------

export const CONFIDENCES = ['certain', 'likely', 'possible'] as const

export type Confidence = (typeof CONFIDENCES)[number]

export type ProposalTarget =
  | { readonly kind: 'character'; readonly id: CharacterId }
  | { readonly kind: 'location'; readonly id: LocationId }
  /** Hang this location under that one. The only way an edge is ever suggested. */
  | { readonly kind: 'attach'; readonly parent: LocationId }
  /**
   * Several sets read like sub-sets of a primary set nobody has created:
   * `THE CHAWL - STAIRWELL` and `THE CHAWL - COURTYARD` with no `THE CHAWL`.
   * The name is what the sluglines say it would be called. Creating it and
   * hanging the children off it is the writer's act, not derivation's.
   */
  | { readonly kind: 'new-parent'; readonly name: string }
  /** No existing record fits. Accepting this is what mints one. */
  | { readonly kind: 'new-record' }

export type Proposal = {
  readonly target: ProposalTarget
  readonly confidence: Confidence
}

/**
 * The writer's decision on one proposal. **Authored input, never derived.**
 *
 * AGENTS.md, "Nothing is stored that can be computed - except": resolve-queue
 * decisions "are **authored input**, not derived output. Real rows."
 *
 * A rejection is keyed by the row's subject and the proposed target, and
 * derivation removes that target from the candidate list on every later pass -
 * which is the whole of AGENTS.md's "A rejected proposal must not reappear
 * identically on the next derivation pass". The reading of "identically" taken
 * here is the strict one: the same target for the same subject never comes back,
 * at any confidence. A rejection a later pass could undo by rescoring the same
 * guess is not a decision, it is a delay.
 */
export type ProposalDecision =
  | { readonly verdict: 'rejected'; readonly target: ProposalTarget }
  | { readonly verdict: 'accepted'; readonly target: ProposalTarget }

export type ResolveSubject =
  | { readonly kind: 'cue'; readonly key: string; readonly cue: string }
  | { readonly kind: 'slugline'; readonly key: string; readonly slugline: string }
  /** An existing location whose own name reads like a sub-set of another. */
  | { readonly kind: 'structure'; readonly key: string; readonly location: LocationId }

export const RESOLVE_ROW_STATES = ['open', 'settled', 'gone'] as const

/**
 * `open` - still unresolved. `settled` - the subject now points at a record, by
 * a binding the writer made. `gone` - the subject no longer occurs in the
 * script. Rows in the last two states are kept rather than deleted, because they
 * carry `decisions`, and a rejection that evaporates when a cue is briefly
 * deleted is a rejection the writer gets asked about twice.
 */
export type ResolveRowState = (typeof RESOLVE_ROW_STATES)[number]

/**
 * One row of the resolve queue.
 *
 * AGENTS.md, Entity identity: "**The resolve queue is rows, not a computed
 * view.**" So a row persists across passes, keyed by its subject, and carries
 * the authored `decisions` that a computed view would have nowhere to put.
 */
export type ResolveRow = {
  readonly subject: ResolveSubject
  readonly occurrences: number
  readonly scenes: readonly NodeId[]
  readonly proposal: Proposal | null
  /** Candidates a decision removed. Reported so a row with no proposal can say why. */
  readonly suppressed: readonly Proposal[]
  readonly state: ResolveRowState
  /** Authored. Carried across by reference; derivation never writes it. */
  readonly decisions: readonly ProposalDecision[]
}

/** A row's identity across passes. Subject kind plus canonical key, nothing minted. */
export const resolveRowKey = (subject: ResolveSubject): string => `${subject.kind}:${subject.key}`

// ---------------------------------------------------------------------------
// The whole derived set
// ---------------------------------------------------------------------------

/**
 * Both the input and the output of derivation.
 *
 * The same type on both sides is what makes "reconciles, never rebuilds"
 * expressible at all: `derive(nodes, derive(nodes, previous).entities)` has to be
 * the identity on every authored field, and it can only be stated that way
 * because the output is a legal input.
 */
export type DerivedEntities = {
  readonly characters: readonly CharacterRecord[]
  readonly locations: readonly LocationRecord[]
  readonly scenes: readonly SceneRecord[]
  readonly queue: readonly ResolveRow[]
}

/** A project with nothing derived yet. The first pass takes this. */
export const NO_ENTITIES: DerivedEntities = {
  characters: [],
  locations: [],
  scenes: [],
  queue: [],
}
