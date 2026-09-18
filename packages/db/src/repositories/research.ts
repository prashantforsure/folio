import type {
  ResearchClipId,
  ResearchClipRow,
  ResearchCollectionColour,
  ResearchCollectionId,
  ResearchCollectionPick,
  ResearchCollectionRow,
  ResearchFilingId,
  ResearchFilingRow,
  ResearchFilingTarget,
  ResearchSource,
  ResearchSourceEdit,
  ResearchSourceId,
  ResearchSourceRow,
} from '@folio/contracts'
import {
  RESEARCH_COLLECTION_COLOURS,
  researchClipId as brandClipId,
  researchCollectionId as brandCollectionId,
  researchFilingId as brandFilingId,
  researchSourceId as brandSourceId,
} from '@folio/contracts'
import type { CharacterId, LocationId, NodeId } from '@folio/script'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { FolioDatabase } from '../client'
import {
  characters,
  locations,
  researchClipFilings,
  researchClips,
  researchCollections,
  researchSources,
  sceneDerivations,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp } from './mapping'

/**
 * Research. See `schema/research.ts` for what the four tables are.
 *
 * ## Every read is a join, every count is counted
 *
 * The library card's clip count, the sidebar's per-collection count and
 * the `Clips filed` widget are all `count(*)` over the rows that own them,
 * never a column - AGENTS.md, "nothing is stored that can be computed".
 *
 * ## A filing's scene is resolved by the caller
 *
 * `research_clip_filings.scene_node_id` has no key (the schema header says
 * why), so this repository hands a scene filing back as the node id alone -
 * `StoredFiling` - and `apps/web/lib/research/server.ts` joins it to the
 * scene index it already reads for the picker. A character or location
 * filing arrives with its name, because those are keys and the join is one
 * statement here.
 *
 * ## Collections are made by naming and dropped by leaving
 *
 * `ResearchCollectionPick` is `{ id }`, `{ name }` or `null`. A name that
 * matches an existing collection in the project reuses it; a new name is
 * inserted with the least-used colour. After every write that can empty a
 * collection - a save that moves a source, a delete - `pruneCollections`
 * removes the folders with nothing in them, in the same transaction.
 */

type Tx = Parameters<Parameters<FolioDatabase['transaction']>[0]>[0]

/** A filing as stored: a scene is its node id and nothing more. */
export type StoredFiling =
  | Extract<ResearchFilingRow, { readonly kind: 'character' | 'location' }>
  | { readonly id: ResearchFilingId; readonly kind: 'scene'; readonly sceneNodeId: NodeId }

