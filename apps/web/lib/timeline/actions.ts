'use server'

import { FindingVerdictSchema, NodeIdSchema, PlacementsSchema, SceneThreadsSchema, StoryThreadEditSchema, StoryThreadIdSchema, StoryTimeEditSchema, ThreadOrderSchema } from '@folio/contracts'
import type { StoryThreadId } from '@folio/contracts'
import {
  createStoryThread,
  deleteStoryThread,
  listTimelineScenes,
  markFindingDeliberate,
  orderStoryThreads,
  placeScenes as placeScenesNow,
  readMentionLabels,
  readScreenplayNodes,
  reopenFinding as reopenFindingNow,
  unplaceScenes as unplaceScenesNow,
  updateStoryThread,
  writeSceneThreads,
  writeStoryTime,
} from '@folio/db'
import type { NodeId } from '@folio/script'
import { labelBook } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { cutExcerpts } from '../scenes/excerpt'
import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import { isRefusal, openProject } from '../script/gate'
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

const REFUSED_SCENE = 'That scene could not be found.'
const REFUSED_THREAD = 'That thread could not be found.'
const UNREADABLE = 'That edit could not be read.'
const THREAD_SHAPE = 'A thread needs a name, up to 80 characters.'

const parseSceneId = (raw: unknown): NodeId | null => {
  const parsed = NodeIdSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

const parseThreadId = (raw: unknown): StoryThreadId | null => {
  const parsed = StoryThreadIdSchema.safeParse(typeof raw === 'string' ? raw : '')
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// Story time
// ---------------------------------------------------------------------------

export const saveStoryTime = async (projectId: string, rawSceneId: string, rawEdit: unknown): Promise<SavedResult> => {
  const sceneNodeId = parseSceneId(rawSceneId)
  const edit = StoryTimeEditSchema.safeParse(rawEdit)
  if (sceneNodeId === null) return { status: 'error', message: REFUSED_SCENE }
  if (!edit.success) {
    return { status: 'error', message: edit.error.issues[0]?.message ?? UNREADABLE }
  }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  const written = await writeStoryTime(gate.scope, sceneNodeId, edit.data)
  if (!written) return { status: 'error', message: REFUSED_SCENE }
  revalidatePath(timelinePath(gate.project.id))
  return { status: 'saved' }
}

/** The queue's `Accept all`: every proposal the writer accepted, one write, only where the scene still has no day. */
export const placeScenes = async (projectId: string, rawPlacements: unknown): Promise<PlacedResult> => {
  const placements = PlacementsSchema.safeParse(rawPlacements)
  if (!placements.success) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  const landed = await placeScenesNow(gate.scope, placements.data)
  revalidatePath(timelinePath(gate.project.id))
  return { status: 'placed', placements: landed }
}

/** Take a bulk placement back: the placements `placeScenes` answered with, still exactly so, go back to unplaced. */
export const unplaceScenes = async (projectId: string, rawPlacements: unknown): Promise<UnplacedResult> => {
  const placements = PlacementsSchema.safeParse(rawPlacements)
  if (!placements.success) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  const scenes = await unplaceScenesNow(gate.scope, placements.data)
  revalidatePath(timelinePath(gate.project.id))
  return { status: 'unplaced', scenes }
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export const createThread = async (projectId: string, rawEdit: unknown, rawKey: unknown = null): Promise<ThreadCreatedResult> => {
  const edit = StoryThreadEditSchema.safeParse(rawEdit)
  if (!edit.success) return { status: 'error', message: THREAD_SHAPE }
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  const id = await createStoryThread(gate.scope, edit.data, key.key)
  revalidatePath(timelinePath(gate.project.id))
  return { status: 'created', id }
}

export const saveThread = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SavedResult> => {
  const id = parseThreadId(rawId)
  const edit = StoryThreadEditSchema.safeParse(rawEdit)
  if (id === null) return { status: 'error', message: REFUSED_THREAD }
  if (!edit.success) return { status: 'error', message: THREAD_SHAPE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  const written = await updateStoryThread(gate.scope, id, edit.data)
  if (!written) return { status: 'error', message: REFUSED_THREAD }
  revalidatePath(timelinePath(gate.project.id))
  return { status: 'saved' }
}

export const deleteThread = async (projectId: string, rawId: string): Promise<DeletedResult> => {
  const id = parseThreadId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_THREAD }
  const gate = await openProject(projectId, ROLE.entityOperation)
  if (isRefusal(gate)) return gate

  const deleted = await deleteStoryThread(gate.scope, id)
  if (!deleted) return { status: 'error', message: REFUSED_THREAD }
  revalidatePath(timelinePath(gate.project.id))
  return { status: 'deleted' }
}

/** The sidebar's drag: the whole row order. A list that disagrees with the project's threads writes nothing. */
export const orderThreads = async (projectId: string, rawIds: unknown): Promise<SavedResult> => {
  const ids = ThreadOrderSchema.safeParse(rawIds)
  if (!ids.success) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  const written = await orderStoryThreads(gate.scope, ids.data)
  if (!written) return { status: 'error', message: 'The threads changed under you. Reload and try again.' }
  revalidatePath(timelinePath(gate.project.id))
  return { status: 'saved' }
}

/** A scene's threads, whole and in order - the drawer's chips, a drop onto a row, a `×`. The first is its row. */
export const setSceneThreads = async (projectId: string, rawSceneId: string, rawIds: unknown): Promise<SavedResult> => {
  const sceneNodeId = parseSceneId(rawSceneId)
  const ids = SceneThreadsSchema.safeParse(rawIds)
  if (sceneNodeId === null) return { status: 'error', message: REFUSED_SCENE }
  if (!ids.success) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  const written = await writeSceneThreads(gate.scope, sceneNodeId, ids.data)
  if (!written) return { status: 'error', message: 'That scene or one of those threads could not be found.' }
  revalidatePath(timelinePath(gate.project.id))
  return { status: 'saved' }
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/** `It's deliberate` on a finding: one row, keyed on the check's key. */
export const markDeliberate = async (projectId: string, rawVerdict: unknown): Promise<SavedResult> => {
  const verdict = FindingVerdictSchema.safeParse(rawVerdict)
  if (!verdict.success) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  await markFindingDeliberate(gate.scope, verdict.data)
  revalidatePath(timelinePath(gate.project.id))
  return { status: 'saved' }
}

/** `Reopen`: the row goes and the finding is listed again. */
export const reopenFinding = async (projectId: string, rawKey: unknown): Promise<SavedResult> => {
  const key = z.string().min(1).max(200).safeParse(rawKey)
  if (!key.success) return { status: 'error', message: UNREADABLE }
  const gate = await openProject(projectId, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate

  await reopenFindingNow(gate.scope, key.data)
  revalidatePath(timelinePath(gate.project.id))
  return { status: 'saved' }
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

/**
 * One scene's own lines, for `Read in story order`: the heading and every
 * renderable node under it, as the Scenes route's reading modal draws
 * them (`lib/scenes/excerpt.ts`, the same cut). Read when the reader
 * turns to the scene rather than shipped with the route - a series is the
 * whole script, and the reader wants one scene at a time.
 */
export const readSceneLines = async (projectId: string, rawSceneId: string): Promise<SceneLinesResult> => {
  const sceneNodeId = parseSceneId(rawSceneId)
  if (sceneNodeId === null) return { status: 'error', message: REFUSED_SCENE }
  const gate = await openProject(projectId, ROLE.read)
  if (isRefusal(gate)) return gate

  const scenes = await listTimelineScenes(gate.scope, gate.project.format)
  const record = scenes.find((scene) => scene.sceneNodeId === sceneNodeId)
  if (record === undefined) return { status: 'error', message: REFUSED_SCENE }
  const [read, labels] = await Promise.all([readScreenplayNodes(gate.scope, record.documentId), readMentionLabels(gate.scope)])
  if (!read.ok) return { status: 'error', message: 'That scene could not be read.' }
  const present = scenes.filter((scene) => scene.documentId === record.documentId).map((scene) => scene.sceneNodeId)
  const { excerpts } = cutExcerpts(
    read.value.map((entry) => entry.node),
    present,
    labelBook(labels),
  )
  const excerpt = excerpts.get(sceneNodeId)
  return excerpt === undefined ? { status: 'error', message: REFUSED_SCENE } : { status: 'ok', lines: excerpt.lines }
}
