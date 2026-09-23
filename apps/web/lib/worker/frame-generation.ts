import type { JobId } from '@folio/contracts'
import type { ClaimedJob, FrameSettlement, JobHandler, JobOutcome, ProjectScope } from '@folio/db'
import { listCharacterRecords, listSceneIndex, openProjectForWorker, readFrameJob, readMentionLabels, readShot, settleFrameJob } from '@folio/db'
import type { InlineContent, MentionLabel } from '@folio/script'

import { generateImage } from '../production/pipeline/gemini'
import { storyboardFrameSpec } from '../production/pipeline/spec'
import { publicUrl, putObject } from '../storage/r2'

/**
 * A Storyboard frame, on the worker - roadmap task 4.3, defect 0.4 closed
 * properly.
 *
 * `requestFrame` reserved `FRAME_GENERATION_COST` and queued this job, with its
 * `frame_generations` row, in one statement. The handler reads the shot, draws
 * it with the `shot_frame` model (`storyboardFrameSpec`: the scene heading, the
 * camera, the description with every mention as a name, the mentioned
 * characters' portraits as references), puts the image in R2 under the shot,
 * and settles the job the jobs table's way (`settleFrameJob`): drawn is a
 * spend; failed is a spend and a refund; refused (`blocked`) or cancelled is a
 * release. What it answers is the `jobs` row's own status.
 *
 * Only the writer's cancel stops the drawing, as with a Production
 * generation: a shutdown or a lost lease leaves the job for the next worker.
 */

const EXTENSION: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

const SIZE_LABEL: Readonly<Record<string, string>> = {
  ews: 'extreme wide shot',
  ws: 'wide shot',
  mws: 'medium wide shot',
  ms: 'medium shot',
  mcu: 'medium close-up',
  cu: 'close-up',
  ecu: 'extreme close-up',
  ots: 'over-the-shoulder',
  insert: 'insert',
}

/** The shot's camera in words: `medium shot · low angle · dolly · 35mm`. */
export const cameraOf = (shot: { readonly size: string; readonly angle: string; readonly movement: string; readonly lensMm: number | null }): string =>
  [SIZE_LABEL[shot.size] ?? shot.size, `${shot.angle.replace(/_/g, ' ')} angle`, shot.movement, ...(shot.lensMm === null ? [] : [`${String(shot.lensMm)}mm`])].join(' · ')

/** A description's text with each `@mention` printed as the record's name. */
export const proseOf = (content: InlineContent, labels: readonly MentionLabel[]): string => {
  const book = new Map(labels.map((label) => [`${label.entity}:${label.id as string}`, label.label]))
  return content.map((run) => (run.kind === 'text' ? run.text : (book.get(`${run.target.entity}:${run.target.id as string}`) ?? ''))).join('')
}

const settle = async (scope: ProjectScope, jobId: JobId, outcome: FrameSettlement): Promise<JobOutcome> => {
  await settleFrameJob(scope, jobId, outcome)
  switch (outcome.kind) {
    case 'drawn':
      return { status: 'finished' }
    case 'failed':
      return { status: 'failed', error: outcome.error }
    case 'blocked':
      return { status: 'blocked', reason: outcome.reason }
    case 'cancelled':
      return { status: 'cancelled' }
  }
}

const scopeOf = (job: ClaimedJob): Promise<ProjectScope> => openProjectForWorker(job.projectId, job.createdBy)

const drawFrame = async (scope: ProjectScope, job: ClaimedJob, signal: AbortSignal): Promise<JobOutcome> => {
  const frame = await readFrameJob(scope, job.id)
  if (frame === null) return settle(scope, job.id, { kind: 'failed', error: 'The frame job has no generation row.' })
  // Drawn and settled by an attempt that died before the job was marked: nothing to draw.
  if (frame.frameUrl !== null) return settle(scope, job.id, { kind: 'drawn', frameUrl: frame.frameUrl })
  const shot = await readShot(scope, frame.shotId)
  if (shot === null) return settle(scope, job.id, { kind: 'failed', error: 'The shot is gone.' })
  if (shot.state !== 'accepted') return settle(scope, job.id, { kind: 'failed', error: 'A proposal has no frame.' })

  const [index, labels, characters] = await Promise.all([listSceneIndex(scope), readMentionLabels(scope), listCharacterRecords(scope)])
  const mentioned = new Set(shot.description.flatMap((run) => (run.kind === 'mention' && run.target.entity === 'character' ? [run.target.id as string] : [])))
  const spec = storyboardFrameSpec({
    heading: index.find((row) => row.sceneNodeId === shot.sceneNodeId)?.heading ?? 'the scene',
    camera: cameraOf(shot),
    description: proseOf(shot.description, labels),
    cast: characters.filter((record) => mentioned.has(record.id as string)).map((record) => ({ name: record.name, portraitUrl: publicUrl(record.portraitKey) })),
  })
  if (spec.route === null) return settle(scope, job.id, { kind: 'failed', error: 'No model is registered for a frame.' })

  const cancel = new AbortController()
  const follow = (): void => {
    if (signal.reason === 'cancel') cancel.abort('cancel')
  }
  signal.addEventListener('abort', follow, { once: true })
  const out = await generateImage(spec.route, spec, cancel.signal)
  if (cancel.signal.aborted) return settle(scope, job.id, { kind: 'cancelled' })
  if (!out.ok) return settle(scope, job.id, out.kind === 'refused' ? { kind: 'blocked', reason: out.reason } : { kind: 'failed', error: out.message })

  const key = `projects/${job.projectId}/shots/${frame.shotId}/generated-${crypto.randomUUID()}.${EXTENSION[out.value.mime] ?? 'png'}`
  const put = await putObject(key, out.value.bytes, out.value.mime)
  if (!put.ok) return settle(scope, job.id, { kind: 'failed', error: put.message })
  const url = publicUrl(key)
  if (url === null) return settle(scope, job.id, { kind: 'failed', error: 'Storage is not configured.' })
  return settle(scope, job.id, { kind: 'drawn', frameUrl: url })
}

export const frameGenerationHandler: JobHandler = {
  run: async ({ job, signal }) => drawFrame(await scopeOf(job), job, signal),

  /** Failed without finishing (the stale sweep's third attempt): the credits come back as a refund. */
  abandon: async (job) => {
    await settleFrameJob(await scopeOf(job), job.id, { kind: 'failed', error: 'interrupted' })
  },
}