export type ResearchClipRecord = Omit<ResearchClipRow, 'filings'> & {
  readonly filings: readonly StoredFiling[]
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every collection with how many sources it holds. Name order. */
export const listResearchCollections = async (scope: ProjectScope): Promise<readonly ResearchCollectionRow[]> => {
  const rows = await dbOf(scope)
    .select({
      id: researchCollections.id,
      name: researchCollections.name,
      colour: researchCollections.colour,
      sources: sql<number>`count(${researchSources.id})::int`,
    })
    .from(researchCollections)
    .leftJoin(researchSources, eq(researchSources.collectionId, researchCollections.id))
    .where(scoped(scope, researchCollections))
    .groupBy(researchCollections.id)
    .orderBy(asc(researchCollections.name))
  return rows.map((row) => ({
    id: brandCollectionId(row.id),
    name: row.name,
    colour: row.colour,
    sources: row.sources,
  }))
}

const sourceSelection = {
  id: researchSources.id,
  kind: researchSources.kind,
  title: researchSources.title,
  origin: researchSources.origin,
  note: researchSources.note,
  body: researchSources.body,
  collectionId: researchCollections.id,
  collectionName: researchCollections.name,
  collectionColour: researchCollections.colour,
  createdAt: researchSources.createdAt,
  updatedAt: researchSources.updatedAt,
}

type SourceSelection = {
  readonly id: string
  readonly kind: ResearchSource['kind']
  readonly title: string
  readonly origin: string | null
  readonly note: string | null
  readonly body: string
  readonly collectionId: string | null
  readonly collectionName: string | null
  readonly collectionColour: ResearchCollectionColour | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

const toSource = (row: SourceSelection): ResearchSource => ({
  id: brandSourceId(row.id),
  kind: row.kind,
  title: row.title,
  origin: row.origin,
  note: row.note,
  body: row.body,
  collection:
    row.collectionId === null || row.collectionName === null || row.collectionColour === null
      ? null
      : { id: brandCollectionId(row.collectionId), name: row.collectionName, colour: row.collectionColour },
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

/** Every source with its collection and clip count, newest first. The library. */
export const listResearchSources = async (scope: ProjectScope): Promise<readonly ResearchSourceRow[]> => {
  const rows = await dbOf(scope)
    .select({ ...sourceSelection, clips: sql<number>`count(${researchClips.id})::int` })
    .from(researchSources)
    .leftJoin(researchCollections, eq(researchCollections.id, researchSources.collectionId))
    .leftJoin(researchClips, eq(researchClips.sourceId, researchSources.id))
    .where(scoped(scope, researchSources))
    .groupBy(researchSources.id, researchCollections.id)
    .orderBy(desc(researchSources.createdAt), desc(researchSources.id))
  return rows.map((row) => ({ ...toSource(row), clips: row.clips }))
}

/** One source, or `null` when the id names nothing in this project. */
export const readResearchSource = async (scope: ProjectScope, id: ResearchSourceId): Promise<ResearchSource | null> => {
  const rows = await dbOf(scope)
    .select(sourceSelection)
    .from(researchSources)
    .leftJoin(researchCollections, eq(researchCollections.id, researchSources.collectionId))
    .where(scoped(scope, researchSources, eq(researchSources.id, id)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toSource(row)
}

/**
 * Every clip in the project - or one source's - oldest first, each with its
 * filings. Two statements: the clips, then every filing of those clips
 * with the character and location names joined in.
 */
export const listResearchClips = async (
  scope: ProjectScope,
  sourceId: ResearchSourceId | null = null,
): Promise<readonly ResearchClipRecord[]> => {
  const db = dbOf(scope)
  const clipRows = await db
    .select({
      id: researchClips.id,
      sourceId: researchClips.sourceId,
      text: researchClips.text,
      createdAt: researchClips.createdAt,
    })
    .from(researchClips)
    .where(scoped(scope, researchClips, sourceId === null ? undefined : eq(researchClips.sourceId, sourceId)))
    .orderBy(asc(researchClips.createdAt), asc(researchClips.id))
  if (clipRows.length === 0) return []

  const filingRows = await db
    .select({
      id: researchClipFilings.id,
      clipId: researchClipFilings.clipId,
      kind: researchClipFilings.kind,
      characterId: researchClipFilings.characterId,
      characterName: characters.name,
      locationId: researchClipFilings.locationId,
      locationName: locations.name,
      sceneNodeId: researchClipFilings.sceneNodeId,
    })
    .from(researchClipFilings)
    .leftJoin(characters, eq(characters.id, researchClipFilings.characterId))
    .leftJoin(locations, eq(locations.id, researchClipFilings.locationId))
    .where(
      scoped(
        scope,
        researchClipFilings,
        inArray(
          researchClipFilings.clipId,
          clipRows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(researchClipFilings.createdAt), asc(researchClipFilings.id))

  const byClip = new Map<string, StoredFiling[]>()
  for (const row of filingRows) {
    const filing = toFiling(row)
    if (filing === null) continue
    const list = byClip.get(row.clipId)
    if (list === undefined) byClip.set(row.clipId, [filing])
    else list.push(filing)
  }

  return clipRows.map((row) => ({
    id: brandClipId(row.id),
    sourceId: brandSourceId(row.sourceId),
    text: row.text,
    createdAt: stamp(row.createdAt),
    filings: byClip.get(row.id) ?? [],
  }))
}

const toFiling = (row: {
  readonly id: string
  readonly kind: 'character' | 'location' | 'scene'
  readonly characterId: string | null
  readonly characterName: string | null
  readonly locationId: string | null
  readonly locationName: string | null
  readonly sceneNodeId: string | null
}): StoredFiling | null => {
  const id = brandFilingId(row.id)
  switch (row.kind) {
    case 'character':
      // The check constraint makes the null branches unreachable; typed rather than asserted.
      return row.characterId === null || row.characterName === null
        ? null
        : { id, kind: 'character', characterId: row.characterId as CharacterId, name: row.characterName }
    case 'location':
      return row.locationId === null || row.locationName === null
        ? null
        : { id, kind: 'location', locationId: row.locationId as LocationId, name: row.locationName }
    case 'scene':
      return row.sceneNodeId === null ? null : { id, kind: 'scene', sceneNodeId: row.sceneNodeId as NodeId }
  }
}

// ---------------------------------------------------------------------------
// Collections, inside a transaction
// ---------------------------------------------------------------------------

/** The colour fewest of the project's collections wear; the first of the five on a tie. */
const leastUsedColour = async (tx: Tx, scope: ProjectScope): Promise<ResearchCollectionColour> => {
  const rows = await tx
    .select({ colour: researchCollections.colour, n: sql<number>`count(*)::int` })
    .from(researchCollections)
    .where(scoped(scope, researchCollections))
    .groupBy(researchCollections.colour)
  const counts = new Map(rows.map((row) => [row.colour, row.n]))
  let best: ResearchCollectionColour = RESEARCH_COLLECTION_COLOURS[0]
  let fewest = Number.POSITIVE_INFINITY
  for (const colour of RESEARCH_COLLECTION_COLOURS) {
    const n = counts.get(colour) ?? 0
    if (n < fewest) {
      fewest = n
      best = colour
    }
  }
  return best
}

/**
 * The collection id a pick means: an existing one, checked to be this
 * project's; a named one, found or made; or none. `undefined` when `{ id }`
 * names a collection that is not here - the caller refuses the whole write.
 */
const resolveCollection = async (
  tx: Tx,
  scope: ProjectScope,
  pick: ResearchCollectionPick,
): Promise<ResearchCollectionId | null | undefined> => {
  if (pick === null) return null
  if ('id' in pick) {
    const rows = await tx
      .select({ id: researchCollections.id })
      .from(researchCollections)
      .where(scoped(scope, researchCollections, eq(researchCollections.id, pick.id)))
      .limit(1)
    return rows[0] === undefined ? undefined : pick.id
  }
  const existing = await tx
    .select({ id: researchCollections.id })
    .from(researchCollections)
    .where(scoped(scope, researchCollections, eq(researchCollections.name, pick.name)))
    .limit(1)
  const found = existing[0]
  if (found !== undefined) return brandCollectionId(found.id)
  const colour = await leastUsedColour(tx, scope)
  const inserted = await tx
    .insert(researchCollections)
    .values({ ...tenant(scope), name: pick.name, colour })
    .returning({ id: researchCollections.id })
  const row = inserted[0]
  if (row === undefined) throw new Error('Folio: inserting a research collection returned no row.')
  return brandCollectionId(row.id)
}

/** Drop every collection of the project with no source in it. */
const pruneCollections = async (tx: Tx, scope: ProjectScope): Promise<void> => {
  await tx.delete(researchCollections).where(
    scoped(
      scope,
      researchCollections,
      sql`NOT EXISTS (SELECT 1 FROM ${researchSources} WHERE ${researchSources.collectionId} = ${researchCollections.id})`,
    ),
  )
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type SourceWriteResult = { readonly ok: true; readonly id: ResearchSourceId } | { readonly ok: false; readonly reason: 'collection' | 'missing' }

export const createResearchSource = async (scope: ProjectScope, edit: ResearchSourceEdit): Promise<SourceWriteResult> => {
  const actor = scope.actor
  if (actor === null) throw new Error('Folio: adding a research source needs an actor.')
  return dbOf(scope).transaction(async (tx) => {
    const collectionId = await resolveCollection(tx, scope, edit.collection)
    if (collectionId === undefined) return { ok: false, reason: 'collection' }
    const inserted = await tx
      .insert(researchSources)
      .values({
        ...tenant(scope),
        collectionId,
        kind: edit.kind,
        title: edit.title,
        origin: edit.origin,
        note: edit.note,
        body: edit.body,
        createdBy: actor,
      })
      .returning({ id: researchSources.id })
    const row = inserted[0]
    if (row === undefined) throw new Error('Folio: inserting a research source returned no row.')
    return { ok: true, id: brandSourceId(row.id) }
  })
}

export const updateResearchSource = async (
  scope: ProjectScope,
  id: ResearchSourceId,
  edit: ResearchSourceEdit,
): Promise<SourceWriteResult> =>
  dbOf(scope).transaction(async (tx) => {
    const collectionId = await resolveCollection(tx, scope, edit.collection)
    if (collectionId === undefined) return { ok: false, reason: 'collection' }
    const updated = await tx
      .update(researchSources)
      .set({
        collectionId,
        kind: edit.kind,
        title: edit.title,
        origin: edit.origin,
        note: edit.note,
        body: edit.body,
        updatedAt: new Date(),
      })
      .where(scoped(scope, researchSources, eq(researchSources.id, id)))
      .returning({ id: researchSources.id })
    if (updated[0] === undefined) return { ok: false, reason: 'missing' }
    await pruneCollections(tx, scope)
    return { ok: true, id }
  })

/** Delete a source; its clips and their filings cascade. `false` when the id names nothing here. */
export const deleteResearchSource = async (scope: ProjectScope, id: ResearchSourceId): Promise<boolean> =>
  dbOf(scope).transaction(async (tx) => {
    const deleted = await tx
      .delete(researchSources)
      .where(scoped(scope, researchSources, eq(researchSources.id, id)))
      .returning({ id: researchSources.id })
    if (deleted[0] === undefined) return false
    await pruneCollections(tx, scope)
    return true
  })

// ---------------------------------------------------------------------------
// Clips and filings
// ---------------------------------------------------------------------------

/** Cut a clip from a source. `null` when the source is not this project's. */
export const createResearchClip = async (
  scope: ProjectScope,
  sourceId: ResearchSourceId,
  text: string,
): Promise<ResearchClipId | null> => {
  const actor = scope.actor
  if (actor === null) throw new Error('Folio: cutting a clip needs an actor.')
  const db = dbOf(scope)
  const source = await db
    .select({ id: researchSources.id })
    .from(researchSources)
    .where(scoped(scope, researchSources, eq(researchSources.id, sourceId)))
    .limit(1)
  if (source[0] === undefined) return null
  const inserted = await db
    .insert(researchClips)
    .values({ ...tenant(scope), sourceId, text, createdBy: actor })
    .returning({ id: researchClips.id })
  const row = inserted[0]
  if (row === undefined) throw new Error('Folio: inserting a research clip returned no row.')
  return brandClipId(row.id)
}

export const deleteResearchClip = async (scope: ProjectScope, id: ResearchClipId): Promise<boolean> => {
  const deleted = await dbOf(scope)
    .delete(researchClips)
    .where(scoped(scope, researchClips, eq(researchClips.id, id)))
    .returning({ id: researchClips.id })
  return deleted[0] !== undefined
}

export type FilingResult =
  | { readonly ok: true; readonly id: ResearchFilingId }
  /** The clip is not here, or the target is not - a merged location, a heading no longer present, another project's record. */
  | { readonly ok: false; readonly reason: 'clip' | 'target' }
  /** Already filed there. Nothing written. */
  | { readonly ok: false; readonly reason: 'duplicate' }

/**
 * File a clip. The target is checked in this project before the row is
 * written: a character or a live location by id, a scene by a present
 * heading in `scene_derivations`. A second filing to the same place is
 * refused by the partial unique index and reported as such.
 */
export const fileResearchClip = async (
  scope: ProjectScope,
  clipId: ResearchClipId,
  target: ResearchFilingTarget,
): Promise<FilingResult> => {
  const db = dbOf(scope)
  const clip = await db
    .select({ id: researchClips.id })
    .from(researchClips)
    .where(scoped(scope, researchClips, eq(researchClips.id, clipId)))
    .limit(1)
  if (clip[0] === undefined) return { ok: false, reason: 'clip' }

  const present = await targetExists(db, scope, target)
  if (!present) return { ok: false, reason: 'target' }

  const inserted = await db
    .insert(researchClipFilings)
    .values({
      ...tenant(scope),
      clipId,
      kind: target.kind,
      characterId: target.kind === 'character' ? target.characterId : null,
      locationId: target.kind === 'location' ? target.locationId : null,
      sceneNodeId: target.kind === 'scene' ? target.sceneNodeId : null,
    })
    .onConflictDoNothing()
    .returning({ id: researchClipFilings.id })
  const row = inserted[0]
  return row === undefined ? { ok: false, reason: 'duplicate' } : { ok: true, id: brandFilingId(row.id) }
}

const targetExists = async (db: FolioDatabase, scope: ProjectScope, target: ResearchFilingTarget): Promise<boolean> => {
  switch (target.kind) {
    case 'character': {
      const rows = await db
        .select({ id: characters.id })
        .from(characters)
        .where(scoped(scope, characters, eq(characters.id, target.characterId), isNull(characters.mergedInto)))
        .limit(1)
      return rows.length > 0
    }
    case 'location': {
      const rows = await db
        .select({ id: locations.id })
        .from(locations)
        .where(scoped(scope, locations, eq(locations.id, target.locationId), isNull(locations.mergedInto)))
        .limit(1)
      return rows.length > 0
    }
    case 'scene': {
      const rows = await db
        .select({ id: sceneDerivations.sceneNodeId })
        .from(sceneDerivations)
        .where(
          scoped(
            scope,
            sceneDerivations,
            and(eq(sceneDerivations.sceneNodeId, target.sceneNodeId), eq(sceneDerivations.presence, 'present')),
          ),
        )
        .limit(1)
      return rows.length > 0
    }
  }
}

export const unfileResearchClip = async (scope: ProjectScope, id: ResearchFilingId): Promise<boolean> => {
  const deleted = await dbOf(scope)
    .delete(researchClipFilings)
    .where(scoped(scope, researchClipFilings, eq(researchClipFilings.id, id)))
    .returning({ id: researchClipFilings.id })
  return deleted[0] !== undefined
}

/** A clip as the place it is filed to reads it: the line, and the source it came from. */
export type ClipFiledToLocationRow = {
  readonly clipId: ResearchClipId
  readonly locationId: LocationId
  readonly text: string
  readonly sourceId: ResearchSourceId
  readonly sourceTitle: string
}

/**
 * The reverse read the filings table was built to allow: every clip filed
 * to a location, oldest first, with its source's title. The Locations
 * drawer lists them under `Research`; nothing here writes.
 */
export const listClipsFiledToLocations = async (scope: ProjectScope): Promise<readonly ClipFiledToLocationRow[]> => {
  const rows = await dbOf(scope)
    .select({
      clipId: researchClips.id,
      locationId: researchClipFilings.locationId,
      text: researchClips.text,
      sourceId: researchClips.sourceId,
      sourceTitle: researchSources.title,
    })
    .from(researchClipFilings)
    .innerJoin(researchClips, eq(researchClips.id, researchClipFilings.clipId))
    .innerJoin(researchSources, eq(researchSources.id, researchClips.sourceId))
    .where(scoped(scope, researchClipFilings, eq(researchClipFilings.kind, 'location')))
    .orderBy(asc(researchClipFilings.createdAt), asc(researchClipFilings.id))
  return rows.flatMap((row) =>
    row.locationId === null
      ? []
      : [
          {
            clipId: brandClipId(row.clipId),
            locationId: row.locationId as LocationId,
            text: row.text,
            sourceId: brandSourceId(row.sourceId),
            sourceTitle: row.sourceTitle,
          },
        ],
  )
}
