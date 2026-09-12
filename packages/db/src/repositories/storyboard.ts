import type {
  EpisodeId,
  FrameState,
  GenerationId,
  Job,
  JobId,
  LedgerEntryId,
  OrderKey,
  Shot,
  ShotEdit,
  ShotId,
  ShotOrigin,
  ShotRow,
  ShotState,
  StoryboardScene,
  UserId,
} from '@folio/contracts'
import { projectId as brandProjectId } from '@folio/contracts'
import type { CharacterId, LocationId, NodeId, ShotSpec, SluglineReading } from '@folio/script'
import { readInlineContent, shotLabel } from '@folio/script'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { between, byOrderKey, spread } from '../order'
import {
  characterBoundCues,
  creditLedger,
  documents,
  frameGenerations,
  jobs,
  nodes,
  sceneDerivations,
  shots,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { jsonb } from '../sql-json'
import { stamp, stampOrNull } from './mapping'

/**
 * The Storyboard's rows: shots, and the job that draws a shot's frame.
 *
 * ## What is read, and from where
 *
 * The board is one column per present scene of the episode - the same
 * chain `workspace.ts` and `beats.ts` walk: `scene_derivations` in state
 * `present`, through the heading node to the episode's screenplay document.
 * Under each column, its `shots` in `order_key` order, and for each shot the
 * latest `frame_generations` row with its `jobs` row, folded into a
 * `FrameState`. Three statements for the whole board, whatever its size:
 * the scenes, the shots, the generations. Nothing is computed that a table
 * owns; the one thing computed is the shot's number, which no table owns.
 *
 * ## Reserve then execute, in one statement
 *
 * `queueFrameGeneration` is the route's one money write, and it is one
 * statement on purpose. AGENTS.md: "the balance check happens *before* the
 * job is enqueued, never inside it" - so the check is the `WHERE` on the
 * job insert, the reservation is inserted from the job's returned id, and
 * the generation from the same. If the balance is short nothing is written
 * and the statement returns the balance it saw, for the button to print.
 * The ledger's own rules are kept exactly: `reserve` is negative, keyed on
 * the job, idempotent on `reserve:job:<id>`; a zero-cost job reserves
 * nothing rather than writing a zero the check constraint would refuse.
 *
 * Two clicks racing on the last four credits can both read the same balance
 * under READ COMMITTED and both reserve. That is the residual of doing this
 * without an advisory lock, which needs the session pooler the worker has
 * and a request does not; it over-reserves by one job's cost at worst and
 * the ledger shows both. Flagged, not hidden.
 */

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

type ShotRowShape = typeof shots.$inferSelect
type JobRowShape = typeof jobs.$inferSelect

/** A stored description that will not read is reported as text, never thrown. */
const descriptionOf = (raw: unknown): ShotSpec['description'] => {
  const read = readInlineContent(raw)
  if (read.ok) return read.value
  return [{ kind: 'text', text: `(description would not read: ${read.error.reason.kind})` }]
}

const toShot = (row: ShotRowShape): Shot => ({
  id: row.id as ShotId,
  projectId: brandProjectId(row.projectId),
  sceneNodeId: row.sceneNodeId as NodeId,
  orderKey: row.orderKey as OrderKey,
  size: row.size,
  movement: row.movement,
  angle: row.angle,
  lensMm: row.lensMm,
  durationSeconds: row.durationSeconds,
  description: descriptionOf(row.description),
  origin: row.origin,
  state: row.state,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

const toJob = (row: JobRowShape): Job => ({
  id: row.id as JobId,
  projectId: brandProjectId(row.projectId),
  kind: row.kind,
  status: row.status,
  cost: row.cost,
  createdBy: row.createdBy === null ? null : (row.createdBy as UserId),
  createdAt: stamp(row.createdAt),
  startedAt: stampOrNull(row.startedAt),
  finishedAt: stampOrNull(row.finishedAt),
  cancelRequestedAt: stampOrNull(row.cancelRequestedAt),
  error: row.error,
  blockedReason: row.blockedReason,
})

/** The seven states, from the latest generation and its job. */
export const frameStateOf = (
  generation: { readonly frameUrl: string | null; readonly refundEntryId: string | null } | null,
  job: Job | null,
): FrameState => {
  if (generation === null || job === null) return { kind: 'empty' }
  switch (job.status) {
    case 'queued':
      return { kind: 'queued', jobId: job.id, cost: job.cost }
    case 'running':
      return { kind: 'running', jobId: job.id, cost: job.cost }
    case 'finished':
      return generation.frameUrl === null
        ? { kind: 'failed', jobId: job.id, error: 'The job finished without a frame.', refunded: false }
        : { kind: 'drawn', jobId: job.id, url: generation.frameUrl }
    case 'failed':
      return { kind: 'failed', jobId: job.id, error: job.error, refunded: generation.refundEntryId !== null }
    case 'blocked':
      return { kind: 'blocked', jobId: job.id, reason: job.blockedReason ?? 'Refused, with no reason recorded.' }
    case 'cancelled':
      return { kind: 'cancelled', jobId: job.id }
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One present scene of the episode, as the board's column header reads it. */
type SceneHeader = {
  readonly sceneNodeId: NodeId
  readonly number: number
  readonly heading: string
  readonly reading: SluglineReading | null
  readonly locationId: LocationId | null
}

const readingOf = (raw: unknown): SluglineReading | null =>
  typeof raw === 'object' && raw !== null && 'set' in raw ? (raw as SluglineReading) : null

/** The present scenes of the episode, in order - the board's columns, and the proposer's scene boundaries. */
export const listStoryboardScenes = async (scope: ProjectScope, episodeId: EpisodeId): Promise<readonly SceneHeader[]> => {
  const rows = await dbOf(scope)
    .select({
      sceneNodeId: sceneDerivations.sceneNodeId,
      number: sceneDerivations.number,
      heading: sceneDerivations.heading,
      reading: sceneDerivations.reading,
      locationId: sceneDerivations.locationId,
    })
    .from(sceneDerivations)
    .innerJoin(nodes, eq(nodes.id, sceneDerivations.sceneNodeId))
    .innerJoin(
      documents,
      and(eq(documents.id, nodes.documentId), eq(documents.episodeId, episodeId), eq(documents.kind, 'screenplay')),
    )
    .where(scoped(scope, sceneDerivations, eq(sceneDerivations.presence, 'present')))
    .orderBy(asc(sceneDerivations.number))
  return rows.map((row) => ({
    sceneNodeId: row.sceneNodeId as NodeId,
    number: row.number,
    heading: row.heading,
    reading: readingOf(row.reading),
    locationId: row.locationId === null ? null : (row.locationId as LocationId),
  }))
}

/** The latest generation per shot, with its job. One statement over the shot ids. */
const readFrames = async (
  scope: ProjectScope,
  shotIds: readonly ShotId[],
): Promise<ReadonlyMap<ShotId, FrameState>> => {
  if (shotIds.length === 0) return new Map()
  const rows = await dbOf(scope)
    .select({
      shotId: frameGenerations.shotId,
      frameUrl: frameGenerations.frameUrl,
      refundEntryId: frameGenerations.refundEntryId,
      job: jobs,
    })
    .from(frameGenerations)
    .innerJoin(jobs, eq(jobs.id, frameGenerations.jobId))
    .where(scoped(scope, frameGenerations, inArray(frameGenerations.shotId, [...shotIds])))
    .orderBy(desc(frameGenerations.createdAt))
  const frames = new Map<ShotId, FrameState>()
  for (const row of rows) {
    const shotId = row.shotId as ShotId
    // Newest first, so the first row seen for a shot is its frame.
    if (frames.has(shotId)) continue
    frames.set(shotId, frameStateOf({ frameUrl: row.frameUrl, refundEntryId: row.refundEntryId }, toJob(row.job)))
  }
  return frames
}

/**
 * The board: every present scene of the episode with its shots and their
 * frames. A scene with no shots is a column with an empty list.
 */
export const listStoryboard = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
): Promise<readonly StoryboardScene[]> => {
  const scenes = await listStoryboardScenes(scope, episodeId)
  if (scenes.length === 0) return []
  const sceneIds = scenes.map((scene) => scene.sceneNodeId as string)
  const shotRows = await dbOf(scope)
    .select()
    .from(shots)
    .where(scoped(scope, shots, inArray(shots.sceneNodeId, sceneIds)))
    .orderBy(asc(shots.sceneNodeId), byOrderKey(shots.orderKey))
  const frames = await readFrames(
    scope,
    shotRows.map((row) => row.id as ShotId),
  )

  const byScene = new Map<string, Shot[]>()
  for (const row of shotRows) {
    const list = byScene.get(row.sceneNodeId) ?? []
    list.push(toShot(row))
    byScene.set(row.sceneNodeId, list)
  }

  return scenes.map((scene) => {
    const list = byScene.get(scene.sceneNodeId as string) ?? []
    const rows: ShotRow[] = list.map((shot, index) => ({
      ...shot,
      number: shotLabel(scene.number, index + 1),
      frame: frames.get(shot.id) ?? { kind: 'empty' },
    }))
    return {
      sceneNodeId: scene.sceneNodeId,
      number: scene.number,
      heading: scene.heading,
      ie: scene.reading?.ie ?? null,
      set: scene.reading?.set ?? '',
      timeOfDay: scene.reading?.timeOfDay ?? null,
      locationId: scene.locationId,
      shots: rows,
    }
  })
}

/**
 * One present scene of this episode, or `null` when the id is not a present
 * heading of the episode's screenplay. The check every shot write runs
 * first: `shots.scene_node_id` has no foreign key, so this join is what says
 * a scene is real, present and this episode's.
 */
export const readSceneHeader = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  sceneNodeId: NodeId,
): Promise<SceneHeader | null> => {
  const rows = await dbOf(scope)
    .select({
      sceneNodeId: sceneDerivations.sceneNodeId,
      number: sceneDerivations.number,
      heading: sceneDerivations.heading,
      reading: sceneDerivations.reading,
      locationId: sceneDerivations.locationId,
    })
    .from(sceneDerivations)
    .innerJoin(nodes, eq(nodes.id, sceneDerivations.sceneNodeId))
    .innerJoin(
      documents,
      and(eq(documents.id, nodes.documentId), eq(documents.episodeId, episodeId), eq(documents.kind, 'screenplay')),
    )
    .where(
      scoped(scope, sceneDerivations, eq(sceneDerivations.sceneNodeId, sceneNodeId), eq(sceneDerivations.presence, 'present')),
    )
    .limit(1)
  const row = rows[0]
  if (row === undefined) return null
  return {
    sceneNodeId: row.sceneNodeId as NodeId,
    number: row.number,
    heading: row.heading,
    reading: readingOf(row.reading),
    locationId: row.locationId === null ? null : (row.locationId as LocationId),
  }
}

export type { SceneHeader as StoryboardSceneHeader }

/** One scene's shots as the board draws them - numbered, with frames. Two statements. */
export const listSceneShotRows = async (
  scope: ProjectScope,
  sceneNodeId: NodeId,
  sceneNumber: number,
): Promise<readonly ShotRow[]> => {
  const list = await listSceneShots(scope, sceneNodeId)
  const frames = await readFrames(
    scope,
    list.map((shot) => shot.id),
  )
  return list.map((shot, index) => ({
    ...shot,
    number: shotLabel(sceneNumber, index + 1),
    frame: frames.get(shot.id) ?? { kind: 'empty' },
  }))
}

/** The shots of one scene, in order. For an action computing a neighbour's key. */
export const listSceneShots = async (scope: ProjectScope, sceneNodeId: NodeId): Promise<readonly Shot[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(shots)
    .where(scoped(scope, shots, eq(shots.sceneNodeId, sceneNodeId)))
    .orderBy(byOrderKey(shots.orderKey))
  return rows.map(toShot)
}

/** One shot, or `null` when it is not this project's. */
export const readShot = async (scope: ProjectScope, shotId: ShotId): Promise<Shot | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(shots)
    .where(scoped(scope, shots, eq(shots.id, shotId)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toShot(row)
}

/** The alias table's bound half, for `boundCueMap`. */
export const readBoundCues = async (
  scope: ProjectScope,
): Promise<readonly { readonly cue: string; readonly characterId: CharacterId }[]> => {
  const rows = await dbOf(scope)
    .select({ cue: characterBoundCues.cue, characterId: characterBoundCues.characterId })
    .from(characterBoundCues)
    .where(scoped(scope, characterBoundCues))
  return rows.map((row) => ({ cue: row.cue, characterId: row.characterId as CharacterId }))
}

/**
 * Accepted shots per episode, for the nav's Storyboard row. Joined through
 * the scene's heading node to the screenplay document and to a present
 * derived row, so a shot whose scene left the script is not counted - the
 * same set the board lists.
 */
export const countAcceptedShots = async (scope: ProjectScope, screenplayDocumentId: string): Promise<number> => {
  const rows = await dbOf(scope)
    .select({ n: sql<number>`count(*)::int` })
    .from(shots)
    .innerJoin(nodes, eq(nodes.id, shots.sceneNodeId))
    .innerJoin(sceneDerivations, eq(sceneDerivations.sceneNodeId, shots.sceneNodeId))
    .where(
      scoped(
        scope,
        shots,
        eq(nodes.documentId, screenplayDocumentId),
        eq(sceneDerivations.presence, 'present'),
        eq(shots.state, 'accepted'),
      ),
    )
  return rows[0]?.n ?? 0
}

// ---------------------------------------------------------------------------
// Shot writes
// ---------------------------------------------------------------------------

/**
 * Insert shots after `after` (or at the end when `null` and the scene has
 * shots, or first when it has none). Keys are `spread` between the two
 * neighbours, one statement for however many rows. The caller has checked
 * the scene is this episode's.
 */
export const insertShots = async (
  scope: ProjectScope,
  sceneNodeId: NodeId,
  specs: readonly ShotSpec[],
  origin: ShotOrigin,
  state: ShotState,
  neighbours: { readonly before: OrderKey | null; readonly after: OrderKey | null },
): Promise<readonly Shot[]> => {
  if (specs.length === 0) return []
  const keys = spread(neighbours.before, neighbours.after, specs.length)
  const rows = await dbOf(scope)
    .insert(shots)
    .values(
      specs.map((spec, index) => ({
        ...tenant(scope),
        sceneNodeId: sceneNodeId as string,
        orderKey: keys[index] as string,
        size: spec.size,
        movement: spec.movement,
        angle: spec.angle,
        lensMm: spec.lensMm,
        durationSeconds: spec.durationSeconds,
        description: jsonb(spec.description),
        origin,
        state,
      })),
    )
    .returning()
  return rows.map(toShot)
}

/**
 * Rewrite a shot, whole. Editing is acceptance: the row leaves `proposed`
 * on any edit, because a writer who changed a proposal has taken it.
 */
export const updateShot = async (scope: ProjectScope, shotId: ShotId, edit: ShotEdit): Promise<Shot | null> => {
  const rows = await dbOf(scope)
    .update(shots)
    .set({
      size: edit.size,
      movement: edit.movement,
      angle: edit.angle,
      lensMm: edit.lensMm,
      durationSeconds: edit.durationSeconds,
      description: jsonb(edit.description),
      state: 'accepted',
      updatedAt: new Date(),
    })
    .where(scoped(scope, shots, eq(shots.id, shotId)))
    .returning()
  const row = rows[0]
  return row === undefined ? null : toShot(row)
}

/** Accept proposals. Returns how many rows changed. */
export const acceptShots = async (scope: ProjectScope, shotIds: readonly ShotId[]): Promise<number> => {
  if (shotIds.length === 0) return 0
  const rows = await dbOf(scope)
    .update(shots)
    .set({ state: 'accepted', updatedAt: new Date() })
    .where(scoped(scope, shots, inArray(shots.id, [...shotIds]), eq(shots.state, 'proposed')))
    .returning({ id: shots.id })
  return rows.length
}

/** Delete shots - a discarded proposal or a removed shot. Generations cascade; jobs stay as history. */
export const deleteShots = async (scope: ProjectScope, shotIds: readonly ShotId[]): Promise<number> => {
  if (shotIds.length === 0) return 0
  const rows = await dbOf(scope)
    .delete(shots)
    .where(scoped(scope, shots, inArray(shots.id, [...shotIds])))
    .returning({ id: shots.id })
  return rows.length
}

/** Put a shot between two of its scene's neighbours. */
export const moveShot = async (
  scope: ProjectScope,
  shotId: ShotId,
  neighbours: { readonly before: OrderKey | null; readonly after: OrderKey | null },
): Promise<Shot | null> => {
  const key = between(neighbours.before, neighbours.after)
  const rows = await dbOf(scope)
    .update(shots)
    .set({ orderKey: key as string, updatedAt: new Date() })
    .where(scoped(scope, shots, eq(shots.id, shotId)))
    .returning()
  const row = rows[0]
  return row === undefined ? null : toShot(row)
}

// ---------------------------------------------------------------------------
// The frame job
// ---------------------------------------------------------------------------

export type QueueFrameResult =
  | { readonly status: 'queued'; readonly jobId: JobId; readonly generationId: GenerationId; readonly available: number }
  | { readonly status: 'insufficient'; readonly available: number }
  /** The shot is not an accepted shot of a present scene of this episode. */
  | { readonly status: 'no-shot'; readonly state: ShotState | null }

/**
 * Reserve the cost and write the job and its generation row, in one
 * statement, only if the balance covers it. See the header.
 *
 * The shot's own check rides in the same statement: it must be this
 * project's, a present scene's of this episode's screenplay, and accepted -
 * a proposal has no frame. Three sequential reads folded into one because
 * on the request path the cost is statement count (`client.ts`).
 */
export const queueFrameGeneration = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  shotId: ShotId,
  cost: number,
): Promise<QueueFrameResult> => {
  const db = dbOf(scope)
  const project = scope.projectId as string
  const actor = scope.actor as string | null
  const rows = await db.execute<{
    readonly shot_found: boolean
    readonly shot_state: ShotState | null
    readonly available: number
    readonly job_id: string | null
    readonly generation_id: string | null
  }>(sql`
    with shot as (
      select s.id as id, s.state as state
      from ${shots} as s
      join ${sceneDerivations} as d on d.scene_node_id = s.scene_node_id and d.presence = 'present'
      join ${nodes} as n on n.id = s.scene_node_id
      join ${documents} as doc on doc.id = n.document_id and doc.episode_id = ${episodeId} and doc.kind = 'screenplay'
      where s.id = ${shotId} and s.project_id = ${project}
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
      select ${project}, 'frame_generation', 'queued', ${cost},
             jsonb_build_object('shotId', shot.id), ${actor}::uuid
      from shot, balance
      where shot.state = 'accepted' and balance.available >= ${cost}
      returning ${jobs.id} as id
    ),
    reservation as (
      insert into ${creditLedger} (project_id, kind, delta, job_id, idempotency_key, reason, created_by)
      select ${project}, 'reserve', ${-cost}, job.id, 'reserve:job:' || job.id::text,
             'Frame generation for shot ' || ${shotId}::text, ${actor}::uuid
      from job
      where ${cost} > 0
      on conflict (project_id, idempotency_key) do nothing
      returning ${creditLedger.id} as id
    ),
    generation as (
      insert into ${frameGenerations} (project_id, shot_id, job_id)
      select ${project}, shot.id, job.id from shot, job
      returning ${frameGenerations.id} as id
    )
    select
      exists(select 1 from shot) as shot_found,
      (select state from shot) as shot_state,
      balance.available as available,
      (select id from job) as job_id,
      (select id from generation) as generation_id
    from balance
  `)
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: queueing a frame returned no row.')
  if (!row.shot_found || row.shot_state !== 'accepted') return { status: 'no-shot', state: row.shot_state }
  if (row.job_id === null || row.generation_id === null) return { status: 'insufficient', available: row.available }
  return {
    status: 'queued',
    jobId: row.job_id as JobId,
    generationId: row.generation_id as GenerationId,
    available: row.available - cost,
  }
}

export type CancelJobResult =
  /** Cancelled outright; `available` is the balance with the reservation released. */
  | { readonly status: 'cancelled'; readonly released: number; readonly available: number }
  /** Running: asked to stop. `cost` is what is still reserved until the worker settles it. */
  | { readonly status: 'requested'; readonly cost: number }
  | { readonly status: 'already-over'; readonly was: Job['status'] }
  | { readonly status: 'no-job' }

/**
 * Stop a job. A queued one is cancelled outright and its reservation
 * released; a running one is asked to stop - `cancel_requested_at` - and the
 * worker settles it. One statement either way, and the balance the caller
 * prints is the one read in it plus what was released: a data-modifying CTE
 * is not visible to a sibling read in the same statement, so the sum is
 * finished here rather than re-read.
 */
export const cancelJob = async (scope: ProjectScope, jobId: JobId): Promise<CancelJobResult> => {
  const project = scope.projectId as string
  const actor = scope.actor as string | null
  const rows = await dbOf(scope).execute<{
    readonly was: Job['status'] | null
    readonly cost: number | null
    readonly cancelled: number
    readonly requested: number
    readonly released: number
    readonly available: number
  }>(sql`
    with target as (
      select ${jobs.id} as id, ${jobs.status} as status, ${jobs.cost} as cost from ${jobs}
      where ${jobs.id} = ${jobId} and ${jobs.projectId} = ${project}
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
    cancelled as (
      update ${jobs} as j
      set status = 'cancelled', finished_at = now(), cancel_requested_at = coalesce(j.cancel_requested_at, now())
      from target
      where j.id = target.id and target.status = 'queued'
      returning j.id as id, j.cost as cost
    ),
    requested as (
      update ${jobs} as j
      set cancel_requested_at = coalesce(j.cancel_requested_at, now())
      from target
      where j.id = target.id and target.status = 'running'
      returning j.id as id
    ),
    released as (
      insert into ${creditLedger} (project_id, kind, delta, job_id, idempotency_key, reason, created_by)
      select ${project}, 'release', cancelled.cost, cancelled.id, 'release:job:' || cancelled.id::text,
             'Frame generation cancelled before it ran', ${actor}::uuid
      from cancelled
      where cancelled.cost > 0
      on conflict (project_id, idempotency_key) do nothing
      returning delta
    )
    select
      (select status from target) as was,
      (select cost from target) as cost,
      (select count(*) from cancelled)::int as cancelled,
      (select count(*) from requested)::int as requested,
      coalesce((select sum(delta) from released), 0)::int as released,
      (settled.total + held.total) as available
    from settled, held
  `)
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: cancelling a job returned no row.')
  if (row.was === null) return { status: 'no-job' }
  if (row.cancelled > 0) return { status: 'cancelled', released: row.released, available: row.available + row.released }
  if (row.requested > 0) return { status: 'requested', cost: row.cost ?? 0 }
  return { status: 'already-over', was: row.was }
}

/** A job row, or `null` when it is not this project's. For a status read after a reload. */
export const readJob = async (scope: ProjectScope, jobId: JobId): Promise<Job | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(jobs)
    .where(scoped(scope, jobs, eq(jobs.id, jobId)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toJob(row)
}

/** The `refund` entry a failed generation links to, for a worker settling a failure. */
export const linkRefund = async (
  scope: ProjectScope,
  generationId: GenerationId,
  refundEntryId: LedgerEntryId,
): Promise<void> => {
  await dbOf(scope)
    .update(frameGenerations)
    .set({ refundEntryId: refundEntryId as string })
    .where(scoped(scope, frameGenerations, eq(frameGenerations.id, generationId)))
}
