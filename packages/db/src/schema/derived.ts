import {
  CHARACTER_COLOR_IDS,
  CHARACTER_GENDERS,
  CHARACTER_ORIGINS,
  CHARACTER_STATUSES,
  LOCATION_STATUSES,
} from '@folio/contracts'
import { CONFIDENCES, INTERIOR_EXTERIOR, LIGHT_STATES, PRESENCE_STATES, RESOLVE_ROW_STATES } from '@folio/script'
import { sql } from 'drizzle-orm'
import {
  boolean,
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
 *   characters                  AUTHORED       name, bio, notes, the profile, the origin
 *   character_bound_cues        AUTHORED       the alias table's authored half
 *   character_relationships     AUTHORED       kept as a derivation read; no screen writes it since 0013
 *   character_findings          AUTHORED       the assistant's contradictions and the writer's verdicts (0022)
 *   character_derivations       DERIVED CACHE  counts, presence, scenes, the voice (0021)
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
export const characterGenderEnum = pgEnum('character_gender', CHARACTER_GENDERS)
export const characterStatusEnum = pgEnum('character_status', CHARACTER_STATUSES)
export const characterOriginEnum = pgEnum('character_origin', CHARACTER_ORIGINS)
/**
 * The findings enums' values, once `@folio/contracts`'s `CHARACTER_FINDING_*`
 * - the contract left with the fourth Characters pass (2026-09-20), the
 * table is orphaned and kept, and a Postgres enum must still be declared
 * with the values it has. Nothing reads them but the schema.
 */
const CHARACTER_FINDING_KINDS = ['contradiction'] as const
const CHARACTER_FINDING_STATUSES = ['open', 'deliberate'] as const

export const characterFindingKindEnum = pgEnum('character_finding_kind', CHARACTER_FINDING_KINDS)
export const characterFindingStatusEnum = pgEnum('character_finding_status', CHARACTER_FINDING_STATUSES)
export const locationStatusEnum = pgEnum('location_status', LOCATION_STATUSES)

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
 *
 * The profile columns are what a card shows and the drawer edits (Characters
 * route, second pass, migration `0013`): `color` - the name of a `--chip-N`
 * token, checked against the list; `gender`; `age` as text, because "40s"
 * is an age; `role`; `bio`; `appearance` - the notes a look-sheet job will
 * read; `portrait_key` - the storage object's key, never a URL, so the
 * bucket can move without a data change. `@folio/contracts`'s
 * `characters.ts` says what each is for. All authored; a re-derive touches
 * none of them, which the table split guarantees rather than a comment.
 * The first pass's drives, voice rules, key lines and arc turns were
 * dropped in `0013` on the client's ruling.
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
    /** A `--chip-N` token name from `CHARACTER_COLOR_IDS`. Checked below. */
    color: text('color').notNull().default('chip-1'),
    gender: characterGenderEnum('gender'),
    age: text('age'),
    role: text('role'),
    /** Notes for the look sheet a later job draws. Free text. */
    appearance: text('appearance'),
    /** The portrait's object key in storage. Null with no portrait. */
    portraitKey: text('portrait_key'),
    /**
     * The v2 pass (migration `0017`): the status the writer sets - `draft`
     * until they say otherwise - and the two lines the drawer authors.
     * `wants` / `needs` were dropped in `0013` and come back here alone, as
     * the v2 mockup draws them; the sources and the flaw do not.
     */
    status: characterStatusEnum('status').notNull().default('draft'),
    wants: text('wants'),
    needs: text('needs'),
    /**
     * Where the record came from (`0021`): a pass, a hand, an `@` mention,
     * the assistant. Written once at creation, never changed, never
     * derived; null on every record made before the column existed - no
     * backfill guesses at a history nobody recorded.
     */
    origin: characterOriginEnum('origin'),
    /**
     * Where the canvas left the card (the fourth pass, `0024`, on the
     * `shots.canvas_x` pattern of `0020`): world px, whole, both or
     * neither by the check below. Null means "never moved" - the canvas
     * lays the card out on the first free cell in grid order. Cosmetic:
     * nothing derived reads it, and a re-derive never writes it.
     */
    canvasX: integer('canvas_x'),
    canvasY: integer('canvas_y'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('characters_project_idx').on(table.projectId),
    check('characters_name_not_empty', sql`length(btrim(${table.name})) > 0`),
    check('characters_not_merged_into_self', sql`${table.mergedInto} IS DISTINCT FROM ${table.id}`),
    check('characters_color_known', sql`${table.color} = any(${sql.raw(`ARRAY[${CHARACTER_COLOR_IDS.map((id) => `'${id}'`).join(', ')}]::text[]`)})`),
    check('characters_canvas_position_whole', sql`(${table.canvasX} IS NULL) = (${table.canvasY} IS NULL)`),
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

/**
 * A relationship between two characters. AUTHORED.
 *
 * Reshaped in `0024` (the Characters fourth pass, 2026-09-20 - the
 * Relationships graph laper.ai draws, by the client's ruling): one row per
 * unordered pair, `character_id < other_id` by a check, so the primary key
 * is the dedupe and either order finds the row. The two labels are
 * directional - `a_is` reads "<character_id> is <other_id>'s a_is"
 * (`sister`), `b_is` the other way (`brother`) - and at least one is
 * written. `description` is the free line under them. The first shape's
 * `what` / `shift` (one directed row per side, `0013`) were dropped: the
 * table was empty, nothing had written it since that migration.
 *
 * Authored, never derived: who talks to whom is `character_derivations.
 * exchanges` and the graph's `Dialogue` layout reads that instead. The
 * derivation reads this table only to hand `@folio/script` each side's
 * `{ other, what }` list (`repositories/derivation.ts`).
 */
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
    /** What `character_id` is to `other_id`: `sister`. Empty when only the other side is named. */
    aIs: text('a_is').notNull().default(''),
    /** What `other_id` is to `character_id`: `brother`. */
    bIs: text('b_is').notNull().default(''),
    description: text('description'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.otherId] }),
    index('character_relationships_project_idx').on(table.projectId),
    check('character_relationships_ordered', sql`${table.characterId} < ${table.otherId}`),
    check('character_relationships_labelled', sql`length(btrim(${table.aIs})) > 0 OR length(btrim(${table.bIs})) > 0`),
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
    /**
     * The voice (`0021`) - what the pass counts beyond scenes and lines, all
     * of it a function of the node list and rebuilt every pass: dialogue
     * words, speeches (cue nodes), parentheticals, action lines naming the
     * record; the first, last and longest line and the introducing action
     * line as JSON `{ nodeId, scene }` (no foreign key, on the
     * `scenes.threads` convention - a node that has left the script is
     * dropped on read); what is said per scene and who is talked to as JSON
     * lists. JSON rather than two more tables because the loader already
     * joins this one row per record, `commitDerivation` stays one statement,
     * and a new table needs an RLS block.
     */
    words: integer('words').notNull().default(0),
    speeches: integer('speeches').notNull().default(0),
    parens: integer('parens').notNull().default(0),
    namedIn: integer('named_in').notNull().default(0),
    firstLine: jsonb('first_line'),
    lastLine: jsonb('last_line'),
    longest: jsonb('longest'),
    introducedAt: jsonb('introduced_at'),
    sceneCounts: jsonb('scene_counts').notNull().default(sql`'[]'::jsonb`),
    exchanges: jsonb('exchanges').notNull().default(sql`'[]'::jsonb`),
    derivedAt: timestampColumn('derived_at').notNull().defaultNow(),
  },
  (table) => [
    index('character_derivations_project_idx').on(table.projectId),
    index('character_derivations_presence_idx').on(table.projectId, table.presence),
    check(
      'character_derivations_counts_not_negative',
      sql`${table.appearances} >= 0 AND ${table.lines} >= 0 AND ${table.mentions} >= 0`,
    ),
    check(
      'character_derivations_voice_counts_not_negative',
      sql`${table.words} >= 0 AND ${table.speeches} >= 0 AND ${table.parens} >= 0 AND ${table.namedIn} >= 0`,
    ),
  ],
)

