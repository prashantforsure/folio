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
import { z } from 'zod'

import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import { cutExcerpts } from '../scenes/excerpt'
import type { ProjectGate } from '../script/actor-gate'
import { roleRefusal } from '../script/actor-gate'
import type { DeletedResult, PlacedResult, SavedResult, SceneLinesResult, ThreadCreatedResult, UnplacedResult } from './result'

/**
 * The Timeline route's writes as **core functions** - roadmap task 4.2.
 *
 * Each takes a gate already opened and the same raw input its action takes,
 * checks the role itself (a tool's gate was opened for the turn, not for this
 * write), parses, writes and answers. The actions in `actions.ts` open the
 * cookie gate, call these, and revalidate the route; the agent's tools and the
 * worker call these with a gate they opened as a known person
 * (`lib/script/actor-gate.ts`). No cookie, no `revalidatePath`, no Next.
 *
 * Every parse the actions run **before** their gate is exported here
 * (`*Problem`), so an action refuses bad input before asking who is signed in,
 * exactly as it did, and a core refuses it the same way when a tool sends it.
 */

export const REFUSED_SCENE = 'That scene could not be found.'
const REFUSED_THREAD = 'That thread could not be found.'
const UNREADABLE = 'That edit could not be read.'
const THREAD_SHAPE = 'A thread needs a name, up to 80 characters.'

type Problem = { readonly status: 'error'; readonly message: string }

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

export const storyTimeProblem = (rawSceneId: unknown, rawEdit: unknown): Problem | null => {
  const edit = StoryTimeEditSchema.safeParse(rawEdit)
  if (parseSceneId(rawSceneId) === null) return { status: 'error', message: REFUSED_SCENE }
  if (!edit.success) return { status: 'error', message: edit.error.issues[0]?.message ?? UNREADABLE }
  return null
}

export const saveStoryTimeWith = async (gate: ProjectGate, rawSceneId: unknown, rawEdit: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const sceneNodeId = parseSceneId(rawSceneId)
  const edit = StoryTimeEditSchema.safeParse(rawEdit)
  if (sceneNodeId === null) return { status: 'error', message: REFUSED_SCENE }
  if (!edit.success) return { status: 'error', message: edit.error.issues[0]?.message ?? UNREADABLE }

  const written = await writeStoryTime(gate.scope, sceneNodeId, edit.data)
  if (!written) return { status: 'error', message: REFUSED_SCENE }
  return { status: 'saved' }
}

export const placementsProblem = (rawPlacements: unknown): Problem | null =>
  PlacementsSchema.safeParse(rawPlacements).success ? null : { status: 'error', message: UNREADABLE }

/** The queue's `Accept all`: every proposal the writer accepted, one write, only where the scene still has no day. */
export const placeScenesWith = async (gate: ProjectGate, rawPlacements: unknown): Promise<PlacedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const placements = PlacementsSchema.safeParse(rawPlacements)
  if (!placements.success) return { status: 'error', message: UNREADABLE }
  const landed = await placeScenesNow(gate.scope, placements.data)
  return { status: 'placed', placements: landed }
}

/** Take a bulk placement back: the placements `placeScenes` answered with, still exactly so, go back to unplaced. */
export const unplaceScenesWith = async (gate: ProjectGate, rawPlacements: unknown): Promise<UnplacedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const placements = PlacementsSchema.safeParse(rawPlacements)
  if (!placements.success) return { status: 'error', message: UNREADABLE }
  const scenes = await unplaceScenesNow(gate.scope, placements.data)
  return { status: 'unplaced', scenes }
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export const createThreadProblem = (rawEdit: unknown, rawKey: unknown): Problem | null => {
  if (!StoryThreadEditSchema.safeParse(rawEdit).success) return { status: 'error', message: THREAD_SHAPE }
  if (!idempotencyKeyOf(rawKey).ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  return null
}

export const createThreadWith = async (gate: ProjectGate, rawEdit: unknown, rawKey: unknown = null): Promise<ThreadCreatedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const edit = StoryThreadEditSchema.safeParse(rawEdit)
  if (!edit.success) return { status: 'error', message: THREAD_SHAPE }
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  const id = await createStoryThread(gate.scope, edit.data, key.key)
  return { status: 'created', id }
}

export const saveThreadProblem = (rawId: unknown, rawEdit: unknown): Problem | null => {
  if (parseThreadId(rawId) === null) return { status: 'error', message: REFUSED_THREAD }
  if (!StoryThreadEditSchema.safeParse(rawEdit).success) return { status: 'error', message: THREAD_SHAPE }
  return null
}

