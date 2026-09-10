import { CONFIDENCES, INTERIOR_EXTERIOR, LIGHT_STATES, PRESENCE_STATES, RESOLVE_ROW_STATES } from '@folio/script'
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  createdAtColumn,
  idColumn,
  projectIdColumn,
  timestampColumn,
  updatedAtColumn,
} from './columns'
import { projects, users } from './tenancy'

/**
 * The derived entity caches - and the authored rows they must never touch.
 *
 * ## The split, and why it is tables and not discipline
 *
 * `@folio/script` keeps every record's authored data in one `authored`
 * sub-object which `derive` "carries across by reference and never constructs".
 * That is how AGENTS.md's "Derivation **reconciles; it never rebuilds**" is
 * asserted there: `next.authored === previous.authored`, one reference
 * comparison instead of a field-by-field audit.
 *
 * **A reference cannot survive a database.** Two rows are never `===`. So on
 * this side the guarantee has to be re-established by a different mechanism,
 * and the mechanism is that authored and derived live in **different tables**:
 *
 *   characters                  AUTHORED       name, bio, notes
 *   character_bound_cues        AUTHORED       the alias table's authored half
 *   character_relationships     AUTHORED
 *   character_derivations       DERIVED CACHE  counts, presence, scenes
 *   character_cue_tallies       DERIVED CACHE  the counted spellings
 *
 * and the same shape for locations, scenes and the resolve queue. The
 * derivation writer in `../repositories/derived.ts` holds a handle that can
 * only reach the derived tables, so clobbering a synopsis is not a mistake
 * somebody has to avoid - it is a query that does not compile.
 *
 * Every table below says which half it is on its first line, because that
 * classification is the thing that decides who may write it.
 *
 * ## What a derived cache means
 *
 * AGENTS.md, exception table: derived entity rows are stored for "cross-episode
 * queryability" and must be "reproducible by re-derivation". Dropping every
 * derived table and re-running `derive` must produce the same rows. Nothing
 * downstream may treat one as authoritative over the node list.
 */

export const presenceEnum = pgEnum('presence', PRESENCE_STATES)
export const confidenceEnum = pgEnum('confidence', CONFIDENCES)
export const resolveRowStateEnum = pgEnum('resolve_row_state', RESOLVE_ROW_STATES)
export const resolveSubjectKindEnum = pgEnum('resolve_subject_kind', [
  'cue',
  'slugline',
  'structure',
])
export const resolveVerdictEnum = pgEnum('resolve_verdict', ['accepted', 'rejected'])
export const interiorExteriorEnum = pgEnum('interior_exterior', INTERIOR_EXTERIOR)
export const lightEnum = pgEnum('light', LIGHT_STATES)

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/**
 * A character record. AUTHORED.
 *
 * AGENTS.md, Entity identity: "A character is a **stable UUID with a name
 * attribute**. It is *not* its cue text." So the id is minted once and lives
 * forever; nothing here is keyed by, hashed from, or reconstructed out of a cue
 * string.
 *
 * `name` is authored even though it is seeded from the cue that minted the
 * record, because a record-level rename is one of exactly two sanctioned
 * write-backs - "an explicit rewrite operation, returns a diff, single undo
 * entry". **A derivation pass must never write this column,** and the table
 * split is what makes that true rather than intended.
 *
 * `merged_into` records a merge decision the writer made when two records
 * turned out to be one person. The row is kept rather than deleted so that
 * anything still pointing at the loser resolves, which is the same reasoning as
 * a node tombstone.
 */
export const characters = pgTable(
  'characters',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    bio: text('bio'),
    notes: jsonb('notes').notNull().default(sql`'{}'::jsonb`),
    /** Set when the writer merged this record into another. Never derived. */
    mergedInto: uuid('merged_into'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('characters_project_idx').on(table.projectId),
    check('characters_name_not_empty', sql`length(btrim(${table.name})) > 0`),
    check('characters_not_merged_into_self', sql`${table.mergedInto} IS DISTINCT FROM ${table.id}`),
  ],
)

