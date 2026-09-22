import type { PropStatus, Timestamp } from '@folio/contracts'
import type { NodeId, PropId } from '@folio/script'
import { propId as brandPropId } from '@folio/script'
import { asc, eq, inArray, sql } from 'drizzle-orm'

import { propAliases, props, reelShots, reels, scenes } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp } from './mapping'

/**
 * The Props route's reads, and every authored write it makes.
 *
 * `locations.ts`'s shape, minus the halves a prop does not have. Every
 * function takes a `ProjectScope` first and every statement goes through
 * `scoped()` / `tenant()`, so tenancy is the compile error `scope.ts`
 * describes rather than a review catch.
 *
 * ## Nothing here reads or writes a derived table, because there is none
 *
 * `props` and `prop_aliases` are both AUTHORED (`schema/props.ts`), and
 * there is no `prop_derivations` to join against: no pass can tell a prop
 * from any other noun, so what the script says about one is read at request
 * time in `apps/web` (`@folio/script`, `props.ts`) over the node list. That
 * is why there is no `listPropTallies` here and no derivation writer to
 * keep away from these tables - a re-derive cannot reach them at all.
 *
 * ## The two Production columns this route is authoritative for
 *
 * `scenes.prop_id` and `reel_shots.prop_id` are foreign keys here since
 * `0030`. `countPropUses` and `listPropShots` read them back, so the drawer
 * can say what a record is already needed for and a delete can be honest
 * about what it clears. Production writes them; this route never does.
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** A prop's authored row. There is no derived half to join. */
export type PropRecordRow = {
  readonly id: PropId
  readonly name: string
  readonly category: string | null
  readonly description: string | null
  readonly status: PropStatus
  /** The photo's object key in storage; the route turns it into a URL. */
  readonly photoKey: string | null
  readonly createdAt: Timestamp
}

/** Every live record - `merged_into IS NULL` - in creation order. */
export const listPropRecords = async (scope: ProjectScope): Promise<readonly PropRecordRow[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(props)
    .where(scoped(scope, props, sql`${props.mergedInto} IS NULL`))
    .orderBy(asc(props.createdAt), asc(props.id))
  return rows.map((row) => ({
    id: brandPropId(row.id),
    name: row.name,
    category: row.category,
    description: row.description,
    status: row.status,
    photoKey: row.photoKey,
    createdAt: stamp(row.createdAt),
  }))
}

/** Where a merged record went, or null when the id is live or unknown. */
export const readPropMergedInto = async (scope: ProjectScope, id: PropId): Promise<PropId | null> => {
  const rows = await dbOf(scope)
    .select({ mergedInto: props.mergedInto })
    .from(props)
    .where(scoped(scope, props, eq(props.id, id)))
    .limit(1)
  const target = rows[0]?.mergedInto ?? null
  return target === null ? null : brandPropId(target)
}

export type PropAliasRow = {
  readonly propId: PropId
  /** The spelling the page uses: `the ball`. */
  readonly alias: string
  /** Who bound it: a user id, or null. Every row here has one - no pass writes this table. */
  readonly boundBy: string | null
}

/** The alias table's authored half, whole, oldest first. */
export const listPropAliases = async (scope: ProjectScope): Promise<readonly PropAliasRow[]> => {
  const rows = await dbOf(scope)
    .select({ propId: propAliases.propId, alias: propAliases.alias, boundBy: propAliases.boundBy })
    .from(propAliases)
    .where(scoped(scope, propAliases))
    .orderBy(asc(propAliases.boundAt))
  return rows.map((row) => ({ propId: brandPropId(row.propId), alias: row.alias, boundBy: row.boundBy }))
}

/** One Production shot that names a prop - the route's authority, read back. */
export type PropShotUse = {
  readonly propId: PropId
  readonly shotId: string
  readonly sceneNodeId: NodeId
  readonly reelName: string
  readonly number: number
}

