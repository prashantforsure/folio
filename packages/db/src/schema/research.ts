import { RESEARCH_COLLECTION_COLOURS, RESEARCH_FILING_KINDS, RESEARCH_SOURCE_KINDS } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import { check, index, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import {
  createdAtColumn,
  idColumn,
  idempotencyKeyColumn,
  projectIdColumn,
  updatedAtColumn,
} from './columns'
import { characters, locations } from './derived'
import { projects, users } from './tenancy'

/**
 * Research: collections, sources, clips and filings. All four AUTHORED.
 *
 * `docs/ui design/Route - Research v2.dc.html` (2026-09-16). A source is a
 * thing a writer brought in from outside the script; a clip is a line of it
 * they highlighted; a filing is where they sent the clip. None of it is a
 * function of the node list, so none of it is a cache and `derive` never
 * touches these rows (`@folio/contracts`'s `research.ts` for the reasoning).
 *
 * ## `research_clip_filings` points at the script and is not pointed back at
 *
 * A filing names one of three targets, and the row says which in `kind`:
 *
 *   character   `character_id`, a real key - deleting the record takes the filing
 *   location    `location_id`, likewise
 *   scene       `scene_node_id`, the heading node's id and **no foreign key**,
 *               exactly as `shots.scene_node_id` (`storyboard.ts`): a heading
 *               that leaves the script and comes back by undo is the same
 *               scene and finds its clips where it left them. A filing whose
 *               heading is gone resolves to no scene ref at read; it is
 *               unreachable from the script, not wrong.
 *
 * The check below refuses a row whose columns disagree with its kind, and
 * three partial unique indexes refuse filing one clip to the same place
 * twice. Nothing on `nodes`, `characters` or `locations` refers to a clip.
 *
 * ## A collection is a folder, and an empty folder is dropped
 *
 * `research_collections` is the sidebar's list. A name is unique within a
 * project; the colour is one of the closed `RESEARCH_COLLECTION_COLOURS`,
 * each a themed token in `packages/ui`. The mockup draws no way to make or
 * delete a collection on its own - one is made by naming it on a source,
 * and the repository drops one when its last source leaves it, so the list
 * is never a list of empty folders.
 */

export const researchSourceKindEnum = pgEnum('research_source_kind', RESEARCH_SOURCE_KINDS)
export const researchCollectionColourEnum = pgEnum('research_collection_colour', RESEARCH_COLLECTION_COLOURS)
export const researchFilingKindEnum = pgEnum('research_filing_kind', RESEARCH_FILING_KINDS)

export const researchCollections = pgTable(
  'research_collections',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colour: researchCollectionColourEnum('colour').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('research_collections_project_name_key').on(table.projectId, table.name),
    check('research_collections_name_not_empty', sql`length(btrim(${table.name})) > 0`),
  ],
)

export const researchSources = pgTable(
  'research_sources',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    /** Null: filed nowhere. Removing a collection leaves its sources in the library. */
    collectionId: uuid('collection_id').references(() => researchCollections.id, { onDelete: 'set null' }),
    kind: researchSourceKindEnum('kind').notNull(),
    title: text('title').notNull(),
    /** Where it came from - a domain, a date, `own`. Free text. */
    origin: text('origin'),
    note: text('note'),
    /** The source's text - a transcript, an article's copy. Empty for a set of photographs. */
    body: text('body').notNull().default(''),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    /** Null for a person clicking a button; set by a caller that can be retried (ADR 0003 D13). */
    idempotencyKey: idempotencyKeyColumn(),
  },
  (table) => [

    /** A retried create lands once. Partial, so the null every UI create carries is free. */
    uniqueIndex('research_sources_idempotency_key')
      .on(table.projectId, table.idempotencyKey)
      .where(sql`idempotency_key is not null`),    /** The library's read: a project's sources, newest first. */
    index('research_sources_project_created_idx').on(table.projectId, table.createdAt),
    index('research_sources_collection_idx').on(table.collectionId),
    check('research_sources_title_not_empty', sql`length(btrim(${table.title})) > 0`),
  ],
)

export const researchClips = pgTable(
  'research_clips',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => researchSources.id, { onDelete: 'cascade' }),
    /** The highlighted line, as selected. Found again in the body at read. */
    text: text('text').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('research_clips_source_created_idx').on(table.sourceId, table.createdAt),
    index('research_clips_project_idx').on(table.projectId),
    check('research_clips_text_not_empty', sql`length(btrim(${table.text})) > 0`),
  ],
)

export const researchClipFilings = pgTable(
  'research_clip_filings',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    clipId: uuid('clip_id')
      .notNull()
      .references(() => researchClips.id, { onDelete: 'cascade' }),
    kind: researchFilingKindEnum('kind').notNull(),
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'cascade' }),
    /** The heading node's id. Not a foreign key - see the header. */
    sceneNodeId: uuid('scene_node_id'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('research_clip_filings_clip_idx').on(table.clipId),
    index('research_clip_filings_project_idx').on(table.projectId),
    /** The reverse read a later route may want: every clip filed to a scene, a character, a location. */
    index('research_clip_filings_scene_idx').on(table.projectId, table.sceneNodeId),
    uniqueIndex('research_clip_filings_character_key')
      .on(table.clipId, table.characterId)
      .where(sql`${table.characterId} IS NOT NULL`),
    uniqueIndex('research_clip_filings_location_key')
      .on(table.clipId, table.locationId)
      .where(sql`${table.locationId} IS NOT NULL`),
    uniqueIndex('research_clip_filings_scene_key')
      .on(table.clipId, table.sceneNodeId)
      .where(sql`${table.sceneNodeId} IS NOT NULL`),
    /** One target, and the one the kind says. */
    check(
      'research_clip_filings_one_target',
      sql`(${table.kind} = 'character' AND ${table.characterId} IS NOT NULL AND ${table.locationId} IS NULL AND ${table.sceneNodeId} IS NULL)
       OR (${table.kind} = 'location' AND ${table.locationId} IS NOT NULL AND ${table.characterId} IS NULL AND ${table.sceneNodeId} IS NULL)
       OR (${table.kind} = 'scene' AND ${table.sceneNodeId} IS NOT NULL AND ${table.characterId} IS NULL AND ${table.locationId} IS NULL)`,
    ),
  ],
)
