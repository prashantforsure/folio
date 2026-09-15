import type {
  ClipSeconds,
  ClipState,
  EpisodeId,
  GenerationId,
  Job,
  JobId,
  LedgerEntryId,
  OrderKey,
  ProductionScene,
  ProductionShot,
  Reel,
  ReelEdit,
  ReelId,
  ReelRenderId,
  ReelRow,
  ShotId,
  Take,
} from '@folio/contracts'
import { projectId as brandProjectId } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { shotLabel } from '@folio/script'
import { asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { between, byOrderKey } from '../order'
import {
  creditLedger,
  documents,
  frameGenerations,
  jobs,
  nodes,
  reelRenders,
  reels,
  sceneDerivations,
  shots,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp, stampOrNull } from './mapping'
import {
  byFramePrecedence,
  frameStateOf,
  jobFromRow,
  listStoryboardScenes,
  readSceneHeader,
  shotFromRow,
} from './storyboard'
import type { StoryboardSceneHeader } from './storyboard'

/**
 * Production's rows: reels over the Storyboard's shots, the takes a shot
 * keeps, and the job that renders a reel's clip.
 *
 * ## What is read, and from where
 *
 * The same scene chain the board walks (`listStoryboardScenes`), then for
 * those scenes: their `reels` in `order_key` order, their `shots` in the
 * scene's own `order_key` order, **every** `frame_generations` row of those
 * shots with its job (the takes, kept first then newest - `byFramePrecedence`,
 * so the first take is the frame the Storyboard shows too), and the latest
 * `reel_renders` row per reel with its job, folded into a `ClipState`. Five
 * statements for the whole episode, whatever its size. The shot's number is
 * computed over the scene's whole list, so both routes print the same
 * `01-03`; the reel's number is its place among the scene's reels. Nothing
 * else is computed here - a reel's *status* is the web layer's pure fold
 * (`apps/web/lib/production/status.ts`) over what this file returns.
 *
 * ## Reserve then execute, in one statement, for N
 *
 * `queueFrameGenerations` is `storyboard.ts`'s `queueFrameGeneration` for a
 * reel's worth of shots at once: N job rows, N `reserve` entries, N
 * generation rows, all conditioned on the balance covering `cost × N` and
 * on every named shot being an accepted shot of this reel with the reel not
 * finalized. Short by one credit, nothing is written. `queueReelRender` is
 * the same shape for one job of kind `reel_render`, conditioned on the reel
 * being finalized and no render of it already queued or running. The race
 * `storyboard.ts` flags - two clicks on the last credits under READ
 * COMMITTED - is the same race here, and flagged the same way.
 *
 * ## The kept take is two commands, on purpose
 *
 * `keepGeneration` clears the shot's previous kept row and sets the new one.
 * The partial unique index (`frame_generations_kept_key`) is checked as
 * each row is written, and a row updated by the *same command* still counts
 * as live to that check, so clearing and setting in one statement can
 * refuse the set. Two commands in one transaction; the transaction pooler
 * carries a transaction fine (`documents.ts` and `history.ts` do the same).
 */

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

type ReelRowShape = typeof reels.$inferSelect
type ShotRowShape = typeof shots.$inferSelect

const reelFromRow = (row: ReelRowShape): Reel => ({
  id: row.id as ReelId,
  projectId: brandProjectId(row.projectId),
  sceneNodeId: row.sceneNodeId as NodeId,
  orderKey: row.orderKey as OrderKey,
  name: row.name,
  clipSeconds: row.clipSeconds as ClipSeconds,
  finalizedAt: stampOrNull(row.finalizedAt),
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

/** The seven clip states, from the latest render and its job. `frameStateOf` for a reel. */
export const clipStateOf = (
  render: { readonly clipUrl: string | null; readonly refundEntryId: string | null } | null,
  job: Job | null,
): ClipState => {
  if (render === null || job === null) return { kind: 'none' }
  switch (job.status) {
    case 'queued':
      return { kind: 'queued', jobId: job.id, cost: job.cost }
    case 'running':
      return { kind: 'running', jobId: job.id, cost: job.cost }
    case 'finished':
      return render.clipUrl === null
        ? { kind: 'failed', jobId: job.id, error: 'The job finished without a clip.', refunded: false }
        : { kind: 'rendered', jobId: job.id, url: render.clipUrl }
    case 'failed':
      return { kind: 'failed', jobId: job.id, error: job.error, refunded: render.refundEntryId !== null }
    case 'blocked':
      return { kind: 'blocked', jobId: job.id, reason: job.blockedReason ?? 'Refused, with no reason recorded.' }
    case 'cancelled':
      return { kind: 'cancelled', jobId: job.id }
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every generation of every shot named, with its job, as takes - kept first, then newest. One statement. */
const readTakes = async (
  scope: ProjectScope,
  shotIds: readonly ShotId[],
): Promise<ReadonlyMap<ShotId, readonly Take[]>> => {
  if (shotIds.length === 0) return new Map()
  const rows = await dbOf(scope)
    .select({
      id: frameGenerations.id,
      shotId: frameGenerations.shotId,
      frameUrl: frameGenerations.frameUrl,
      refundEntryId: frameGenerations.refundEntryId,
      keptAt: frameGenerations.keptAt,
      createdAt: frameGenerations.createdAt,
      job: jobs,
    })
    .from(frameGenerations)
    .innerJoin(jobs, eq(jobs.id, frameGenerations.jobId))
    .where(scoped(scope, frameGenerations, inArray(frameGenerations.shotId, [...shotIds])))
    .orderBy(asc(frameGenerations.shotId), ...byFramePrecedence())
  const takes = new Map<ShotId, Take[]>()
  for (const row of rows) {
    const shotId = row.shotId as ShotId
    const list = takes.get(shotId) ?? []
    list.push({
      generationId: row.id as GenerationId,
      frame: frameStateOf({ frameUrl: row.frameUrl, refundEntryId: row.refundEntryId }, jobFromRow(row.job)),
      kept: row.keptAt !== null,
      createdAt: stamp(row.createdAt),
    })
    takes.set(shotId, list)
  }
  return takes
}

/** The latest render per reel, with its job, folded. One statement over the reel ids. */
const readClips = async (scope: ProjectScope, reelIds: readonly ReelId[]): Promise<ReadonlyMap<ReelId, ClipState>> => {
  if (reelIds.length === 0) return new Map()
  const rows = await dbOf(scope)
    .select({
      reelId: reelRenders.reelId,
      clipUrl: reelRenders.clipUrl,
      refundEntryId: reelRenders.refundEntryId,
      job: jobs,
    })
    .from(reelRenders)
    .innerJoin(jobs, eq(jobs.id, reelRenders.jobId))
    .where(scoped(scope, reelRenders, inArray(reelRenders.reelId, [...reelIds])))
    .orderBy(desc(reelRenders.createdAt))
  const clips = new Map<ReelId, ClipState>()
  for (const row of rows) {
    const reelId = row.reelId as ReelId
    // Newest first, so the first row seen for a reel is its clip.
    if (clips.has(reelId)) continue
    clips.set(reelId, clipStateOf({ clipUrl: row.clipUrl, refundEntryId: row.refundEntryId }, jobFromRow(row.job)))
  }
  return clips
}

/** The scenes' reels and shots, assembled. Four statements after the scene read. */
const assembleScenes = async (
  scope: ProjectScope,
  scenes: readonly StoryboardSceneHeader[],
): Promise<readonly ProductionScene[]> => {
  if (scenes.length === 0) return []
  const sceneIds = scenes.map((scene) => scene.sceneNodeId as string)
  const [reelRows, shotRows] = await Promise.all([
    dbOf(scope)
      .select()
      .from(reels)
      .where(scoped(scope, reels, inArray(reels.sceneNodeId, sceneIds)))
      .orderBy(asc(reels.sceneNodeId), byOrderKey(reels.orderKey)),
    dbOf(scope)
      .select()
      .from(shots)
      .where(scoped(scope, shots, inArray(shots.sceneNodeId, sceneIds)))
      .orderBy(asc(shots.sceneNodeId), byOrderKey(shots.orderKey)),
  ])
  const [takes, clips] = await Promise.all([
    readTakes(
      scope,
      shotRows.map((row) => row.id as ShotId),
    ),
    readClips(
      scope,
      reelRows.map((row) => row.id as ReelId),
    ),
  ])

  const reelsByScene = new Map<string, ReelRowShape[]>()
  for (const row of reelRows) {
    const list = reelsByScene.get(row.sceneNodeId) ?? []
    list.push(row)
    reelsByScene.set(row.sceneNodeId, list)
  }
  const shotsByScene = new Map<string, ShotRowShape[]>()
  for (const row of shotRows) {
    const list = shotsByScene.get(row.sceneNodeId) ?? []
    list.push(row)
    shotsByScene.set(row.sceneNodeId, list)
  }

  return scenes.map((scene) => {
    const sceneShots: ProductionShot[] = (shotsByScene.get(scene.sceneNodeId as string) ?? []).map((row, index) => {
      const shot = shotFromRow(row)
      const own = takes.get(shot.id) ?? []
      return {
        ...shot,
        number: shotLabel(scene.number, index + 1),
        frame: own[0]?.frame ?? { kind: 'empty' },
        takes: [...own],
      }
    })
    const sceneReels = reelsByScene.get(scene.sceneNodeId as string) ?? []
    const reelIds = new Set(sceneReels.map((row) => row.id))
    const byReel = new Map<string, ProductionShot[]>()
    const unreeled: ProductionShot[] = []
    for (const shot of sceneShots) {
      // A shot naming a reel of another scene cannot be written (the assign
      // statement checks the scene); if one were, it is unplaced, not lost.
      if (shot.reelId === null || !reelIds.has(shot.reelId as string)) {
        unreeled.push(shot)
        continue
      }
      const list = byReel.get(shot.reelId as string) ?? []
      list.push(shot)
      byReel.set(shot.reelId as string, list)
    }
    const rows: ReelRow[] = sceneReels.map((row, index) => ({
      ...reelFromRow(row),
      number: index + 1,
      shots: byReel.get(row.id) ?? [],
      clip: clips.get(row.id as ReelId) ?? { kind: 'none' },
    }))
    return {
      sceneNodeId: scene.sceneNodeId,
      number: scene.number,
      heading: scene.heading,
      ie: scene.reading?.ie ?? null,
      set: scene.reading?.set ?? '',
      timeOfDay: scene.reading?.timeOfDay ?? null,
      locationId: scene.locationId,
      cast: [...scene.cast],
      reels: rows,
      unreeled,
    }
  })
}

/**
 * The episode: every present scene with its reels, their shots and takes,
 * and their clips. A scene with no reels is a scene with an empty list.
 */
export const listProductionScenes = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
): Promise<readonly ProductionScene[]> => assembleScenes(scope, await listStoryboardScenes(scope, episodeId))

/** One present scene of this episode, assembled, or `null`. What an action returns after a write. */
export const readProductionScene = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  sceneNodeId: NodeId,
): Promise<ProductionScene | null> => {
  const scene = await readSceneHeader(scope, episodeId, sceneNodeId)
  if (scene === null) return null
  const assembled = await assembleScenes(scope, [scene])
  return assembled[0] ?? null
}

/** One reel, or `null` when it is not this project's. For an action learning the reel's scene. */
export const readReel = async (scope: ProjectScope, reelId: ReelId): Promise<Reel | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(reels)
    .where(scoped(scope, reels, eq(reels.id, reelId)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : reelFromRow(row)
}

/** The reels of one scene, in order. For an action computing a neighbour's key. */
export const listSceneReels = async (scope: ProjectScope, sceneNodeId: NodeId): Promise<readonly Reel[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(reels)
    .where(scoped(scope, reels, eq(reels.sceneNodeId, sceneNodeId)))
    .orderBy(byOrderKey(reels.orderKey))
  return rows.map(reelFromRow)
}

/**
 * Reels per episode, for a header chip or a nav row. Joined through the
 * scene's heading node to the screenplay document and a present derived
 * row, so a reel whose scene left the script is not counted - the same set
 * `listProductionScenes` lists.
 */
export const countReels = async (scope: ProjectScope, screenplayDocumentId: string): Promise<number> => {
  const rows = await dbOf(scope)
    .select({ n: sql<number>`count(*)::int` })
    .from(reels)
    .innerJoin(nodes, eq(nodes.id, reels.sceneNodeId))
    .innerJoin(sceneDerivations, eq(sceneDerivations.sceneNodeId, reels.sceneNodeId))
    .where(scoped(scope, reels, eq(nodes.documentId, screenplayDocumentId), eq(sceneDerivations.presence, 'present')))
  return rows[0]?.n ?? 0
}

// ---------------------------------------------------------------------------
// Reel writes
// ---------------------------------------------------------------------------

/** Insert a reel between two of its scene's neighbours. The caller has checked the scene is this episode's. */
export const insertReel = async (
  scope: ProjectScope,
  sceneNodeId: NodeId,
  edit: ReelEdit,
  neighbours: { readonly before: OrderKey | null; readonly after: OrderKey | null },
): Promise<Reel> => {
  const rows = await dbOf(scope)
    .insert(reels)
    .values({
      ...tenant(scope),
      sceneNodeId: sceneNodeId as string,
      orderKey: between(neighbours.before, neighbours.after) as string,
      name: edit.name,
      clipSeconds: edit.clipSeconds,
    })
    .returning()
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: inserting a reel returned no row.')
  return reelFromRow(row)
}

/** Rename. Finalized or not - a name locks nothing. Returns whether a row was there to write. */
export const renameReel = async (scope: ProjectScope, reelId: ReelId, name: string): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(reels)
    .set({ name, updatedAt: new Date() })
    .where(scoped(scope, reels, eq(reels.id, reelId)))
    .returning({ id: reels.id })
  return rows.length > 0
}

/**
 * Set the clip length. Refused on a finalized reel: the shots were locked
 * against a length, and the clip that renders is that length. `false` for
 * missing and locked alike; the action reads the reel to tell them apart.
 */
export const setReelClip = async (scope: ProjectScope, reelId: ReelId, clipSeconds: ClipSeconds): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(reels)
    .set({ clipSeconds, updatedAt: new Date() })
    .where(scoped(scope, reels, eq(reels.id, reelId), sql`${reels.finalizedAt} is null`))
    .returning({ id: reels.id })
  return rows.length > 0
}

/** Put a reel between two of its scene's neighbours. */
export const moveReel = async (
  scope: ProjectScope,
  reelId: ReelId,
  neighbours: { readonly before: OrderKey | null; readonly after: OrderKey | null },
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(reels)
    .set({ orderKey: between(neighbours.before, neighbours.after) as string, updatedAt: new Date() })
    .where(scoped(scope, reels, eq(reels.id, reelId)))
    .returning({ id: reels.id })
  return rows.length > 0
}

export type DeleteReelResult = 'deleted' | 'busy' | 'missing'

/**
 * Remove a reel. Its shots stay, detached (`shots.reel_id` is `set null`);
 * its renders cascade. Refused while a render of it is queued or running:
 * the job would keep its reservation with nothing to settle against. Cancel
 * first. One statement.
 */
export const deleteReel = async (scope: ProjectScope, reelId: ReelId): Promise<DeleteReelResult> => {
  const project = scope.projectId as string
  const rows = await dbOf(scope).execute<{ readonly found: boolean; readonly busy: boolean; readonly deleted: boolean }>(sql`
    with target as (
      select ${reels.id} as id from ${reels}
      where ${reels.id} = ${reelId} and ${reels.projectId} = ${project}
    ),
    busy as (
      select 1 from ${reelRenders} as rr
      join ${jobs} as j on j.id = rr.job_id
      where rr.reel_id = (select id from target) and j.status in ('queued', 'running')
    ),
    deleted as (
      delete from ${reels} as r
      where r.id = (select id from target) and not exists (select 1 from busy)
      returning r.id as id
    )
    select
      exists(select 1 from target) as found,
      exists(select 1 from busy) as busy,
      exists(select 1 from deleted) as deleted
  `)
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: deleting a reel returned no row.')
  if (!row.found) return 'missing'
  if (row.busy) return 'busy'
  return 'deleted'
}

/**
 * Put shots in a reel. The statement carries every rule: the reel is this
 * project's and not finalized, each shot is this project's, of the reel's
 * scene, and not in a finalized reel already. A shot moved between reels
 * is this same write. Returns how many rows changed.
 */
export const assignShotsToReel = async (
  scope: ProjectScope,
  reelId: ReelId,
  shotIds: readonly ShotId[],
): Promise<number> => {
  if (shotIds.length === 0) return 0
  const project = scope.projectId as string
  const ids = shotIds.join(',')
  const rows = await dbOf(scope).execute<{ readonly id: string }>(sql`
    update ${shots} as s
    set reel_id = r.id, updated_at = now()
    from ${reels} as r
    where r.id = ${reelId} and r.project_id = ${project} and r.finalized_at is null
      and s.project_id = ${project}
      and s.id = any(string_to_array(${ids}, ',')::uuid[])
      and s.scene_node_id = r.scene_node_id
      and not exists (select 1 from ${reels} as x where x.id = s.reel_id and x.finalized_at is not null)
    returning s.id as id
  `)
  return rows.length
}

export type FinalizeResult = 'set' | 'busy' | 'missing'

/**
 * Finalize, or unlock. Finalizing locks the reel's shots (`storyboard.ts`
 * carries the predicate) and allows the render; the gate that every frame
 * is drawn and the durations fill the clip is the action's, from the pure
 * fold, before this is called. Unlocking is refused while a render is
 * queued or running - the clip in flight is of these shots. One statement.
 */
export const setFinalized = async (scope: ProjectScope, reelId: ReelId, finalized: boolean): Promise<FinalizeResult> => {
  const project = scope.projectId as string
  const rows = await dbOf(scope).execute<{ readonly found: boolean; readonly busy: boolean; readonly written: boolean }>(sql`
    with target as (
      select ${reels.id} as id from ${reels}
      where ${reels.id} = ${reelId} and ${reels.projectId} = ${project}
    ),
    busy as (
      select 1 from ${reelRenders} as rr
      join ${jobs} as j on j.id = rr.job_id
      where rr.reel_id = (select id from target) and j.status in ('queued', 'running')
        and ${!finalized}
    ),
    written as (
      update ${reels} as r
      set finalized_at = ${finalized ? sql`coalesce(r.finalized_at, now())` : sql`null`}, updated_at = now()
      where r.id = (select id from target) and not exists (select 1 from busy)
      returning r.id as id
    )
    select
      exists(select 1 from target) as found,
      exists(select 1 from busy) as busy,
      exists(select 1 from written) as written
  `)
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: finalizing a reel returned no row.')
  if (!row.found) return 'missing'
  if (row.busy) return 'busy'
  return 'set'
}

// ---------------------------------------------------------------------------
// The kept take
// ---------------------------------------------------------------------------

export type KeepResult = 'kept' | 'not-drawn' | 'missing'

/**
 * Keep a take: it becomes the shot's frame, for both routes. Only a drawn
 * one - a refused or failed take is nothing to keep. Two commands in one
 * transaction; see the header for why not one statement.
 */
export const keepGeneration = async (scope: ProjectScope, generationId: GenerationId): Promise<KeepResult> =>
  dbOf(scope).transaction(async (tx) => {
    const targets = await tx
      .select({
        id: frameGenerations.id,
        shotId: frameGenerations.shotId,
        frameUrl: frameGenerations.frameUrl,
        status: jobs.status,
      })
      .from(frameGenerations)
      .innerJoin(jobs, eq(jobs.id, frameGenerations.jobId))
      .where(scoped(scope, frameGenerations, eq(frameGenerations.id, generationId)))
      .limit(1)
    const target = targets[0]
    if (target === undefined) return 'missing'
    if (target.status !== 'finished' || target.frameUrl === null) return 'not-drawn'
    await tx
      .update(frameGenerations)
      .set({ keptAt: null })
      .where(
        scoped(
          scope,
          frameGenerations,
          eq(frameGenerations.shotId, target.shotId),
          sql`${frameGenerations.keptAt} is not null`,
          sql`${frameGenerations.id} <> ${target.id}`,
        ),
      )
    await tx
      .update(frameGenerations)
      .set({ keptAt: new Date() })
      .where(scoped(scope, frameGenerations, eq(frameGenerations.id, target.id)))
    return 'kept'
  })

// ---------------------------------------------------------------------------
// The frame jobs, for a reel
// ---------------------------------------------------------------------------

export type QueueFramesResult =
  | { readonly status: 'queued'; readonly jobIds: readonly JobId[]; readonly available: number }
  | { readonly status: 'insufficient'; readonly available: number; readonly needed: number }
  /** The reel is not a reel of a present scene of this episode. */
  | { readonly status: 'no-reel' }
  | { readonly status: 'finalized' }
  /** Not every shot named is an accepted shot of this reel. `eligible` says how many were. */
  | { readonly status: 'not-eligible'; readonly eligible: number }

/**
 * Reserve `costEach × N` and write N jobs, N reservations and N generation
 * rows, in one statement, only if the balance covers all of it and every
 * shot qualifies. See the header. Nothing is written otherwise, and the
 * statement returns what it saw for the button to print.
 */
export const queueFrameGenerations = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  reelId: ReelId,
  shotIds: readonly ShotId[],
  costEach: number,
): Promise<QueueFramesResult> => {
  const project = scope.projectId as string
  const actor = scope.actor as string | null
  const wanted = shotIds.length
  const needed = costEach * wanted
  if (wanted === 0) return { status: 'not-eligible', eligible: 0 }
  const ids = shotIds.join(',')
  const rows = await dbOf(scope).execute<{
    readonly reel_found: boolean
    readonly finalized: boolean | null
    readonly eligible: number
    readonly available: number
    readonly job_ids: readonly string[] | null
  }>(sql`
    with reel as (
      select r.id as id, r.finalized_at as finalized_at
      from ${reels} as r
      join ${sceneDerivations} as d on d.scene_node_id = r.scene_node_id and d.presence = 'present'
      join ${nodes} as n on n.id = r.scene_node_id
      join ${documents} as doc on doc.id = n.document_id and doc.episode_id = ${episodeId} and doc.kind = 'screenplay'
      where r.id = ${reelId} and r.project_id = ${project}
    ),
    eligible as (
      select s.id as id
      from ${shots} as s, reel
      where s.project_id = ${project}
        and s.id = any(string_to_array(${ids}, ',')::uuid[])
        and s.reel_id = reel.id and s.state = 'accepted'
    ),
    settled as (
      select coalesce(sum(${creditLedger.delta}), 0)::int as total
      from ${creditLedger} where ${creditLedger.projectId} = ${project}
        and ${creditLedger.kind} not in ('reserve', 'release')
    ),
    held as (
      select coalesce(sum(l.delta), 0)::int as total
      from ${creditLedger} as l
      where l.project_id = ${project} and l.kind = 'reserve'
        and not exists (
          select 1 from ${creditLedger} as c
          where c.project_id = l.project_id
            and c.job_id is not distinct from l.job_id
            and c.kind in ('release', 'spend')
        )
    ),
    balance as (
      select (settled.total + held.total) as available from settled, held
    ),
    job as (
      insert into ${jobs} (project_id, kind, status, cost, payload, created_by)
      select ${project}, 'frame_generation', 'queued', ${costEach},
             jsonb_build_object('shotId', eligible.id), ${actor}::uuid
      from eligible, reel, balance
      where reel.finalized_at is null
        and (select count(*) from eligible) = ${wanted}
        and balance.available >= ${needed}
      returning ${jobs.id} as id, (${jobs.payload}->>'shotId')::uuid as shot_id
    ),
    reservation as (
      insert into ${creditLedger} (project_id, kind, delta, job_id, idempotency_key, reason, created_by)
      select ${project}, 'reserve', ${-costEach}, job.id, 'reserve:job:' || job.id::text,
             'Frame generation for shot ' || job.shot_id::text, ${actor}::uuid
      from job
      where ${costEach} > 0
      on conflict (project_id, idempotency_key) do nothing
      returning ${creditLedger.id} as id
    ),
    generation as (
      insert into ${frameGenerations} (project_id, shot_id, job_id)
      select ${project}, job.shot_id, job.id from job
      returning ${frameGenerations.id} as id
    )
    select
      exists(select 1 from reel) as reel_found,
      (select finalized_at is not null from reel) as finalized,
      (select count(*) from eligible)::int as eligible,
      balance.available as available,
      (select array_agg(id::text) from job) as job_ids
    from balance
  `)
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: queueing frames returned no row.')
  if (!row.reel_found) return { status: 'no-reel' }
  if (row.finalized === true) return { status: 'finalized' }
  if (row.eligible !== wanted) return { status: 'not-eligible', eligible: row.eligible }
  if (row.job_ids === null || row.job_ids.length === 0) {
    return { status: 'insufficient', available: row.available, needed }
  }
  return {
    status: 'queued',
    jobIds: row.job_ids.map((id) => id as JobId),
    available: row.available - needed,
  }
}

// ---------------------------------------------------------------------------
// The render job
// ---------------------------------------------------------------------------

export type QueueRenderResult =
  | { readonly status: 'queued'; readonly jobId: JobId; readonly renderId: ReelRenderId; readonly available: number }
  | { readonly status: 'insufficient'; readonly available: number }
  | { readonly status: 'no-reel' }
  | { readonly status: 'not-finalized' }
  /** A render of this reel is already queued or running. */
  | { readonly status: 'busy' }

/**
 * Reserve the cost and write the render job and its render row, in one
 * statement, only if the reel is finalized, no render of it is in flight,
 * and the balance covers it. The reel's chain check - this project's, a
 * present scene's of this episode's screenplay - rides inside.
 */
export const queueReelRender = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  reelId: ReelId,
  cost: number,
): Promise<QueueRenderResult> => {
  const project = scope.projectId as string
  const actor = scope.actor as string | null
  const rows = await dbOf(scope).execute<{
    readonly reel_found: boolean
    readonly finalized: boolean | null
    readonly busy: boolean
    readonly available: number
    readonly job_id: string | null
    readonly render_id: string | null
  }>(sql`
    with reel as (
      select r.id as id, r.finalized_at as finalized_at
      from ${reels} as r
      join ${sceneDerivations} as d on d.scene_node_id = r.scene_node_id and d.presence = 'present'
      join ${nodes} as n on n.id = r.scene_node_id
      join ${documents} as doc on doc.id = n.document_id and doc.episode_id = ${episodeId} and doc.kind = 'screenplay'
      where r.id = ${reelId} and r.project_id = ${project}
    ),
    busy as (
      select 1 from ${reelRenders} as rr
      join ${jobs} as j on j.id = rr.job_id
      where rr.reel_id = (select id from reel) and j.status in ('queued', 'running')
    ),
    settled as (
      select coalesce(sum(${creditLedger.delta}), 0)::int as total
      from ${creditLedger} where ${creditLedger.projectId} = ${project}
        and ${creditLedger.kind} not in ('reserve', 'release')
    ),
    held as (
      select coalesce(sum(l.delta), 0)::int as total
      from ${creditLedger} as l
      where l.project_id = ${project} and l.kind = 'reserve'
        and not exists (
          select 1 from ${creditLedger} as c
          where c.project_id = l.project_id
            and c.job_id is not distinct from l.job_id
            and c.kind in ('release', 'spend')
        )
    ),
    balance as (
      select (settled.total + held.total) as available from settled, held
    ),
    job as (
      insert into ${jobs} (project_id, kind, status, cost, payload, created_by)
      select ${project}, 'reel_render', 'queued', ${cost},
             jsonb_build_object('reelId', reel.id), ${actor}::uuid
      from reel, balance
      where reel.finalized_at is not null
        and not exists (select 1 from busy)
        and balance.available >= ${cost}
      returning ${jobs.id} as id
    ),
    reservation as (
      insert into ${creditLedger} (project_id, kind, delta, job_id, idempotency_key, reason, created_by)
      select ${project}, 'reserve', ${-cost}, job.id, 'reserve:job:' || job.id::text,
             'Clip render for reel ' || ${reelId}::text, ${actor}::uuid
      from job
      where ${cost} > 0
      on conflict (project_id, idempotency_key) do nothing
      returning ${creditLedger.id} as id
    ),
    render as (
      insert into ${reelRenders} (project_id, reel_id, job_id)
      select ${project}, reel.id, job.id from reel, job
      returning ${reelRenders.id} as id
    )
    select
      exists(select 1 from reel) as reel_found,
      (select finalized_at is not null from reel) as finalized,
      exists(select 1 from busy) as busy,
      balance.available as available,
      (select id from job) as job_id,
      (select id from render) as render_id
    from balance
  `)
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: queueing a render returned no row.')
  if (!row.reel_found) return { status: 'no-reel' }
  if (row.finalized !== true) return { status: 'not-finalized' }
  if (row.busy) return { status: 'busy' }
  if (row.job_id === null || row.render_id === null) return { status: 'insufficient', available: row.available }
  return {
    status: 'queued',
    jobId: row.job_id as JobId,
    renderId: row.render_id as ReelRenderId,
    available: row.available - cost,
  }
}

/** The `refund` entry a failed render links to, for a worker settling a failure. */
export const linkRenderRefund = async (
  scope: ProjectScope,
  renderId: ReelRenderId,
  refundEntryId: LedgerEntryId,
): Promise<void> => {
  await dbOf(scope)
    .update(reelRenders)
    .set({ refundEntryId: refundEntryId as string })
    .where(scoped(scope, reelRenders, eq(reelRenders.id, renderId)))
}