/**
 * Every live Production shot whose `prop_id` is set, with the reel it is in
 * and the scene the reel is on. One statement for the whole project; the
 * loader groups it by prop.
 */
export const listPropShots = async (scope: ProjectScope): Promise<readonly PropShotUse[]> => {
  const rows = await dbOf(scope)
    .select({
      propId: reelShots.propId,
      shotId: reelShots.id,
      sceneNodeId: reels.sceneNodeId,
      reelName: reels.name,
      number: reelShots.number,
    })
    .from(reelShots)
    .innerJoin(reels, eq(reels.id, reelShots.reelId))
    .where(scoped(scope, reelShots, sql`${reelShots.propId} IS NOT NULL`, sql`${reelShots.deletedAt} IS NULL`))
    .orderBy(asc(reels.sceneNodeId), asc(reelShots.number))
  return rows.flatMap((row) =>
    row.propId === null
      ? []
      : [
          {
            propId: brandPropId(row.propId),
            shotId: row.shotId,
            sceneNodeId: row.sceneNodeId as NodeId,
            reelName: row.reelName,
            number: row.number,
          },
        ],
  )
}

/** How many scene-setup rows name each prop (`scenes.prop_id`). The drawer's second use count. */
export const countPropSceneSetups = async (scope: ProjectScope): Promise<ReadonlyMap<PropId, number>> => {
  const rows = await dbOf(scope)
    .select({ propId: scenes.propId, total: sql<number>`count(*)::int` })
    .from(scenes)
    .where(scoped(scope, scenes, sql`${scenes.propId} IS NOT NULL`))
    .groupBy(scenes.propId)
  return new Map(rows.flatMap((row) => (row.propId === null ? [] : [[brandPropId(row.propId), row.total] as const])))
}

// ---------------------------------------------------------------------------
// Writes - the record
// ---------------------------------------------------------------------------

export const createPropRecord = async (scope: ProjectScope, name: string, category: string | null): Promise<PropId> => {
  const rows = await dbOf(scope)
    .insert(props)
    .values({ ...tenant(scope), name, category })
    .returning({ id: props.id })
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: inserting a prop returned no row.')
  return brandPropId(row.id)
}

export type PropRecordEdit = {
  readonly category?: string | null | undefined
  readonly description?: string | null | undefined
  readonly status?: PropStatus | undefined
}

/**
 * Write the fields present in `edit`, whole. `false` when the record is not
 * here. The conditional spread is the `exactOptionalPropertyTypes` shape:
 * `{ category: undefined }` is not the same as an absent key, and Drizzle
 * would write a null for the first.
 */
export const updatePropRecord = async (scope: ProjectScope, id: PropId, edit: PropRecordEdit): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(props)
    .set({
      ...(edit.category === undefined ? {} : { category: edit.category === '' ? null : edit.category }),
      ...(edit.description === undefined ? {} : { description: edit.description === '' ? null : edit.description }),
      ...(edit.status === undefined ? {} : { status: edit.status }),
      updatedAt: new Date(),
    })
    .where(scoped(scope, props, eq(props.id, id), sql`${props.mergedInto} IS NULL`))
    .returning({ id: props.id })
  return rows.length > 0
}

export type PropRenameOutcome = { readonly status: 'renamed' } | { readonly status: 'missing' }

/**
 * Rename the record, and swap the alias that *is* the old name for the new
 * one, in one statement.
 *
 * Nothing in the script is rewritten. A location rename is a sanctioned
 * write-back because a scene heading contains the set text; a prop's name
 * is written nowhere the app owns, so there is nothing to rewrite and
 * AGENTS.md's "there is no third case" is not touched.
 *
 * Unlike the location rename there is no `taken` outcome: the alias table
 * has no unique index per project (`schema/props.ts`), so two props may
 * both answer to the same spelling and a rename can never collide.
 */
