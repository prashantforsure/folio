'use server'

import type { TextExportResult } from '../workspace/export'
import { listEpisodes } from '@folio/db'
import { chronologyExport, readContinuity } from './server'

import { revalidatePath } from 'next/cache'

import { ROLE } from '../auth/roles'
import { isRefusal, openProject } from '../script/gate'
import {
  createThreadProblem,
  createThreadWith,
  deleteThreadWith,
  findingKeyProblem,
  markDeliberateWith,
  orderThreadsWith,
  placeScenesWith,
  placementsProblem,
  readSceneLinesWith,
  reopenFindingWith,
  saveStoryTimeWith,
  saveThreadProblem,
  saveThreadWith,
  sceneIdProblem,
  sceneThreadsProblem,
  setSceneThreadsWith,
  storyTimeProblem,
  threadIdProblem,
  threadOrderProblem,
  unplaceScenesWith,
  verdictProblem,
} from './core'
import type { DeletedResult, PlacedResult, SavedResult, SceneLinesResult, ThreadCreatedResult, UnplacedResult } from './result'

/**
 * The Timeline route's writes, and its one read on demand.
 *
 * Every one goes gate -> repository -> result, through the project-scoped
 * gate in `lib/script/gate.ts`: identity, membership, scope, project.
 * Every write is `ROLE.authoredEdit` (a thread, a placement, a verdict),
 * except deleting a thread, which is `ROLE.entityOperation` because it
 * reaches every scene; `readSceneLines` is `ROLE.read` (ADR 0003 D2).
 *
 * ## Thin actions over core functions (roadmap task 4.2)
 *
 * Each action parses what it always parsed before the gate, opens the cookie
 * gate with its capability, calls its core in `core.ts` - which the agent's
 * tools and the worker call with a gate of their own - and revalidates on the
 * outcome it always did. Signatures and results are unchanged.
 *
 * ## Nothing here re-derives, and nothing here writes a node
 *
 * The route's authored things - a thread, its row order, a scene's story
 * time, a scene's threads, a verdict - are "authored data hanging off
 * derived rows" (AGENTS.md, Derivation), and none changes what the alias
 * table says or what the script says. So no write here awaits a
 * derivation pass, and none touches the node list: the timeline reads page
 * order, it never rearranges it.
 *
 * ## The bulk write is what the writer accepted, and it can be taken back
 *
 * `placeScenes` takes the placements the proposal queue showed and the
 * writer accepted whole (`Accept all`) - each read off the scene's own
 * cues by `@folio/script`'s `proposePlacements`, never a date parsed from
 * a slugline as a date - and writes each only where the scene still has
 * no day. It answers with what landed, and `unplaceScenes` is the status
 * bar's `Undo` over exactly those. The first pass's `Assume continuous`
 * wrote Day 1 to everything with no reason and no way back.
 *
 * ## What a write invalidates
 *
 * The route's own page, not the project layout: a one-cell edit here
 * changes nothing the rail's badges or another route reads.
 */

const timelinePath = (projectId: string): string => `/app/project/${projectId}/timeline`

// ---------------------------------------------------------------------------
// Story time
// ---------------------------------------------------------------------------

export const saveStoryTime = async (projectId: string, rawSceneId: string, rawEdit: unknown): Promise<SavedResult> => {
  const problem = storyTimeProblem(rawSceneId, rawEdit)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await saveStoryTimeWith(gate, rawSceneId, rawEdit)
  if (result.status === 'saved') revalidatePath(timelinePath(gate.project.id))
  return result
}

/** The queue's `Accept all`: every proposal the writer accepted, one write, only where the scene still has no day. */
export const placeScenes = async (projectId: string, rawPlacements: unknown): Promise<PlacedResult> => {
  const problem = placementsProblem(rawPlacements)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await placeScenesWith(gate, rawPlacements)
  if (result.status === 'placed') revalidatePath(timelinePath(gate.project.id))
  return result
}

