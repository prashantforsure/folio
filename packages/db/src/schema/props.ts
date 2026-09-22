import { PROP_STATUSES } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import { check, index, pgEnum, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'

import {
  createdAtColumn,
  idColumn,
  projectIdColumn,
  timestampColumn,
  updatedAtColumn,
} from './columns'
import { projects, users } from './tenancy'

/**
 * Props. Both tables AUTHORED, and that is the whole design.
 *
 * `schema/index.ts` classifies every table, and the interesting thing about
 * these two is that **neither has a derived half**. `characters` and
 * `locations` each sit beside a `*_derivations` cache because a cue and a
 * slugline are parts of the node model - a pass can count them. Nothing in
 * a screenplay's grammar is a prop: a bat is a noun in a line of action,
 * and no derivation can tell it from a bench. So there is no
 * `prop_derivations`, no tally table, and no resolve queue; what the script
 * says about a prop is read at request time by `@folio/script`'s `props.ts`
 * over the node list the route already has in hand, and thrown away with
 * the response. AGENTS.md, "Nothing is stored that can be computed": the
 * three cases it exempts are page numbers, the credit balance and derived
 * entity rows, and this is none of them - so it is not stored.
 *
 * That also means a re-derive cannot touch a prop, which is the guarantee
 * the authored/derived table split exists to give, obtained here for free.
 *
 * ## `prop_aliases` is `location_bound_sluglines` minus its unique index
 *
 * The alias table is the mechanism that makes the evidence reading work:
 * "Game Ball" is a record name and the page writes "the ball", and a row
 * here is the writer saying they are one thing (AGENTS.md, Entity
 * identity: "Matching goes through an **alias table** ... never by hashing
 * the string").
 *
 * `location_bound_sluglines` carries `uniqueIndex(project_id, slugline)`,
 * because a heading resolves to exactly one set and an ambiguous one has to
 * go to the queue instead. **That index is deliberately absent here.** Two
 * props may both be "the bag" - the one Meera carries and the one that
 * comes back empty - and a line that says "the bag" is evidence for both;
 * there is nothing to disambiguate, because an alias never *resolves* a
 * prop, it only makes a line worth quoting. The primary key is still
 * `(prop_id, alias)`, so one prop cannot hold the same spelling twice.
 *
 * ## The merge tombstone
 *
 * `merged_into` is the tombstone `characters` and `locations` carry, for
 * the same reason and with the same rule: set when the writer merged this
 * record into another, kept rather than deleted so a `reel_shots.prop_id`
 * or a `scenes.prop_id` still pointing at the loser can follow it. Never
 * derived, never a cascade.
 *
 * No tree. A prop is not a sub-prop of a prop - a kit bag with a ball in it
 * is two records and the writer's own sentence - so there is no
 * `parent_id` and nothing here walks.
 */

/** `needed | sourced | on set` - `@folio/contracts`, `props.ts` says why three. */
export const propStatusEnum = pgEnum('prop_status', PROP_STATUSES)

/**
 * A prop record. AUTHORED, entirely: a person typed every column.
 *
 * `category` is `text`, not an enum, and that is a ruling rather than a
 * gap: a production's vocabulary for props is its own, so the route offers
 * the values the project already uses and takes a new one by being typed
 * in. A migration to add `Picture vehicle` would be this schema guessing at
 * somebody's breakdown sheet.
 *
 * `photo_key` is the object's key in storage, never a URL - the portrait's
 * and the location photo's pattern, so the bucket can move without a
 * migration.
 */
export const props = pgTable(
  'props',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The writer's word for what kind of thing it is. Free text, offered from what the project uses. */
    category: text('category'),
    description: text('description'),
    /** How far along getting hold of it is. `needed` is what a new record mints as. */
    status: propStatusEnum('status').notNull().default('needed'),
    /** The photo's object key in storage. Null with no photo. */
    photoKey: text('photo_key'),
    /** Set when the writer merged this record into another. Never derived. */
    mergedInto: uuid('merged_into'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('props_project_idx').on(table.projectId),
    check('props_name_not_empty', sql`length(btrim(${table.name})) > 0`),
    check('props_not_merged_into_self', sql`${table.mergedInto} IS DISTINCT FROM ${table.id}`),
  ],
)

/**
 * The props alias table: spellings the page uses, bound to a record.
 * AUTHORED. See the header for why there is no unique index per project.
 */
export const propAliases = pgTable(
  'prop_aliases',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    propId: uuid('prop_id')
      .notNull()
      .references(() => props.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    boundBy: uuid('bound_by').references(() => users.id, { onDelete: 'set null' }),
    boundAt: timestampColumn('bound_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.propId, table.alias] }),
    index('prop_aliases_project_idx').on(table.projectId),
    check('prop_aliases_not_empty', sql`length(btrim(${table.alias})) > 0`),
  ],
)