/**
 * A continuity finding on a character. AUTHORED, on the assistant's word
 * and the writer's verdict (`0022`).
 *
 * ORPHANED 2026-09-20: the Characters fourth pass removed the drawer's
 * `✦ Check for contradictions` and with it every reader and writer of this
 * table (`replaceOpenFindings`, `setFindingStatus`, `listCharacterFindings`
 * went with `lib/characters/model-actions.ts`). The table stays,
 * forward-only, like `revisions` - dropping it is a migration that drops
 * user data, which is ask-first (AGENTS.md, When to ask first). The
 * description below is what it was built for.
 *
 * The one kind is a contradiction: two quotes from the script that cannot
 * both be true of the character - the script against itself, never against
 * a note or a bible (`docs/build-decisions.md`, "Bible route removed").
 * The assistant returns the pair; `replaceOpenFindings` keeps it as a row
 * so the writer's `It's deliberate` survives a re-check, and so a finding
 * has two citations rather than being prose in a chat. `a_ref` / `b_ref`
 * are heading node ids stored sorted, no key (the `shots.scene_node_id`
 * convention); `claim_hash` is the normalised claim's FNV-1a, a column
 * because the dedupe index needs a plain target. Cascades with the record.
 *
 * AGENTS.md's "nothing is stored that can be computed" exception row: a
 * finding is a model's answer, not a function of the node list, so it is
 * stored - and marked as the assistant's, never the derivation's.
 */
