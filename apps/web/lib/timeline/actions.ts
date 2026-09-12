'use server'

import { NodeIdSchema, StoryThreadEditSchema, StoryThreadIdSchema, StoryTimeEditSchema } from '@folio/contracts'
import type { StoryThreadId } from '@folio/contracts'
import {
  createStoryThread,
  deleteStoryThread,
  linkSceneThread,
  listTimelineScenes,
  placeUnplacedScenes,
  unlinkSceneThread,
  updateStoryThread,
  writeStoryTime,
} from '@folio/db'
import type { NodeId } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isRefusal, openProject } from '../script/gate'
import type { DeletedResult, PlacedResult, SavedResult, ThreadCreatedResult } from './result'

/**
 * The Timeline route's writes.
 *
 * Every one goes gate -> repository -> result, through the project-scoped
 * gate in `lib/script/gate.ts`: identity, membership, scope, project.
 * Membership, not role - unchanged from every earlier phase and flagged
 * again.
 *
 * ## Nothing here re-derives, and nothing here writes a node
 *
 * Both of the route's authored things - a thread, a scene's story time -
 * are "authored data hanging off derived rows" (AGENTS.md, Derivation),
 * and neither changes what the alias table says or what the script says.
 * So no write here awaits a derivation pass, and none touches the node
 * list: the timeline reads page order, it never rearranges it. The bundle's
 * "Swap on the page" would be a node write and is not built.
 *
 * ## The one bulk write is explicit, not a guess
 *
 * `placeScenes` is "Assume continuous" and "Continue from Day N": every
 * scene with no story time is given one day, no clock, in one statement.
 * That is the writer saying "treat these as one day until I say
 * otherwise" - a declared assumption, which the brief allows, not a date
 * parsed from a slugline, which it forbids. A scene already placed is not
 * touched, and it puts nothing in the continuity report: one day with no
 * clocks has no order to disagree with.
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

const REFUSED_SCENE = 'That scene could not be found.'
const REFUSED_THREAD = 'That thread could not be found.'
const UNREADABLE = 'That edit could not be read.'

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

export const saveStoryTime = async (
  projectId: string,
  rawSceneId: string,
  rawEdit: unknown,
): Promise<SavedResult> => {
  const sceneNodeId = parseSceneId(rawSceneId)
  const edit = StoryTimeEditSchema.safeParse(rawEdit)
  if (sceneNodeId === null) return { status: 'error', message: REFUSED_SCENE }
  if (!edit.success) {
    return { status: 'error', message: edit.error.issues[0]?.message ?? UNREADABLE }
  }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const written = await writeStoryTime(gate.scope, sceneNodeId, edit.data)
  if (!written) return { status: 'error', message: REFUSED_SCENE }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

const DaySchema = z.number().int().min(-100_000).max(100_000)

/**
 * Give every unplaced present scene the same day. The scenes are read
 * through the gate's scope, never taken from the client: the client says
 * which day, the server decides which scenes.
 */
export const placeScenes = async (projectId: string, rawDay: unknown): Promise<PlacedResult> => {
  const day = DaySchema.safeParse(rawDay)
  if (!day.success) return { status: 'error', message: 'A day is a whole number.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const scenes = await listTimelineScenes(gate.scope, gate.project.format)
  const unplaced = scenes.filter((scene) => scene.storyDay === null).map((scene) => scene.sceneNodeId)
  const placed = await placeUnplacedScenes(gate.scope, unplaced, day.data)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'placed', scenes: placed }
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export const createThread = async (projectId: string, rawEdit: unknown): Promise<ThreadCreatedResult> => {
  const edit = StoryThreadEditSchema.safeParse(rawEdit)
  if (!edit.success) return { status: 'error', message: 'A thread needs a name, up to 80 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const id = await createStoryThread(gate.scope, edit.data)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'created', id }
}

export const saveThread = async (projectId: string, rawId: string, rawEdit: unknown): Promise<SavedResult> => {
  const id = parseThreadId(rawId)
  const edit = StoryThreadEditSchema.safeParse(rawEdit)
  if (id === null) return { status: 'error', message: REFUSED_THREAD }
  if (!edit.success) return { status: 'error', message: 'A thread needs a name, up to 80 characters.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const written = await updateStoryThread(gate.scope, id, edit.data)
  if (!written) return { status: 'error', message: REFUSED_THREAD }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const deleteThread = async (projectId: string, rawId: string): Promise<DeletedResult> => {
  const id = parseThreadId(rawId)
  if (id === null) return { status: 'error', message: REFUSED_THREAD }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const deleted = await deleteStoryThread(gate.scope, id)
  if (!deleted) return { status: 'error', message: REFUSED_THREAD }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'deleted' }
}

export const linkThread = async (projectId: string, rawSceneId: string, rawThreadId: string): Promise<SavedResult> => {
  const sceneNodeId = parseSceneId(rawSceneId)
  const threadId = parseThreadId(rawThreadId)
  if (sceneNodeId === null) return { status: 'error', message: REFUSED_SCENE }
  if (threadId === null) return { status: 'error', message: REFUSED_THREAD }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const written = await linkSceneThread(gate.scope, sceneNodeId, threadId)
  if (!written) return { status: 'error', message: REFUSED_SCENE }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}

export const unlinkThread = async (projectId: string, rawSceneId: string, rawThreadId: string): Promise<SavedResult> => {
  const sceneNodeId = parseSceneId(rawSceneId)
  const threadId = parseThreadId(rawThreadId)
  if (sceneNodeId === null) return { status: 'error', message: REFUSED_SCENE }
  if (threadId === null) return { status: 'error', message: REFUSED_THREAD }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate

  const written = await unlinkSceneThread(gate.scope, sceneNodeId, threadId)
  if (!written) return { status: 'error', message: REFUSED_SCENE }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}