export const renamePropRecord = async (
  scope: ProjectScope,
  id: PropId,
  name: string,
  oldAliases: readonly string[],
  newAlias: string,
): Promise<PropRenameOutcome> => {
  const rows = await dbOf(scope).execute(sql`
    with record as (
      update ${props} set name = ${name}, updated_at = now()
      where ${scoped(scope, props, eq(props.id, id))} and ${props.mergedInto} is null
      returning id
    ),
    dropped as (
      delete from ${propAliases}
      where ${scoped(scope, propAliases, eq(propAliases.propId, id))}
        and ${oldAliases.length === 0 ? sql`false` : inArray(propAliases.alias, oldAliases)}
        and exists (select 1 from record)
      returning alias
    ),
    bound as (
      insert into ${propAliases} (project_id, prop_id, alias, bound_by)
      select ${scope.projectId}, ${id}, ${newAlias}, ${scope.actor}::uuid
      where exists (select 1 from record)
      on conflict do nothing
      returning alias
    )
    select (select count(*)::int from record) as found
  `)
  const row = rows[0] as { readonly found: number } | undefined
  return (row?.found ?? 0) > 0 ? { status: 'renamed' } : { status: 'missing' }
}

/**
 * Point the record at a new photo object, or at none. Returns the key it
 * replaced, so the caller can delete the old object after the row says the
 * new one is the photo - never before. `setLocationPhotoKey`, for a prop.
 */
export const setPropPhotoKey = async (
  scope: ProjectScope,
  id: PropId,
  key: string | null,
): Promise<{ readonly found: boolean; readonly previous: string | null }> => {
  const rows = await dbOf(scope).execute(sql`
    with before as (
      select ${props.photoKey} as previous from ${props}
      where ${scoped(scope, props, eq(props.id, id))} and ${props.mergedInto} is null
    ),
    written as (
      update ${props} set photo_key = ${key}, updated_at = now()
      where ${scoped(scope, props, eq(props.id, id))} and ${props.mergedInto} is null
      returning id
    )
    select (select count(*)::int from written) as found, (select previous from before limit 1) as previous
  `)
  const row = rows[0] as { readonly found: number; readonly previous: string | null } | undefined
  return { found: (row?.found ?? 0) > 0, previous: row?.previous ?? null }
}

/**
 * Merge this record into another. The loser keeps its row as a tombstone
 * (`merged_into`), its aliases move to the winner, and both Production
 * columns that pointed at it are repointed - which is the whole reason the
 * tombstone exists. `characters` and `locations` merge the same way.
 */
export type PropMergeOutcome =
  | { readonly status: 'merged'; readonly into: PropId }
  | { readonly status: 'missing' }
  | { readonly status: 'same' }

export const mergePropRecords = async (scope: ProjectScope, loser: PropId, winner: PropId): Promise<PropMergeOutcome> => {
  if (loser === winner) return { status: 'same' }
  const rows = await dbOf(scope).execute(sql`
    with both as (
      select count(*)::int as n from ${props}
      where ${scoped(scope, props)} and ${props.mergedInto} is null and ${props.id} in (${loser}, ${winner})
    ),
    moved as (
      insert into ${propAliases} (project_id, prop_id, alias, bound_by, bound_at)
      select project_id, ${winner}, alias, bound_by, bound_at from ${propAliases}
      where ${scoped(scope, propAliases, eq(propAliases.propId, loser))} and (select n from both) = 2
      on conflict do nothing
      returning alias
    ),
    gone as (
      delete from ${propAliases}
      where ${scoped(scope, propAliases, eq(propAliases.propId, loser))} and (select n from both) = 2
      returning alias
    ),
    shots as (
      update ${reelShots} set prop_id = ${winner}, updated_at = now()
      where ${scoped(scope, reelShots, eq(reelShots.propId, loser))} and (select n from both) = 2
      returning id
    ),
    setups as (
      update ${scenes} set prop_id = ${winner}, updated_at = now()
      where ${scoped(scope, scenes, eq(scenes.propId, loser))} and (select n from both) = 2
      returning scene_node_id
    ),
    tombstone as (
      update ${props} set merged_into = ${winner}, updated_at = now()
      where ${scoped(scope, props, eq(props.id, loser))} and ${props.mergedInto} is null and (select n from both) = 2
      returning id
    )
    select (select count(*)::int from tombstone) as merged
  `)
  const row = rows[0] as { readonly merged: number } | undefined
  return (row?.merged ?? 0) > 0 ? { status: 'merged', into: winner } : { status: 'missing' }
}