export const saveThreadWith = async (gate: ProjectGate, rawId: unknown, rawEdit: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const id = parseThreadId(rawId)
  const edit = StoryThreadEditSchema.safeParse(rawEdit)
  if (id === null) return { status: 'error', message: REFUSED_THREAD }
  if (!edit.success) return { status: 'error', message: THREAD_SHAPE }
  const written = await updateStoryThread(gate.scope, id, edit.data)
  if (!written) return { status: 'error', message: REFUSED_THREAD }
  return { status: 'saved' }
}

export const threadIdProblem = (rawId: unknown): Problem | null => (parseThreadId(rawId) === null ? { status: 'error', message: REFUSED_THREAD } : null)

export const deleteThreadWith = async (gate: ProjectGate, rawId: unknown): Promise<DeletedResult> => {
  const refused = roleRefusal(gate, ROLE.entityOperation)
  if (refused !== null) return refused
  const id = parseThreadId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_THREAD }
  const deleted = await deleteStoryThread(gate.scope, id)
  if (!deleted) return { status: 'error', message: REFUSED_THREAD }
  return { status: 'deleted' }
}

export const threadOrderProblem = (rawIds: unknown): Problem | null =>
  ThreadOrderSchema.safeParse(rawIds).success ? null : { status: 'error', message: UNREADABLE }

/** The sidebar's drag: the whole row order. A list that disagrees with the project's threads writes nothing. */
export const orderThreadsWith = async (gate: ProjectGate, rawIds: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const ids = ThreadOrderSchema.safeParse(rawIds)
  if (!ids.success) return { status: 'error', message: UNREADABLE }
  const written = await orderStoryThreads(gate.scope, ids.data)
  if (!written) return { status: 'error', message: 'The threads changed under you. Reload and try again.' }
  return { status: 'saved' }
}

export const sceneThreadsProblem = (rawSceneId: unknown, rawIds: unknown): Problem | null => {
  if (parseSceneId(rawSceneId) === null) return { status: 'error', message: REFUSED_SCENE }
  if (!SceneThreadsSchema.safeParse(rawIds).success) return { status: 'error', message: UNREADABLE }
  return null
}

/** A scene's threads, whole and in order - the drawer's chips, a drop onto a row, a `×`. The first is its row. */
export const setSceneThreadsWith = async (gate: ProjectGate, rawSceneId: unknown, rawIds: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const sceneNodeId = parseSceneId(rawSceneId)
  const ids = SceneThreadsSchema.safeParse(rawIds)
  if (sceneNodeId === null) return { status: 'error', message: REFUSED_SCENE }
  if (!ids.success) return { status: 'error', message: UNREADABLE }
  const written = await writeSceneThreads(gate.scope, sceneNodeId, ids.data)
  if (!written) return { status: 'error', message: 'That scene or one of those threads could not be found.' }
  return { status: 'saved' }
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export const verdictProblem = (rawVerdict: unknown): Problem | null =>
  FindingVerdictSchema.safeParse(rawVerdict).success ? null : { status: 'error', message: UNREADABLE }

/** `It's deliberate` on a finding: one row, keyed on the check's key. */
export const markDeliberateWith = async (gate: ProjectGate, rawVerdict: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const verdict = FindingVerdictSchema.safeParse(rawVerdict)
  if (!verdict.success) return { status: 'error', message: UNREADABLE }
  await markFindingDeliberate(gate.scope, verdict.data)
  return { status: 'saved' }
}

const FindingKeySchema = z.string().min(1).max(200)

export const findingKeyProblem = (rawKey: unknown): Problem | null =>
  FindingKeySchema.safeParse(rawKey).success ? null : { status: 'error', message: UNREADABLE }

/** `Reopen`: the row goes and the finding is listed again. */
export const reopenFindingWith = async (gate: ProjectGate, rawKey: unknown): Promise<SavedResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const key = FindingKeySchema.safeParse(rawKey)
  if (!key.success) return { status: 'error', message: UNREADABLE }
  await reopenFindingNow(gate.scope, key.data)
  return { status: 'saved' }
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

export const sceneIdProblem = (rawSceneId: unknown): Problem | null => (parseSceneId(rawSceneId) === null ? { status: 'error', message: REFUSED_SCENE } : null)

/**
 * One scene's own lines, for `Read in story order`: the heading and every
 * renderable node under it, as the Scenes route's reading modal draws them
 * (`lib/scenes/excerpt.ts`, the same cut).
 */
export const readSceneLinesWith = async (gate: ProjectGate, rawSceneId: unknown): Promise<SceneLinesResult> => {
  const refused = roleRefusal(gate, ROLE.read)
  if (refused !== null) return refused
  const sceneNodeId = parseSceneId(rawSceneId)
  if (sceneNodeId === null) return { status: 'error', message: REFUSED_SCENE }

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