/**
 * One bound cue spelling. AUTHORED.
 *
 * AGENTS.md, Entity identity: "Matching goes through an **alias table** ...
 * never by hashing the string. This is what makes `मीरा` and `MEERA` one
 * person." No normalisation can equate those two; a row here can, and it is the
 * only thing that can. So this is authored **input** to derivation, not output
 * from it - which is why it sits on this side of the split.
 *
 * `@folio/script`'s `alias.ts` note applies to anyone tempted to tidy this up
 * with normalisation: do not add diacritic folding to `canonicalKey`,
 * because Devanagari vowel signs are combining marks and folding would mangle
 * every Hindi cue in order to smooth over a Latin one.
 */
export const characterBoundCues = pgTable(
  'character_bound_cues',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    /** The cue as authored, modifiers included. `MEERA (V.O.)`. */
    cue: text('cue').notNull(),
    boundBy: uuid('bound_by').references(() => users.id, { onDelete: 'set null' }),
    boundAt: timestampColumn('bound_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.cue] }),
    /**
     * A cue spelling binds to at most one character in a project.
     *
     * Without this, two records could both claim `MEERA` and derivation would
     * have to pick - which is exactly the "binds by resemblance" behaviour
     * AGENTS.md forbids. An ambiguous cue must reach the resolve queue, not a
     * tiebreak.
     */
    uniqueIndex('character_bound_cues_project_cue_key').on(table.projectId, table.cue),
  ],
)

/** A relationship between two characters. AUTHORED. */
export const characterRelationships = pgTable(
  'character_relationships',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    otherId: uuid('other_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    what: text('what').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.otherId] }),
    index('character_relationships_project_idx').on(table.projectId),
    check('character_relationships_not_self', sql`${table.characterId} <> ${table.otherId}`),
  ],
)

/**
 * Everything about a character that is a function of the node list. DERIVED CACHE.
 *
 * `presence` is a named state, not an inference from `appearances = 0`.
 * AGENTS.md, Derivation: "**Records survive deletion.** ... `0 appearances ·
 * record kept` is a designed, valid state." A route reading a zero cannot tell
 * the designed state from a derivation bug; this column tells it.
 */
export const characterDerivations = pgTable(
  'character_derivations',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .primaryKey()
      .references(() => characters.id, { onDelete: 'cascade' }),
    appearances: integer('appearances').notNull().default(0),
    lines: integer('lines').notNull().default(0),
    mentions: integer('mentions').notNull().default(0),
    presence: presenceEnum('presence').notNull(),
    /** Heading node ids, in document order. */
    scenes: uuid('scenes').array().notNull().default(sql`ARRAY[]::uuid[]`),
    derivedAt: timestampColumn('derived_at').notNull().defaultNow(),
  },
  (table) => [
    index('character_derivations_project_idx').on(table.projectId),
    index('character_derivations_presence_idx').on(table.projectId, table.presence),
    check(
      'character_derivations_counts_not_negative',
      sql`${table.appearances} >= 0 AND ${table.lines} >= 0 AND ${table.mentions} >= 0`,
    ),
  ],
)

/**
 * One counted cue spelling. DERIVED CACHE.
 *
 * `cue` is what the writer reads, `key` is what matching uses with the delivery
 * modifiers taken off - so `MEERA` and `MEERA (V.O.)` stay two visible rows
 * that resolve to one person. Both are stored because the UI shows the first
 * and derivation uses the second; collapsing them would mean the Characters
 * route could only show whatever the matcher happened to keep.
 */
