import type { LocationStatus, Timestamp } from '@folio/contracts'
import type { LocationId, NodeId, Presence, ScreenplayNode, ScriptFormat } from '@folio/script'
import { locationId as brandLocationId } from '@folio/script'
import { asc, eq, inArray, sql } from 'drizzle-orm'

import {
  documents,
  locationBoundSluglines,
  locationDerivations,
  locationSluglineTallies,
  locations,
  measurementScenes,
  measurements,
  nodes,
  resolveRows,
  scenes,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { jsonb } from '../sql-json'
import { stamp } from './mapping'

/**
 * The Locations route's reads, and every authored write it makes.
 *
 * The same split `characters.ts` describes, from the location side.
 * `locations` and `location_bound_sluglines` are AUTHORED
 * (`schema/derived.ts`); the route reads them beside the DERIVED
 * CACHE rows - `location_derivations`, `location_slugline_tallies`,
 * `scene_derivations`, `resolve_rows` - and joins by id in `apps/web`.
 * Nothing here writes a derived table.
 *
 * ## The tree is authored here, by a person
 *
 * AGENTS.md, Entity identity: "A location is a **tree, not a list**." The
 * pure core's ruling is that the *records* come from the headings and the
 * *edges* are drawn by a human, so `parent_id` is written by exactly two
 * things: the writer choosing a parent on the record (`setLocationParent`),
 * and the writer accepting a structure proposal in the queue - which is the
 * same function called from the resolve view. A derivation pass proposes an
 * edge and never writes one.
 *
 * ## A rename is two writes and a diff
 *
 * `renameLocationRecord` swaps the name and the name's bound slugline in one
 * statement; `rewriteHeadingNodes` writes the rewritten Scene nodes the pure
 * core's `renameLocationHeadings` produced, across every document, in one
 * statement. The route sequences them with a `before_rename` version per
 * document between, exactly as the character rename does - AGENTS.md's
 * exception table: "Same - explicit, diffed, undoable in one step".
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** A record's authored row beside its derived row. The join the route reads. */
export type LocationRecordRow = {
  readonly id: LocationId
  readonly name: string
  readonly parentId: LocationId | null
  readonly scheduledDays: number
  readonly description: string | null
  readonly status: LocationStatus
  readonly address: string | null
  /** The photo's object key in storage; the route turns it into a URL. */
  readonly photoKey: string | null
  readonly createdAt: Timestamp
  /** Null until the first derivation pass after the record was made by hand. */
  readonly derived: {
    readonly depth: number
    readonly presence: Presence
    readonly own: LocationCountsRow
    readonly rollup: LocationCountsRow
    readonly scenes: readonly NodeId[]
  } | null
}

export type LocationCountsRow = {
  readonly scenes: number
  readonly sluglines: number
  readonly dayScenes: number
  readonly nightScenes: number
  readonly shootingDays: number
}

/**
 * Every live record - `merged_into IS NULL` - in creation order, with its
 * derived row where one exists. A LEFT JOIN, for the reason the character
 * list is one: a record made by hand has no derived row until the next pass.
 */
export const listLocationRecords = async (
  scope: ProjectScope,
): Promise<readonly LocationRecordRow[]> => {
  const rows = await dbOf(scope)
    .select({ record: locations, derived: locationDerivations })
    .from(locations)
    .leftJoin(locationDerivations, eq(locationDerivations.locationId, locations.id))
    .where(scoped(scope, locations, sql`${locations.mergedInto} IS NULL`))
    .orderBy(asc(locations.createdAt), asc(locations.id))
  return rows.map(({ record, derived }) => ({
    id: brandLocationId(record.id),
    name: record.name,
    parentId: record.parentId === null ? null : brandLocationId(record.parentId),
    scheduledDays: record.scheduledDays,
    description: record.description,
    status: record.status,
    address: record.address,
    photoKey: record.photoKey,
    createdAt: stamp(record.createdAt),
    derived:
      derived === null
        ? null
        : {
            depth: derived.depth,
            presence: derived.presence,
            own: {
              scenes: derived.ownScenes,
              sluglines: derived.ownSluglines,
              dayScenes: derived.ownDayScenes,
              nightScenes: derived.ownNightScenes,
              shootingDays: derived.ownShootingDays,
            },
            rollup: {
              scenes: derived.rollupScenes,
              sluglines: derived.rollupSluglines,
              dayScenes: derived.rollupDayScenes,
              nightScenes: derived.rollupNightScenes,
              shootingDays: derived.rollupShootingDays,
            },
            scenes: derived.scenes as NodeId[],
          },
  }))
}

/** Where a merged record went, or null when the id is live or unknown. */
export const readLocationMergedInto = async (
  scope: ProjectScope,
  id: LocationId,
): Promise<LocationId | null> => {
  const rows = await dbOf(scope)
    .select({ mergedInto: locations.mergedInto })
    .from(locations)
    .where(scoped(scope, locations, eq(locations.id, id)))
    .limit(1)
  const target = rows[0]?.mergedInto ?? null
  return target === null ? null : brandLocationId(target)
}

export type SluglineTallyRow = {
  readonly locationId: LocationId
  /** The heading as authored: `INT. CHAWL CORRIDOR - DAY`. */
  readonly slugline: string
  /** The set's canonical key. What matching compares. */
  readonly key: string
  readonly occurrences: number
}

/** The counted headings of every record. DERIVED. */
export const listSluglineTallies = async (
  scope: ProjectScope,
): Promise<readonly SluglineTallyRow[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(locationSluglineTallies)
    .where(scoped(scope, locationSluglineTallies))
  return rows.map((row) => ({
    locationId: brandLocationId(row.locationId),
    slugline: row.slugline,
    key: row.key,
    occurrences: row.occurrences,
  }))
}

export type BoundSluglineRow = {
  readonly locationId: LocationId
  /** The set text, as the writer would type it after `INT.`. */
  readonly slugline: string
  /** Who bound it: a user id, or null when a derivation pass did. The drawer's provenance column. */
  readonly boundBy: string | null
}

/** The alias table's authored half, whole. AUTHORED. */
export const listBoundSluglines = async (
  scope: ProjectScope,
): Promise<readonly BoundSluglineRow[]> => {
  const rows = await dbOf(scope)
    .select({
      locationId: locationBoundSluglines.locationId,
      slugline: locationBoundSluglines.slugline,
      boundBy: locationBoundSluglines.boundBy,
    })
    .from(locationBoundSluglines)
    .where(scoped(scope, locationBoundSluglines))
    .orderBy(asc(locationBoundSluglines.boundAt))
  return rows.map((row) => ({ locationId: brandLocationId(row.locationId), slugline: row.slugline, boundBy: row.boundBy }))
}

/** The Timeline's authored story time per heading node, where the writer set any of it. */
export type SceneStoryTimeRow = {
  readonly storyDay: number | null
  readonly storyClock: string | null
  readonly flashback: boolean
}

/**
 * Story day, clock and the flashback flag per scene (`scenes.story_day` and
 * its neighbours, migration `0011`) - the continuity facts a location's
 * scene list prints beside the heading. Rows with none of the three set
 * are left out; the route prints nothing for them.
 */
export const listSceneStoryTime = async (scope: ProjectScope): Promise<ReadonlyMap<NodeId, SceneStoryTimeRow>> => {
  const rows = await dbOf(scope)
    .select({
      sceneNodeId: scenes.sceneNodeId,
      storyDay: scenes.storyDay,
      storyClock: scenes.storyClock,
      flashback: scenes.flashback,
    })
    .from(scenes)
    .where(
      scoped(
        scope,
        scenes,
        sql`(${scenes.storyDay} IS NOT NULL OR ${scenes.storyClock} IS NOT NULL OR ${scenes.flashback})`,
      ),
    )
  return new Map(
    rows.map((row) => [row.sceneNodeId as NodeId, { storyDay: row.storyDay, storyClock: row.storyClock, flashback: row.flashback }]),
  )
}

/** An open resolve-queue row for a slugline or a structure edge, as stored. */
export type OpenLocationRow = {
  readonly key: string
  readonly subjectKind: 'slugline' | 'structure'
  readonly subject: unknown
  readonly occurrences: number
  readonly scenes: readonly NodeId[]
  readonly proposalTarget: unknown
  readonly proposalConfidence: 'certain' | 'likely' | 'possible' | null
}

/**
 * Every open row the location side answers: a slugline pointing at no
 * record, and a record whose name reads like a sub-set of another. Both
 * kinds in one read because the resolve view lists both.
 */
export const listOpenLocationRows = async (scope: ProjectScope): Promise<readonly OpenLocationRow[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(resolveRows)
    .where(
      scoped(
        scope,
        resolveRows,
        inArray(resolveRows.subjectKind, ['slugline', 'structure']),
        eq(resolveRows.state, 'open'),
      ),
    )
    .orderBy(asc(resolveRows.key))
  return rows.flatMap((row) =>
    row.subjectKind === 'cue'
      ? []
      : [
          {
            key: row.key,
            subjectKind: row.subjectKind,
            subject: row.subject,
            occurrences: row.occurrences,
            scenes: row.scenes as NodeId[],
            proposalTarget: row.proposalTarget,
            proposalConfidence: row.proposalConfidence,
          },
        ],
  )
}

/**
 * Eighths per scene across the whole project, from each episode's screenplay
 * measurement at this format in `paged` mode - the same row the episode
 * board and the project card count from (`workspace.ts`, "one measurement,
 * chosen the same way everywhere"). A scene with no measured row is absent
 * from the map, and the route prints `—` for it: a page count either
 * exists or does not. Nothing here paginates.
 */
export const listSceneEighths = async (
  scope: ProjectScope,
  format: ScriptFormat,
): Promise<ReadonlyMap<NodeId, number>> => {
  const rows = await dbOf(scope)
    .select({ sceneNodeId: measurementScenes.sceneNodeId, eighths: measurementScenes.eighths })
    .from(measurementScenes)
    .innerJoin(measurements, eq(measurements.id, measurementScenes.measurementId))
    .innerJoin(documents, eq(documents.id, measurements.documentId))
    .where(
      scoped(
        scope,
        measurementScenes,
        eq(documents.kind, 'screenplay'),
        eq(measurements.format, format),
        eq(measurements.pageMode, 'paged'),
      ),
    )
  return new Map(rows.map((row) => [row.sceneNodeId as NodeId, row.eighths]))
}

/** Every authored synopsis, by heading node. The gist under a slugline on the record view. */
export const listSceneSynopses = async (scope: ProjectScope): Promise<ReadonlyMap<NodeId, string>> => {
  const rows = await dbOf(scope)
    .select({ sceneNodeId: scenes.sceneNodeId, synopsis: scenes.synopsis })
    .from(scenes)
    .where(scoped(scope, scenes, sql`${scenes.synopsis} IS NOT NULL`))
  return new Map(
    rows.flatMap((row) => (row.synopsis === null ? [] : [[row.sceneNodeId as NodeId, row.synopsis] as const])),
  )
}

// ---------------------------------------------------------------------------
// Writes - the record
// ---------------------------------------------------------------------------

export const createLocationRecord = async (
  scope: ProjectScope,
  name: string,
  parentId: LocationId | null,
): Promise<LocationId> => {
  const rows = await dbOf(scope)
    .insert(locations)
    .values({ ...tenant(scope), name, parentId })
    .returning({ id: locations.id })
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: inserting a location returned no row.')
  return brandLocationId(row.id)
}

export type LocationRecordEdit = {
  readonly description?: string | null | undefined
  readonly address?: string | null | undefined
  readonly status?: LocationStatus | undefined
  /** Shooting days at this set alone. The roll-up is the next pass's. */
  readonly scheduledDays?: number | undefined
}

/** Write the fields present in `edit`, whole. `false` when the record is not here. */
export const updateLocationRecord = async (
  scope: ProjectScope,
  id: LocationId,
  edit: LocationRecordEdit,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(locations)
    .set({
      ...(edit.description === undefined ? {} : { description: edit.description === '' ? null : edit.description }),
      ...(edit.address === undefined ? {} : { address: edit.address === '' ? null : edit.address }),
      ...(edit.status === undefined ? {} : { status: edit.status }),
      ...(edit.scheduledDays === undefined ? {} : { scheduledDays: edit.scheduledDays }),
      updatedAt: new Date(),
    })
    .where(scoped(scope, locations, eq(locations.id, id), sql`${locations.mergedInto} IS NULL`))
    .returning({ id: locations.id })
  return rows.length > 0
}

/**
 * Point the record at a new photo object, or at none. Returns the key it
 * replaced, so the caller can delete the old object after the row says the
 * new one is the photo - never before. `setPortraitKey`, for a location.
 */
export const setLocationPhotoKey = async (
  scope: ProjectScope,
  id: LocationId,
  key: string | null,
): Promise<{ readonly found: boolean; readonly previous: string | null }> => {
  const rows = await dbOf(scope).execute(sql`
    with before as (
      select ${locations.photoKey} as previous from ${locations}
      where ${scoped(scope, locations, eq(locations.id, id))} and ${locations.mergedInto} is null
    ),
    written as (
      update ${locations} set photo_key = ${key}, updated_at = now()
      where ${scoped(scope, locations, eq(locations.id, id))} and ${locations.mergedInto} is null
      returning id
    )
    select (select count(*)::int from written) as found, (select previous from before limit 1) as previous
  `)
  const row = rows[0] as { readonly found: number; readonly previous: string | null } | undefined
  return { found: (row?.found ?? 0) > 0, previous: row?.previous ?? null }
}

/**
 * Hang a record under another, or make it a primary set (`null`). The one
 * authored write to the tree. A cycle is the caller's to refuse - it has the
 * records in hand and the walk is trivial there - and if one slipped through,
 * `derive` reports it and rolls the record up as a root rather than failing.
 * The parent must be a live record in this project, checked in the statement.
 */
export const setLocationParent = async (
  scope: ProjectScope,
  id: LocationId,
  parentId: LocationId | null,
): Promise<boolean> => {
  const rows = await dbOf(scope).execute(sql`
    update ${locations} set parent_id = ${parentId}::uuid, updated_at = now()
    where ${scoped(scope, locations, eq(locations.id, id))}
      and ${locations.mergedInto} is null
      and (${parentId}::uuid is null or exists (
        select 1 from ${locations} p
        where p.project_id = ${scope.projectId} and p.id = ${parentId}::uuid and p.merged_into is null
      ))
    returning id
  `)
  return rows.length > 0
}

export type LocationRenameOutcome =
  | { readonly status: 'renamed' }
  | { readonly status: 'missing' }
  /** The new spelling is already bound to another record. Merge, do not rename. */
  | { readonly status: 'taken'; readonly by: LocationId }

/**
 * The authored half of a rename: the name, and the name's row in the alias
 * table. One statement, gated on the new spelling being free. The mirror of
 * `renameCharacterRecord`; see it for the reasoning on `oldSluglines`.
 */
export const renameLocationRecord = async (
  scope: ProjectScope,
  id: LocationId,
  name: string,
  oldSluglines: readonly string[],
  newSlugline: string,
): Promise<LocationRenameOutcome> => {
  const rows = await dbOf(scope).execute(sql`
    with taken as (
      select ${locationBoundSluglines.locationId} as location_id from ${locationBoundSluglines}
      where ${scoped(scope, locationBoundSluglines, eq(locationBoundSluglines.slugline, newSlugline))}
        and ${locationBoundSluglines.locationId} <> ${id}
    ),
    ok as (select not exists (select 1 from taken) as ok),
    named as (
      update ${locations} set name = ${name}, updated_at = now()
      where ${scoped(scope, locations, eq(locations.id, id))}
        and ${locations.mergedInto} is null
        and (select ok from ok)
      returning id
    ),
    unbound as (
      delete from ${locationBoundSluglines}
      where ${scoped(scope, locationBoundSluglines, eq(locationBoundSluglines.locationId, id))}
        and ${locationBoundSluglines.slugline} = any(${sql.param([...oldSluglines])}::text[])
        and ${locationBoundSluglines.slugline} <> ${newSlugline}
        and (select ok from ok)
        and exists (select 1 from named)
      returning slugline
    ),
    bound as (
      insert into ${locationBoundSluglines} (project_id, location_id, slugline, bound_by)
      select ${scope.projectId}, ${id}, ${newSlugline}, ${scope.actor}::uuid
      where (select ok from ok) and exists (select 1 from named)
      on conflict (location_id, slugline) do nothing
      returning slugline
    )
    select
      (select location_id from taken limit 1) as taken_by,
      (select count(*)::int from named) as renamed,
      (select count(*)::int from unbound) + (select count(*)::int from bound) as rebound
  `)
  const row = rows[0] as
    | { readonly taken_by: string | null; readonly renamed: number; readonly rebound: number }
    | undefined
  if (row === undefined) throw new Error('Folio: the rename returned no row. This is a bug in the repository.')
  if (row.taken_by !== null) return { status: 'taken', by: brandLocationId(row.taken_by) }
  if (row.renamed === 0) return { status: 'missing' }
  return { status: 'renamed' }
}

export type HeadingNodeRewrite = {
  readonly id: NodeId
  readonly content: ScreenplayNode['content']
}

/**
 * Write rewritten Scene nodes across every document, in one statement, and
 * stamp each document touched. The rows come from `renameLocationHeadings`;
 * only `content` changes, so ids, order, type and provenance are untouched
 * and every anchor pointing at a rewritten heading - a scene record, a
 * synopsis, a shot list, an arc turn - still points at it.
 */
export const rewriteHeadingNodes = async (
  scope: ProjectScope,
  rewrites: readonly HeadingNodeRewrite[],
): Promise<number> => {
  if (rewrites.length === 0) return 0
  const rows = await dbOf(scope).execute(sql`
    with rewritten as (
      update ${nodes} set content = r.content, updated_at = now()
      from jsonb_to_recordset(${jsonb(rewrites.map((entry) => ({ id: entry.id, content: entry.content })))})
        as r(id uuid, content jsonb)
      where ${scoped(scope, nodes, eq(nodes.type, 'scene'))}
        and ${nodes.id} = r.id
      returning ${nodes.documentId} as document_id
    ),
    stamped as (
      update ${documents} set updated_at = now()
      where ${scoped(scope, documents)}
        and ${documents.id} in (select document_id from rewritten)
      returning id
    )
    select (select count(*)::int from rewritten) as rewritten
  `)
  const row = rows[0] as { readonly rewritten: number } | undefined
  return row?.rewritten ?? 0
}

// ---------------------------------------------------------------------------
// Writes - the alias table
// ---------------------------------------------------------------------------

export type LocationBindOutcome =
  | { readonly status: 'bound' }
  | { readonly status: 'already' }
  | { readonly status: 'taken'; readonly by: LocationId }
  | { readonly status: 'missing' }

/**
 * Bind a set text to a record. The authored write that makes `THE CHAWL`
 * and `KAMATHI CHAWL` one place; the unique index on `(project_id,
 * slugline)` refuses a set somebody else already holds.
 */
export const bindSlugline = async (
  scope: ProjectScope,
  id: LocationId,
  slugline: string,
): Promise<LocationBindOutcome> => {
  const rows = await dbOf(scope).execute(sql`
    with holder as (
      select ${locationBoundSluglines.locationId} as location_id from ${locationBoundSluglines}
      where ${scoped(scope, locationBoundSluglines, eq(locationBoundSluglines.slugline, slugline))}
    ),
    record as (
      select ${locations.id} as id from ${locations}
      where ${scoped(scope, locations, eq(locations.id, id))} and ${locations.mergedInto} is null
    ),
    bound as (
      insert into ${locationBoundSluglines} (project_id, location_id, slugline, bound_by)
      select ${scope.projectId}, ${id}, ${slugline}, ${scope.actor}::uuid
      where not exists (select 1 from holder) and exists (select 1 from record)
      on conflict do nothing
      returning slugline
    )
    select
      (select location_id from holder limit 1) as holder,
      (select count(*)::int from record) as record,
      (select count(*)::int from bound) as bound
  `)
  const row = rows[0] as
    | { readonly holder: string | null; readonly record: number; readonly bound: number }
    | undefined
  if (row === undefined) throw new Error('Folio: binding a slugline returned no row. This is a bug in the repository.')
  if (row.holder !== null) {
    return row.holder === (id as string) ? { status: 'already' } : { status: 'taken', by: brandLocationId(row.holder) }
  }
  if (row.record === 0) return { status: 'missing' }
  return { status: 'bound' }
}

/** Unbind a set text. Refused when it is the record's last, for the reason `unbindCue` gives. */
export const unbindSlugline = async (
  scope: ProjectScope,
  id: LocationId,
  slugline: string,
): Promise<'unbound' | 'last' | 'missing'> => {
  const rows = await dbOf(scope).execute(sql`
    with held as (
      select ${locationBoundSluglines.slugline} as slugline from ${locationBoundSluglines}
      where ${scoped(scope, locationBoundSluglines, eq(locationBoundSluglines.locationId, id))}
    ),
    removed as (
      delete from ${locationBoundSluglines}
      where ${scoped(scope, locationBoundSluglines, eq(locationBoundSluglines.locationId, id), eq(locationBoundSluglines.slugline, slugline))}
        and (select count(*) from held) > 1
      returning slugline
    )
    select
      (select count(*)::int from held) as held,
      exists (select 1 from held where slugline = ${slugline}) as present,
      (select count(*)::int from removed) as removed
  `)
  const row = rows[0] as
    | { readonly held: number; readonly present: boolean; readonly removed: number }
    | undefined
  if (row === undefined) throw new Error('Folio: unbinding a slugline returned no row. This is a bug in the repository.')
  if (!row.present) return 'missing'
  if (row.removed === 0) return 'last'
  return 'unbound'
}

export type MoveSluglineOutcome =
  | { readonly status: 'moved'; readonly from: LocationId | null }
  /** Already bound to `toId`. Nothing to do. */
  | { readonly status: 'already' }
  /** The holder's last set text; moving it would leave that record with none. */
  | { readonly status: 'last'; readonly by: LocationId }
  | { readonly status: 'missing' }

/**
 * Move a set text from whichever record holds it to `toId` - the alias
 * table's `Move it here`, when a bind is refused as `taken`, and the
 * queue's answer when a heading was matched to the wrong place. One
 * statement rather than an unbind and a bind, for the reason `moveBoundCue`
 * gives: between two statements the set text would be bound nowhere. The
 * holder keeps it when it is their last (the `unbindSlugline` rule). A set
 * text nobody holds is simply bound.
 */
export const moveBoundSlugline = async (
  scope: ProjectScope,
  slugline: string,
  toId: LocationId,
): Promise<MoveSluglineOutcome> => {
  const rows = await dbOf(scope).execute(sql`
    with holder as (
      select ${locationBoundSluglines.locationId} as location_id from ${locationBoundSluglines}
      where ${scoped(scope, locationBoundSluglines, eq(locationBoundSluglines.slugline, slugline))}
    ),
    held as (
      select count(*)::int as n from ${locationBoundSluglines}
      where ${scoped(scope, locationBoundSluglines)}
        and ${locationBoundSluglines.locationId} = (select location_id from holder limit 1)
    ),
    target as (
      select ${locations.id} as id from ${locations}
      where ${scoped(scope, locations, eq(locations.id, toId))} and ${locations.mergedInto} is null
    ),
    removed as (
      delete from ${locationBoundSluglines}
      where ${scoped(scope, locationBoundSluglines, eq(locationBoundSluglines.slugline, slugline))}
        and ${locationBoundSluglines.locationId} <> ${toId}
        and (select n from held) > 1
        and exists (select 1 from target)
      returning slugline
    ),
    bound as (
      insert into ${locationBoundSluglines} (project_id, location_id, slugline, bound_by)
      select ${scope.projectId}, ${toId}, ${slugline}, ${scope.actor}::uuid
      where exists (select 1 from target)
        and (not exists (select 1 from holder) or exists (select 1 from removed))
      on conflict do nothing
      returning slugline
    )
    select
      (select location_id from holder limit 1) as holder,
      coalesce((select n from held), 0) as held,
      (select count(*)::int from target) as target,
      (select count(*)::int from removed) as removed,
      (select count(*)::int from bound) as bound
  `)
  const row = rows[0] as
    | {
        readonly holder: string | null
        readonly held: number
        readonly target: number
        readonly removed: number
        readonly bound: number
      }
    | undefined
  if (row === undefined) throw new Error('Folio: moving a slugline returned no row. This is a bug in the repository.')
  if (row.target === 0) return { status: 'missing' }
  if (row.holder === (toId as string)) return { status: 'already' }
  if (row.holder !== null && row.removed === 0) return { status: 'last', by: brandLocationId(row.holder) }
  if (row.bound === 0) return { status: 'missing' }
  return { status: 'moved', from: row.holder === null ? null : brandLocationId(row.holder) }
}

// ---------------------------------------------------------------------------
// Writes - merge, delete
// ---------------------------------------------------------------------------

/**
 * Merge `loser` into `winner`: the writer's decision that two records were
 * one place. One statement. The loser's bound sluglines move to the
 * winner; the loser's children hang off the winner; and if the winner
 * itself hung off the loser it takes the loser's parent, so no cycle is
 * written. The loser keeps its row with `merged_into` set, its parent
 * cleared. `false` when either record is not live here.
 */
export const mergeLocationRecords = async (
  scope: ProjectScope,
  loser: LocationId,
  winner: LocationId,
): Promise<boolean> => {
  if ((loser as string) === (winner as string)) return false
  const rows = await dbOf(scope).execute(sql`
    with pair as (
      select count(*)::int as n from ${locations}
      where ${scoped(scope, locations)}
        and ${locations.id} in (${loser}, ${winner})
        and ${locations.mergedInto} is null
    ),
    ok as (select (select n from pair) = 2 as ok),
    loser_parent as (
      select parent_id from ${locations}
      where ${scoped(scope, locations, eq(locations.id, loser))}
    ),
    sluglines as (
      update ${locationBoundSluglines} set location_id = ${winner}
      where ${scoped(scope, locationBoundSluglines, eq(locationBoundSluglines.locationId, loser))}
        and (select ok from ok)
      returning slugline
    ),
    winner_unhooked as (
      update ${locations} set parent_id = (select parent_id from loser_parent), updated_at = now()
      where ${scoped(scope, locations, eq(locations.id, winner))}
        and ${locations.parentId} = ${loser}
        and (select ok from ok)
      returning id
    ),
    children as (
      update ${locations} set parent_id = ${winner}, updated_at = now()
      where ${scoped(scope, locations, eq(locations.parentId, loser))}
        and ${locations.id} <> ${winner}
        and (select ok from ok)
      returning id
    ),
    merged as (
      update ${locations} set merged_into = ${winner}, parent_id = null, updated_at = now()
      where ${scoped(scope, locations, eq(locations.id, loser))} and (select ok from ok)
      returning id
    )
    select (select count(*)::int from merged) as merged
  `)
  const row = rows[0] as { readonly merged: number } | undefined
  return (row?.merged ?? 0) > 0
}

/**
 * Delete a record the script no longer holds. Refused - `present` - while
 * it is: a record deleted under a live slugline would be minted again on the
 * next pass. Its children hang off its parent afterwards, so the tree keeps
 * its shape; the cascades take the bound sluglines and derived rows.
 */
export const deleteAbsentLocation = async (
  scope: ProjectScope,
  id: LocationId,
): Promise<'deleted' | 'present' | 'missing'> => {
  const rows = await dbOf(scope).execute(sql`
    with record as (
      select ${locations.id} as id, ${locations.parentId} as parent_id,
        exists (select 1 from ${locationDerivations} d
          where d.project_id = ${scope.projectId} and d.location_id = ${locations.id} and d.presence = 'present') as present
      from ${locations}
      where ${scoped(scope, locations, eq(locations.id, id))} and ${locations.mergedInto} is null
    ),
    children as (
      update ${locations} set parent_id = (select parent_id from record), updated_at = now()
      where ${scoped(scope, locations, eq(locations.parentId, id))}
        and exists (select 1 from record where not present)
      returning id
    ),
    gone as (
      delete from ${locations}
      where ${scoped(scope, locations, eq(locations.id, id))}
        and exists (select 1 from record where not present)
      returning id
    )
    select (select count(*)::int from record) as found,
      coalesce((select present from record limit 1), false) as present,
      (select count(*)::int from gone) as deleted
  `)
  const row = rows[0] as
    | { readonly found: number; readonly present: boolean; readonly deleted: number }
    | undefined
  if (row === undefined || row.found === 0) return 'missing'
  if (row.present) return 'present'
  return 'deleted'
}

/**
 * Delete a record the writer has not written on yet, present in the script
 * or not - the eight-second undo of a `New location` queue decision, whose
 * minted record *is* present the moment the heading resolves to it, so
 * `deleteAbsentLocation` would refuse. `kept` when there is something on
 * it (a description, an address, a photo, a status past pending, shooting
 * days, a sub-set, or more than one bound set text): the caller unbinds the
 * set text instead, so the heading is asked about again and nothing
 * authored is lost. The cascades take the binding and the derived rows.
 */
export const deleteBlankLocation = async (
  scope: ProjectScope,
  id: LocationId,
): Promise<'deleted' | 'kept' | 'missing'> => {
  const rows = await dbOf(scope).execute(sql`
    with record as (
      select ${locations.id} as id,
        (${locations.description} is null
          and ${locations.address} is null
          and ${locations.photoKey} is null
          and ${locations.status} = 'pending'
          and ${locations.scheduledDays} = 0
          and not exists (select 1 from ${locations} c where c.project_id = ${scope.projectId} and c.parent_id = ${locations.id} and c.merged_into is null)
          and (select count(*) from ${locationBoundSluglines} b where b.project_id = ${scope.projectId} and b.location_id = ${locations.id}) <= 1
        ) as blank
      from ${locations}
      where ${scoped(scope, locations, eq(locations.id, id))} and ${locations.mergedInto} is null
    ),
    gone as (
      delete from ${locations}
      where ${scoped(scope, locations, eq(locations.id, id))}
        and exists (select 1 from record where blank)
      returning id
    )
    select (select count(*)::int from record) as found,
      coalesce((select blank from record limit 1), false) as blank,
      (select count(*)::int from gone) as deleted
  `)
  const row = rows[0] as { readonly found: number; readonly blank: boolean; readonly deleted: number } | undefined
  if (row === undefined || row.found === 0) return 'missing'
  return row.deleted > 0 ? 'deleted' : 'kept'
}