/** Take a bulk placement back: the placements `placeScenes` answered with, still exactly so, go back to unplaced. */
export const unplaceScenes = async (projectId: string, rawPlacements: unknown): Promise<UnplacedResult> => {
  const problem = placementsProblem(rawPlacements)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await unplaceScenesWith(gate, rawPlacements)
  if (result.status === 'unplaced') revalidatePath(timelinePath(gate.project.id))
  return result
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export const createThread = async (projectId: string, rawEdit: unknown, rawKey: unknown = null): Promise<ThreadCreatedResult> => {
  const problem = createThreadProblem(rawEdit, rawKey)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await createThreadWith(gate, rawEdit, rawKey)
  if (result.status === 'created') revalidatePath(timelinePath(gate.project.id))
  return result
}

export const saveThread = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SavedResult> => {
  const problem = saveThreadProblem(rawId, rawEdit)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await saveThreadWith(gate, rawId, rawEdit)
  if (result.status === 'saved') revalidatePath(timelinePath(gate.project.id))
  return result
}

export const deleteThread = async (projectId: string, rawId: string): Promise<DeletedResult> => {
  const problem = threadIdProblem(rawId)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate
  const result = await deleteThreadWith(gate, rawId)
  if (result.status === 'deleted') revalidatePath(timelinePath(gate.project.id))
  return result
}

/** The sidebar's drag: the whole row order. A list that disagrees with the project's threads writes nothing. */
export const orderThreads = async (projectId: string, rawIds: unknown): Promise<SavedResult> => {
  const problem = threadOrderProblem(rawIds)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await orderThreadsWith(gate, rawIds)
  if (result.status === 'saved') revalidatePath(timelinePath(gate.project.id))
  return result
}

/** A scene's threads, whole and in order - the drawer's chips, a drop onto a row, a `×`. The first is its row. */
export const setSceneThreads = async (projectId: string, rawSceneId: string, rawIds: unknown): Promise<SavedResult> => {
  const problem = sceneThreadsProblem(rawSceneId, rawIds)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await setSceneThreadsWith(gate, rawSceneId, rawIds)
  if (result.status === 'saved') revalidatePath(timelinePath(gate.project.id))
  return result
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/** `It's deliberate` on a finding: one row, keyed on the check's key. */
export const markDeliberate = async (projectId: string, rawVerdict: unknown): Promise<SavedResult> => {
  const problem = verdictProblem(rawVerdict)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await markDeliberateWith(gate, rawVerdict)
  if (result.status === 'saved') revalidatePath(timelinePath(gate.project.id))
  return result
}

/** `Reopen`: the row goes and the finding is listed again. */
export const reopenFinding = async (projectId: string, rawKey: unknown): Promise<SavedResult> => {
  const problem = findingKeyProblem(rawKey)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const result = await reopenFindingWith(gate, rawKey)
  if (result.status === 'saved') revalidatePath(timelinePath(gate.project.id))
  return result
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

/**
 * One scene's own lines, for `Read in story order` (`readSceneLinesWith`).
 * Read when the reader turns to the scene rather than shipped with the route -
 * a series is the whole script, and the reader wants one scene at a time.
 */
export const readSceneLines = async (projectId: string, rawSceneId: string): Promise<SceneLinesResult> => {
  const problem = sceneIdProblem(rawSceneId)
  if (problem !== null) return problem
  const gate = await openProject(projectId, ROLE.read)
  if (isRefusal(gate)) return gate
  return readSceneLinesWith(gate, rawSceneId)
}

// ---------------------------------------------------------------------------
// Export (roadmap task 2.4)
// ---------------------------------------------------------------------------

/** The story chronology as Markdown, for the requesting user (`ROLE.export`, ADR 0003 D16). */
export const exportChronology = async (projectId: string): Promise<TextExportResult> => {
  const gate = await openProject(projectId, ROLE.export)
  if (isRefusal(gate)) return gate
  const read = await readContinuity({ scope: gate.scope, project: gate.project, episodes: await listEpisodes(gate.scope) })
  return { status: 'exported', ...chronologyExport(read, gate.project.title) }
}