export const characterCueTallies = pgTable(
  'character_cue_tallies',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    cue: text('cue').notNull(),
    /** The cue with modifiers removed. What matching compares. */
    key: text('key').notNull(),
    occurrences: integer('occurrences').notNull().default(0),
    /** Dialogue *nodes* under this spelling. Not a rendered-line count. */
    lines: integer('lines').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.cue] }),
    index('character_cue_tallies_project_key_idx').on(table.projectId, table.key),
  ],
)

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * A location record, including its place in the tree. AUTHORED.
 *
 * `parent_id` is authored, and that is a ruling with a reason.
 * `@folio/script`'s `entities.ts` reconciles AGENTS.md saying both that
 * locations are derived from headings and that sub-sets hang off a primary set:
 * "the *records* come from the headings and the *tree* is drawn on top by a
 * human. So nothing in `derive.ts` ever writes this field." Derivation only
 * ever **proposes** an edge, into the resolve queue.
 *
 * `scheduled_days` is authored for a blunter reason: nothing in a node list
 * implies a shooting day. Derivation's job is the roll-up, which is what
 * answers AGENTS.md's "how many days in the chawl".
 *
 * A cycle in `parent_id` is authored input that is wrong. It is **not**
 * prevented here - no trigger, no recursive constraint. `derive` reports it as
 * a `BrokenLocationEdge` and rolls the record up as a root, per that package's
 * "it is reported as data and the record rolls up as a root, never thrown
 * over". A constraint that rejected the write would turn a reportable data
 * problem into a failed save, which is the opposite of what the pure core does.
 */
export const locations = pgTable(
  'locations',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Null for a primary set. Cycles are reported by `derive`, not rejected here. */
    parentId: uuid('parent_id'),
    scheduledDays: integer('scheduled_days').notNull().default(0),
    description: text('description'),
    notes: jsonb('notes').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('locations_project_idx').on(table.projectId),
    index('locations_parent_idx').on(table.parentId),
    check('locations_name_not_empty', sql`length(btrim(${table.name})) > 0`),
    check('locations_not_own_parent', sql`${table.parentId} IS DISTINCT FROM ${table.id}`),
    check('locations_scheduled_days_not_negative', sql`${table.scheduledDays} >= 0`),
  ],
)

/** The locations alias table: slugline set-texts bound to a record. AUTHORED. */
export const locationBoundSluglines = pgTable(
  'location_bound_sluglines',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    slugline: text('slugline').notNull(),
    boundBy: uuid('bound_by').references(() => users.id, { onDelete: 'set null' }),
    boundAt: timestampColumn('bound_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.locationId, table.slugline] }),
    /** Same reasoning as bound cues: an ambiguous slugline goes to the queue. */
    uniqueIndex('location_bound_sluglines_project_key').on(table.projectId, table.slugline),
  ],
)

/**
 * The roll-up. DERIVED CACHE.
 *
 * `own_*` counts this set; `rollup_*` counts it plus every descendant. Both are
 * stored because both are read, and the tree walk producing `rollup_*` is not
 * something a list view should do per row. AGENTS.md, Entity identity:
 * "Breakdown and scheduling count shooting days **by set**, and a flat list
 * cannot answer 'how many days in the chawl'."
 */
export const locationDerivations = pgTable(
  'location_derivations',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .primaryKey()
      .references(() => locations.id, { onDelete: 'cascade' }),
    /** 0 for a primary set. */
    depth: integer('depth').notNull().default(0),
    presence: presenceEnum('presence').notNull(),
    ownScenes: integer('own_scenes').notNull().default(0),
    ownSluglines: integer('own_sluglines').notNull().default(0),
    ownDayScenes: integer('own_day_scenes').notNull().default(0),
    ownNightScenes: integer('own_night_scenes').notNull().default(0),
    ownShootingDays: integer('own_shooting_days').notNull().default(0),
    rollupScenes: integer('rollup_scenes').notNull().default(0),
    rollupSluglines: integer('rollup_sluglines').notNull().default(0),
    rollupDayScenes: integer('rollup_day_scenes').notNull().default(0),
    rollupNightScenes: integer('rollup_night_scenes').notNull().default(0),
    rollupShootingDays: integer('rollup_shooting_days').notNull().default(0),
    scenes: uuid('scenes').array().notNull().default(sql`ARRAY[]::uuid[]`),
    derivedAt: timestampColumn('derived_at').notNull().defaultNow(),
  },
  (table) => [
    index('location_derivations_project_idx').on(table.projectId),
    check('location_derivations_depth_not_negative', sql`${table.depth} >= 0`),
    check(
      'location_derivations_rollup_covers_own',
      sql`${table.rollupScenes} >= ${table.ownScenes}
          AND ${table.rollupShootingDays} >= ${table.ownShootingDays}`,
    ),
  ],
)

