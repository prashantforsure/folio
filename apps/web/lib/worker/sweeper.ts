import type { AssetId, ProjectId } from '@folio/contracts'
import { ProjectIdSchema } from '@folio/contracts'
import type { PeriodicTask, ProjectScope, WorkerLog } from '@folio/db'
import { deleteUnreferencedAssets, listUnreferencedAssetKeys, openProjectForWorker } from '@folio/db'
import { workerEnv } from '@folio/db/env'

import type { StoredObject } from '../storage/r2'
import { deleteObject, listObjects, storageAvailable } from '../storage/r2'

/**
 * The R2 sweeper - roadmap task 4.3. Production never deletes an image or a
 * clip when a redraw or a retake replaces it, and a run cancelled after its
 * upload leaves one behind; so every six hours this lists the bucket's
 * `projects/<id>/production/` objects older than a day, asks each project which
 * of them nothing points at (`listUnreferencedAssetKeys`), and logs them.
 *
 * It deletes only when `R2_SWEEP_DELETE=true`, and then the rows go first:
 * `deleteUnreferencedAssets` checks the references again inside the delete,
 * so an asset a redraw pointed at since the read is kept, and only the
 * objects of rows it actually removed - or of keys no row ever named - are
 * deleted from the bucket.
 *
 * Only Production's prefix: a portrait, a location or prop photo, or a
 * Storyboard frame is replaced by its own action, which deletes the old one.
 * One sweep reads at most `SWEEP_PAGE` objects and the next carries on after
 * the last key (`cursor`), so a large bucket is covered over several sweeps.
 */

export const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000
export const SWEEP_AGE_MS = 24 * 60 * 60 * 1000
const SWEEP_PAGE = 10_000

const PRODUCTION_KEY = /^projects\/([^/]+)\/production\//

/** The Production objects old enough to sweep, by project. Exported for the test. */
export const sweepable = (objects: readonly StoredObject[], now: Date): ReadonlyMap<ProjectId, readonly string[]> => {
  const byProject = new Map<ProjectId, string[]>()
  for (const object of objects) {
    if (now.getTime() - object.lastModified.getTime() < SWEEP_AGE_MS) continue
    const project = ProjectIdSchema.safeParse(PRODUCTION_KEY.exec(object.key)?.[1])
    if (!project.success) continue
    const keys = byProject.get(project.data) ?? []
    keys.push(object.key)
    byProject.set(project.data, keys)
  }
  return byProject
}

export type Swept = { readonly unreferenced: number; readonly deleted: number }

/** One project's unreferenced keys: logged, and deleted when `remove` is set. Exported for the test. */
export const sweepProject = async (scope: ProjectScope, keys: readonly string[], remove: boolean, log: WorkerLog): Promise<Swept> => {
  const found = await listUnreferencedAssetKeys(scope, keys)
  if (found.length === 0) return { unreferenced: 0, deleted: 0 }
  log({ event: 'folio.sweeper.unreferenced', projectId: scope.projectId, count: found.length, keys: found.map((row) => row.key), deleting: remove })
  if (!remove) return { unreferenced: found.length, deleted: 0 }

  const removed = new Set<AssetId>(await deleteUnreferencedAssets(scope, found.flatMap((row) => (row.assetId === null ? [] : [row.assetId]))))
  let deleted = 0
  for (const row of found) {
    if (row.assetId !== null && !removed.has(row.assetId)) continue
    const out = await deleteObject(row.key)
    if (out.ok) deleted += 1
    else log({ event: 'folio.sweeper.delete_failed', projectId: scope.projectId, key: row.key, message: out.message })
  }
  return { unreferenced: found.length, deleted }
}

let cursor: string | null = null

export const sweeper: PeriodicTask = {
  name: 'r2-sweeper',
  everyMs: SWEEP_EVERY_MS,
  run: async (log) => {
    if (!storageAvailable()) return
    const listing = await listObjects('projects/', { maxObjects: SWEEP_PAGE, startAfter: cursor })
    if (!listing.ok) {
      log({ event: 'folio.sweeper.list_failed', message: listing.message })
      return
    }
    cursor = listing.truncated ? (listing.objects.at(-1)?.key ?? null) : null
    let unreferenced = 0
    let deleted = 0
    for (const [projectId, keys] of sweepable(listing.objects, new Date())) {
      const swept = await sweepProject(await openProjectForWorker(projectId, null), keys, workerEnv.R2_SWEEP_DELETE, log)
      unreferenced += swept.unreferenced
      deleted += swept.deleted
    }
    log({ event: 'folio.sweeper.swept', listed: listing.objects.length, unreferenced, deleted, more: listing.truncated })
  },
}