/**
 * Delete a record outright. Unlike a location there is no "still in the
 * script" refusal to make: a prop is not derived, so deleting one cannot be
 * undone by the next pass minting it again. The `set null` on both
 * Production columns clears the field on any shot or scene setup that named
 * it; the cascade takes the aliases. `false` when the record is not here.
 */
export const deletePropRecord = async (scope: ProjectScope, id: PropId): Promise<boolean> => {
  const rows = await dbOf(scope)
    .delete(props)
    .where(scoped(scope, props, eq(props.id, id)))
    .returning({ id: props.id })
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Writes - the alias table
// ---------------------------------------------------------------------------

export type PropBindOutcome = { readonly status: 'bound' } | { readonly status: 'already' } | { readonly status: 'missing' }

/**
 * Bind a spelling to a record. The authored write that makes "the ball"
 * evidence for the Game Ball.
 *
 * There is no `taken` outcome, and that is the one real difference from
 * `bindSlugline`: `prop_aliases` carries no unique index per project, so
 * another record holding the same spelling is not a conflict - both
 * collect the line. `already` is this record holding it twice, which the
 * primary key refuses.
 */
export const bindPropAlias = async (scope: ProjectScope, id: PropId, alias: string): Promise<PropBindOutcome> => {
  const rows = await dbOf(scope).execute(sql`
    with record as (
      select ${props.id} as id from ${props}
      where ${scoped(scope, props, eq(props.id, id))} and ${props.mergedInto} is null
    ),
    bound as (
      insert into ${propAliases} (project_id, prop_id, alias, bound_by)
      select ${scope.projectId}, ${id}, ${alias}, ${scope.actor}::uuid
      where exists (select 1 from record)
      on conflict do nothing
      returning alias
    )
    select (select count(*)::int from record) as record, (select count(*)::int from bound) as bound
  `)
  const row = rows[0] as { readonly record: number; readonly bound: number } | undefined
  if (row === undefined) throw new Error('Folio: binding a prop alias returned no row. This is a bug in the repository.')
  if (row.record === 0) return { status: 'missing' }
  return row.bound > 0 ? { status: 'bound' } : { status: 'already' }
}

/**
 * Unbind a spelling. Refused when it is the record's last, for the reason
 * `unbindSlugline` gives: a record with no alias at all can never collect a
 * line again, and the writer meant to edit the spelling, not to blind the
 * record.
 */
export const unbindPropAlias = async (scope: ProjectScope, id: PropId, alias: string): Promise<'unbound' | 'last' | 'missing'> => {
  const rows = await dbOf(scope).execute(sql`
    with held as (
      select ${propAliases.alias} as alias from ${propAliases}
      where ${scoped(scope, propAliases, eq(propAliases.propId, id))}
    ),
    removed as (
      delete from ${propAliases}
      where ${scoped(scope, propAliases, eq(propAliases.propId, id), eq(propAliases.alias, alias))}
        and (select count(*) from held) > 1
      returning alias
    )
    select
      (select count(*)::int from held) as held,
      exists (select 1 from held where alias = ${alias}) as present,
      (select count(*)::int from removed) as removed
  `)
  const row = rows[0] as { readonly held: number; readonly present: boolean; readonly removed: number } | undefined
  if (row === undefined) throw new Error('Folio: unbinding a prop alias returned no row. This is a bug in the repository.')
  if (!row.present) return 'missing'
  if (row.removed === 0) return 'last'
  return 'unbound'
}