/** One counted slugline spelling. DERIVED CACHE. */
export const locationSluglineTallies = pgTable(
  'location_slugline_tallies',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    slugline: text('slugline').notNull(),
    key: text('key').notNull(),
    occurrences: integer('occurrences').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.locationId, table.slugline] }),
    index('location_slugline_tallies_project_key_idx').on(table.projectId, table.key),
  ],
)

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/**
 * What a writer hangs on a scene. AUTHORED.
 *
 * `scene_node_id` is the primary key and it is the **heading node's id**, not a
 * minted one. `@folio/script`'s `entities.ts`: a node id "already survives
 * splits, merges, type changes and reorders, which is exactly the lifetime a
 * scene record needs, and it means moving a scene up the script does not detach
 * its synopsis." It also spends no entropy - 220 scenes cost zero ids.
 *
 * There is deliberately no `ON DELETE CASCADE` from `nodes`. A heading that
 * leaves the script must not take the synopsis with it: `derive` marks the
 * scene `absent` and the record is kept, the same rule as a character. The
 * reference is therefore `ON DELETE SET NULL` on a *separate* nullable column
 * and the primary key stands alone - see `sceneNodeRef` below.
 *
 * `beats` and `threads` are opaque strings because neither Beats nor Timeline
 * is a table in this phase. They are carried so a re-derive cannot drop them;
 * they are not foreign keys and are not pretending to be.
 */