export const characterFindings = pgTable(
  'character_findings',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    kind: characterFindingKindEnum('kind').notNull(),
    status: characterFindingStatusEnum('status').notNull().default('open'),
    /** Heading node ids, `a_ref < b_ref`. No key: a scene that leaves the script drops the finding on read. */
    aRef: uuid('a_ref').notNull(),
    bRef: uuid('b_ref').notNull(),
    aQuote: text('a_quote').notNull(),
    bQuote: text('b_quote').notNull(),
    claim: text('claim').notNull(),
    /** FNV-1a 64 of the normalised claim, 16 hex characters. The dedupe key's plain column. */
    claimHash: text('claim_hash').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('character_findings_character_status_idx').on(table.characterId, table.status),
    index('character_findings_project_idx').on(table.projectId),
    uniqueIndex('character_findings_dedupe_key').on(table.projectId, table.characterId, table.aRef, table.bRef, table.claimHash),
    check('character_findings_two_scenes', sql`${table.aRef} <> ${table.bRef}`),
    check('character_findings_refs_sorted', sql`${table.aRef} < ${table.bRef}`),
    check(
      'character_findings_text_not_empty',
      sql`length(btrim(${table.aQuote})) > 0 AND length(btrim(${table.bQuote})) > 0 AND length(btrim(${table.claim})) > 0`,
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
    /** Dialogue words under this spelling (`0021`). */
    words: integer('words').notNull().default(0),
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
 *
 * `merged_into` (Locations route phase) is the same tombstone `characters`
 * carries: set when the writer merged this record into another, kept rather
 * than deleted so a `@mention` or a scene still pointing at the loser can
 * follow it. Never derived.
 *
 * `status`, `address` and `photo_key` (the v2 pass, migration `0018`) are
 * what `Route - Locations v2.dc.html` draws and the drawer edits: the
 * scouting status - `pending` until the writer says otherwise - one line of
 * address, and the photo's storage key, never a URL, on the portrait's
 * pattern. All authored; a re-derive touches none of them.
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
    /** Set when the writer merged this record into another. Never derived. */
    mergedInto: uuid('merged_into'),
    /** The scouting status the writer sets. `pending` is what a pass mints. */
    status: locationStatusEnum('status').notNull().default('pending'),
    /** "Actual or fictional address…" - one authored line. */
    address: text('address'),
    /** The photo's object key in storage. Null with no photo. */
    photoKey: text('photo_key'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('locations_project_idx').on(table.projectId),
    index('locations_parent_idx').on(table.parentId),
    check('locations_name_not_empty', sql`length(btrim(${table.name})) > 0`),
    check('locations_not_own_parent', sql`${table.parentId} IS DISTINCT FROM ${table.id}`),
    check('locations_scheduled_days_not_negative', sql`${table.scheduledDays} >= 0`),
    check('locations_not_merged_into_self', sql`${table.mergedInto} IS DISTINCT FROM ${table.id}`),
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
 * `beats` and `threads` are opaque strings: neither was a table when the
 * column was declared, and they are carried so a re-derive cannot drop them.
 * Nothing writes `beats` any more - the Beats route that filled it with
 * outline beat block ids was removed (`docs/build-decisions.md`, "Beats
 * route removed"); rows written before that keep their ids, unread.
 * `threads` is the Timeline's link since that phase: the ids of the
 * `story_threads` rows (`timeline.ts`) the scene runs through, in the
 * writer's order, the first being the row its card sits in. Still text,
 * still no foreign key - a deleted thread is removed from every scene by
 * the repository in one statement, and a stale id is dropped on read.
 *
 * Story time is the Timeline's other authored thing, and it is three typed
 * columns rather than the `story_time` text beside them: `story_day` (any
 * integer; Day 1 first by convention), `story_clock` (`HH:MM`, checked),
 * `flashback`. "Authored, not parsed: `DAY` and `NIGHT` in a slugline are
 * time of day, not a date" - so nothing in a derivation pass touches them,
 * which the table split guarantees. A clock needs a day (checked); the
 * flashback flag stands alone. `story_time` predates the shape and has no
 * writer; dropping a column is asked for, so it stays.
 */
export const scenes = pgTable(
  'scenes',
  {
    /** The heading node's id. Not a foreign key - see the note above. */
    sceneNodeId: uuid('scene_node_id').primaryKey(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    synopsis: text('synopsis'),
    /** Opaque and unwritten. Story time is the three columns after it. */
    storyTime: text('story_time'),
    storyDay: integer('story_day'),
    /** `HH:MM`, 24-hour. Text, because that shape sorts as a clock does. */
    storyClock: text('story_clock'),
    flashback: boolean('flashback').notNull().default(false),
    beats: text('beats').array().notNull().default(sql`ARRAY[]::text[]`),
    /** Story thread ids, as text. See the note above. */
    threads: text('threads').array().notNull().default(sql`ARRAY[]::text[]`),
    notes: jsonb('notes').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('scenes_project_idx').on(table.projectId),
    check(
      'scenes_story_clock_shape',
      sql`${table.storyClock} IS NULL OR ${table.storyClock} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    /** A time of day on no day orders nothing. */
    check('scenes_story_clock_needs_day', sql`${table.storyClock} IS NULL OR ${table.storyDay} IS NOT NULL`),
  ],
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
    /** Dialogue words under the heading, every cue counted (`0021`) - the share denominator. */
    words: integer('words').notNull().default(0),
    presence: presenceEnum('presence').notNull(),
    derivedAt: timestampColumn('derived_at').notNull().defaultNow(),
  },
  (table) => [
    index('scene_derivations_project_number_idx').on(table.projectId, table.number),
    index('scene_derivations_location_idx').on(table.locationId),
    check('scene_derivations_number_not_negative', sql`${table.number} >= 0`),
    check('scene_derivations_words_not_negative', sql`${table.words} >= 0`),
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