export const scenes = pgTable(
  'scenes',
  {
    /** The heading node's id. Not a foreign key - see the note above. */
    sceneNodeId: uuid('scene_node_id').primaryKey(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    synopsis: text('synopsis'),
    storyTime: text('story_time'),
    beats: text('beats').array().notNull().default(sql`ARRAY[]::text[]`),
    threads: text('threads').array().notNull().default(sql`ARRAY[]::text[]`),
    notes: jsonb('notes').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index('scenes_project_idx').on(table.projectId)],
)

/**
 * Everything about a scene that is a function of the node list. DERIVED CACHE.
 *
 * No page number, no eighths - those are measurement and live on a measurement
 * record. `@folio/script` states the same boundary: "Nothing here counts pages,
 * eighths or rendered lines."
 *
 * `number` is 0 when the scene is absent, matching the pure core exactly.
 *
 * `reading` is the parsed slugline as JSON - what the heading *says*, not which
 * record it belongs to. Resolution goes through the alias table like everything
 * else, which is what keeps "a malformed heading does not silently become a
 * scene" true: `INTERCUT - PHONE CALL` produces a reading, not a location.
 */
export const sceneDerivations = pgTable(
  'scene_derivations',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    sceneNodeId: uuid('scene_node_id')
      .primaryKey()
      .references(() => scenes.sceneNodeId, { onDelete: 'cascade' }),
    /** 1-based in document order. 0 once the heading has left the script. */
    number: integer('number').notNull().default(0),
    heading: text('heading').notNull(),
    /** `SluglineReading` as JSON. Text only; it resolves nothing. */
    reading: jsonb('reading').notNull(),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    cast: uuid('cast').array().notNull().default(sql`ARRAY[]::uuid[]`),
    speaking: uuid('speaking').array().notNull().default(sql`ARRAY[]::uuid[]`),
    mentioned: uuid('mentioned').array().notNull().default(sql`ARRAY[]::uuid[]`),
    /** Cues in this scene pointing at no record. Each has a queue row. */
    unresolvedCues: text('unresolved_cues').array().notNull().default(sql`ARRAY[]::text[]`),
    castSize: integer('cast_size').notNull().default(0),
    /** Dialogue *nodes*, not rendered lines. */
    lines: integer('lines').notNull().default(0),
    presence: presenceEnum('presence').notNull(),
    derivedAt: timestampColumn('derived_at').notNull().defaultNow(),
  },
  (table) => [
    index('scene_derivations_project_number_idx').on(table.projectId, table.number),
    index('scene_derivations_location_idx').on(table.locationId),
    check('scene_derivations_number_not_negative', sql`${table.number} >= 0`),
    /**
     * An absent scene has no number; a present one has one.
     *
     * The pure core encodes this as "0 when the scene is absent from the
     * script", and stating it as a constraint is what stops a half-written
     * derivation pass leaving a present scene at 0 and quietly reordering the
     * Scenes route.
     */
    check(
      'scene_derivations_number_matches_presence',
      sql`(${table.presence} = 'absent') = (${table.number} = 0)`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// The resolve queue
// ---------------------------------------------------------------------------

/**
 * One row of the resolve queue. DERIVED CACHE.
 *
 * AGENTS.md, Entity identity: "**The resolve queue is rows, not a computed
 * view.**" That is about the *decision*, which is the authored table below. The
 * row itself is derived - it exists because something in the script points at
 * nothing - and is keyed by `resolveRowKey(subject)` from `@folio/script`, so
 * it has the same identity across passes without anything being minted.
 *
 * `state` keeps a row that is `settled` or `gone` rather than deleting it,
 * because decisions hang off the key: "a rejection that evaporates when a cue
 * is briefly deleted is a rejection the writer gets asked about twice."
 *
 * `suppressed` is the candidates a decision removed, so a row with no proposal
 * can say why it has none.
 *
 * Nothing here binds by resemblance. AGENTS.md: only an exact alias-table match
 * resolves a cue; "every near-miss is a resolve-queue row carrying a
 * confidence, for the writer to accept or reject."
 */
export const resolveRows = pgTable(
  'resolve_rows',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    /** `resolveRowKey(subject)`: subject kind plus canonical key. Nothing minted. */
    key: text('key').notNull(),
    subjectKind: resolveSubjectKindEnum('subject_kind').notNull(),
    /** The full `ResolveSubject` as JSON. The columns beside it are for querying. */
    subject: jsonb('subject').notNull(),
    occurrences: integer('occurrences').notNull().default(0),
    scenes: uuid('scenes').array().notNull().default(sql`ARRAY[]::uuid[]`),
    /** `ProposalTarget` as JSON. Null when every candidate was suppressed. */
    proposalTarget: jsonb('proposal_target'),
    proposalConfidence: confidenceEnum('proposal_confidence'),
    suppressed: jsonb('suppressed').notNull().default(sql`'[]'::jsonb`),
    state: resolveRowStateEnum('state').notNull(),
    derivedAt: timestampColumn('derived_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.key] }),
    index('resolve_rows_state_idx').on(table.projectId, table.state),
    /** A proposal is a target and a confidence, or it is neither. */
    check(
      'resolve_rows_proposal_complete',
      sql`(${table.proposalTarget} IS NULL) = (${table.proposalConfidence} IS NULL)`,
    ),
  ],
)

/**
 * The writer's decision on one proposal. AUTHORED.
 *
 * AGENTS.md, exception table: resolve-queue decisions "are **authored input**,
 * not derived output. Real rows." And: "A rejected proposal must not reappear
 * identically on the next derivation pass."
 *
 * `@folio/script` takes the strict reading of *identically*: the same target
 * for the same subject never comes back, at any confidence, because "a
 * rejection a later pass could undo by rescoring the same guess is not a
 * decision, it is a delay." A re-derive reads this table to honour that, and
 * **nothing in a derivation pass may write it.**
 *
 * `row_key` is a plain column, not a foreign key to `resolve_rows`. That is
 * deliberate: a decision has to outlive the row it decided. A cue deleted and
 * retyped comes back as the same key, and the rejection must still be there
 * waiting for it.
 */
export const resolveDecisions = pgTable(
  'resolve_decisions',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    /** Not an FK. A decision outlives the derived row it decided. See above. */
    rowKey: text('row_key').notNull(),
    verdict: resolveVerdictEnum('verdict').notNull(),
    /** The `ProposalTarget` decided on, as JSON. */
    target: jsonb('target').notNull(),
    /**
     * A stable rendering of `target`, so "the same target twice" is a
     * uniqueness constraint rather than a JSON comparison at read time.
     */
    targetKey: text('target_key').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestampColumn('decided_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('resolve_decisions_row_target_key').on(
      table.projectId,
      table.rowKey,
      table.targetKey,
    ),
    index('resolve_decisions_project_idx').on(table.projectId),
  ],
)
