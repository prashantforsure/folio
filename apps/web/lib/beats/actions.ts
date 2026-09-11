'use server'

import type { DocumentRecord } from '@folio/contracts'
import { BeatTimingSchema, NodeIdSchema } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import {
  commitNodePlan,
  createDocument,
  linkBeatScene,
  mintNodeIds,
  parseOutlineRows,
  planNodeWrite,
  readDocumentByKind,
  readNodeRows,
  unlinkBeatScene,
  writeBeatTiming,
} from '@folio/db'
import type { NodeId, OutlineNode } from '@folio/script'
import { outlineBeats, text, typed, writeBeatHeadline } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import type { EpisodeGate } from '../script/gate'
import { isRefusal, openEpisode } from '../script/gate'
import type {
  AddBeatResult,
  DeleteResult,
  HeadlineResult,
  LinkResult,
  OrderResult,
  TimingResult,
} from './result'
import { loadBeats } from './server'

/**
 * The Beats route's writes.
 *
 * Two kinds, and the file keeps them apart:
 *
 * **Document writes** - add, rename, reorder, delete a beat. A beat is an
 * outline `beat` block, so each of these is an edit to the outline's node
 * list, and it goes the way every node write goes: read the stored rows,
 * build the list the writer wants, `planNodeWrite` the fewest rows that get
 * there, `commitNodePlan` in one statement with a tombstone for every id
 * that left. "Reordering here renumbers the beat sheet; it never moves a
 * scene in the script" - the bundle's own hint, and true by construction:
 * nothing here can name a screenplay node.
 *
 * **Authored writes** - a duration, a minute position, a canvas spot, a
 * scene link. These touch `beats` and `scenes.beats` and never a node. Each
 * first checks that the id it was handed is a beat block of *this*
 * episode's outline: `beats` has no foreign key to say so (`schema/beats.ts`
 * says why), so the check is here, at the gate, where every other rule is.
 *
 * Membership, not role, as everywhere. The gate is the Script route's.
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

const HeadlineSchema = z.object({
  name: z.string().max(200),
  line: z.string().max(4_000),
})

type Outline = {
  readonly document: DocumentRecord
  readonly rows: Awaited<ReturnType<typeof readNodeRows>>
  readonly nodes: readonly OutlineNode[]
}

/** The episode's outline, rows and parsed list, or a reason it cannot be written. */
const readOutline = async (gate: EpisodeGate): Promise<Outline | { readonly status: 'refused' | 'error'; readonly message: string }> => {
  const document = await readDocumentByKind(gate.scope, gate.episode.id, 'outline')
  if (document === null) return { status: 'error', message: 'This episode has no outline yet. Add a beat to start one.' }
  const rows = await readNodeRows(gate.scope, document.id)
  const parsed = parseOutlineRows(rows)
  if (!parsed.ok) return { status: 'error', message: 'The stored outline would not read. Reload to continue.' }
  return { document, rows, nodes: parsed.value.map((entry) => entry.node) }
}

const isOutline = (value: Outline | { readonly status: string }): value is Outline => 'document' in value

/** Write the outline's list back. `null` on success, else the refusal to report. */
const writeOutline = async (
  scope: ProjectScope,
  outline: Outline,
  next: readonly OutlineNode[],
): Promise<string | null> => {
  const plan = planNodeWrite(outline.rows, next)
  const written = await commitNodePlan(
    scope,
    outline.document.id,
    'outline',
    plan,
    plan.deletes.map((nodeId) => ({ nodeId, mergedInto: null })),
  )
  if ('unusable' in written) return `${String(written.unusable.length)} id(s) were already used. Reload to continue.`
  return null
}

const beatIn = (outline: Outline, id: string): OutlineNode | null =>
  outline.nodes.find((node) => node.type === 'beat' && node.id === id) ?? null

// ---------------------------------------------------------------------------
// Document writes
// ---------------------------------------------------------------------------

/**
 * Add a beat. After the last beat block when there is one - beats stay
 * together - else at the end of the outline; and when there is no outline
 * at all, the document is created with this beat as its first block.
 */
export const addBeat = async (
  projectId: string,
  episode: string,
  rawHeadline: { readonly name: string; readonly line: string },
): Promise<AddBeatResult> => {
  const headline = HeadlineSchema.safeParse(rawHeadline)
  if (!headline.success) return { status: 'error', message: 'A beat is a name and a line.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

  const [id] = await mintNodeIds(scope, 1)
  if (id === undefined) return { status: 'error', message: 'No id could be minted.' }
  const block: OutlineNode = { type: 'beat', id, provenance: typed(), content: [text(writeBeatHeadline(headline.data))] }

  let document = await readDocumentByKind(scope, gate.episode.id, 'outline')
  if (document === null) {
    document = await createDocument(scope, gate.episode.id, 'outline', gate.episode.title)
    const rows = await readNodeRows(scope, document.id)
    const refusal = await writeOutline(scope, { document, rows, nodes: [] }, [block])
    if (refusal !== null) return { status: 'error', message: refusal }
  } else {
    const outline = await readOutline(gate)
    if (!isOutline(outline)) return outline
    const beats = outlineBeats(outline.nodes)
    const last = beats[beats.length - 1]
    const at = last === undefined ? outline.nodes.length : outline.nodes.findIndex((node) => node.id === last.id) + 1
    const next = [...outline.nodes.slice(0, at), block, ...outline.nodes.slice(at)]
    const refusal = await writeOutline(scope, outline, next)
    if (refusal !== null) return { status: 'error', message: refusal }
  }

  const load = await loadBeats(scope, project, gate.episode)
  if (load.state !== 'beats') return { status: 'error', message: 'The beat was written but the sheet would not read back.' }
  const beat = load.beats.find((entry) => entry.beatNodeId === id)
  if (beat === undefined) return { status: 'error', message: 'The beat was written but is not on the sheet.' }
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'added', beat, beats: load.beats }
}

/** Rename a beat or rewrite its line: the block's text becomes `Name: line`. */
export const saveBeatHeadline = async (
  projectId: string,
  episode: string,
  rawBeatNodeId: string,
  rawHeadline: { readonly name: string; readonly line: string },
): Promise<HeadlineResult> => {
  const id = NodeIdSchema.safeParse(rawBeatNodeId)
  const headline = HeadlineSchema.safeParse(rawHeadline)
  if (!id.success || !headline.success) return { status: 'error', message: 'A beat is a name and a line.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate

  const outline = await readOutline(gate)
  if (!isOutline(outline)) return outline
  const block = beatIn(outline, id.data)
  if (block === null) return { status: 'error', message: 'That beat is not in this outline. Reload the sheet.' }
  const written = writeBeatHeadline(headline.data)
  const next = outline.nodes.map((node) => (node.id === id.data ? { ...block, content: [text(written)] } : node))
  const refusal = await writeOutline(gate.scope, outline, next)
  if (refusal !== null) return { status: 'error', message: refusal }
  return { status: 'saved', text: written }
}

/**
 * Move a beat one place up or down among the beat blocks. The block moves
 * to the other beat's position in the outline, so two beats separated by a
 * heading swap across it; the heading stays where it was.
 */
export const moveBeat = async (
  projectId: string,
  episode: string,
  rawBeatNodeId: string,
  direction: 'up' | 'down',
): Promise<OrderResult> => {
  const id = NodeIdSchema.safeParse(rawBeatNodeId)
  if (!id.success || (direction !== 'up' && direction !== 'down')) {
    return { status: 'error', message: 'Move a beat up or down.' }
  }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

  const outline = await readOutline(gate)
  if (!isOutline(outline)) return outline
  const beats = outlineBeats(outline.nodes)
  const at = beats.findIndex((beat) => beat.id === id.data)
  if (at === -1) return { status: 'error', message: 'That beat is not in this outline. Reload the sheet.' }
  const neighbour = beats[direction === 'up' ? at - 1 : at + 1]
  if (neighbour === undefined) {
    const load = await loadBeats(scope, project, gate.episode)
    return load.state === 'beats' ? { status: 'saved', beats: load.beats } : { status: 'error', message: 'The sheet would not read back.' }
  }

  const moving = outline.nodes.find((node) => node.id === id.data)
  if (moving === undefined) return { status: 'error', message: 'That beat is not in this outline. Reload the sheet.' }
  const without = outline.nodes.filter((node) => node.id !== id.data)
  const target = without.findIndex((node) => node.id === neighbour.id)
  const insertAt = direction === 'up' ? target : target + 1
  const next = [...without.slice(0, insertAt), moving, ...without.slice(insertAt)]
  const refusal = await writeOutline(scope, outline, next)
  if (refusal !== null) return { status: 'error', message: refusal }

  const load = await loadBeats(scope, project, gate.episode)
  if (load.state !== 'beats') return { status: 'error', message: 'The sheet would not read back.' }
  return { status: 'saved', beats: load.beats }
}

/** Delete a beat block. Its `beats` row and links are left where they are, unreachable, for undo. */
export const deleteBeat = async (projectId: string, episode: string, rawBeatNodeId: string): Promise<DeleteResult> => {
  const id = NodeIdSchema.safeParse(rawBeatNodeId)
  if (!id.success) return { status: 'error', message: 'That beat could not be found.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

  const outline = await readOutline(gate)
  if (!isOutline(outline)) return outline
  if (beatIn(outline, id.data) === null) return { status: 'error', message: 'That beat is not in this outline. Reload the sheet.' }
  const refusal = await writeOutline(
    scope,
    outline,
    outline.nodes.filter((node) => node.id !== id.data),
  )
  if (refusal !== null) return { status: 'error', message: refusal }

  const load = await loadBeats(scope, project, gate.episode)
  if (load.state !== 'beats') return { status: 'error', message: 'The sheet would not read back.' }
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'deleted', beats: load.beats }
}

// ---------------------------------------------------------------------------
// Authored writes
// ---------------------------------------------------------------------------

/** Set a beat's duration, its place on the timeline, and its canvas spot - whole. */
export const saveBeatTiming = async (
  projectId: string,
  episode: string,
  rawBeatNodeId: string,
  rawTiming: unknown,
): Promise<TimingResult> => {
  const id = NodeIdSchema.safeParse(rawBeatNodeId)
  const timing = BeatTimingSchema.safeParse(rawTiming)
  if (!id.success || !timing.success) return { status: 'error', message: 'Minutes are whole numbers, never negative.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate

  const outline = await readOutline(gate)
  if (!isOutline(outline)) return outline
  if (beatIn(outline, id.data) === null) return { status: 'error', message: 'That beat is not in this outline. Reload the sheet.' }
  const row = await writeBeatTiming(gate.scope, id.data as NodeId, timing.data)
  return {
    status: 'saved',
    timing: { durationMinutes: row.durationMinutes, placedAtMinute: row.placedAtMinute, canvas: row.canvas },
  }
}

const linkOrUnlink = async (
  projectId: string,
  episode: string,
  rawBeatNodeId: string,
  rawSceneNodeId: string,
  write: typeof linkBeatScene,
): Promise<LinkResult> => {
  const beat = NodeIdSchema.safeParse(rawBeatNodeId)
  const scene = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!beat.success || !scene.success) return { status: 'error', message: 'A link is a beat and a scene.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate

  const outline = await readOutline(gate)
  if (!isOutline(outline)) return outline
  if (beatIn(outline, beat.data) === null) return { status: 'error', message: 'That beat is not in this outline. Reload the sheet.' }
  const written = await write(gate.scope, beat.data as NodeId, scene.data as NodeId)
  if (!written) return { status: 'error', message: 'That scene has no record in this project. Reload the sheet.' }
  return { status: 'saved' }
}

/** Name a scene as delivering a beat. */
export const linkScene = async (projectId: string, episode: string, beatNodeId: string, sceneNodeId: string): Promise<LinkResult> =>
  linkOrUnlink(projectId, episode, beatNodeId, sceneNodeId, linkBeatScene)

/** Take a scene off a beat. */
export const unlinkScene = async (projectId: string, episode: string, beatNodeId: string, sceneNodeId: string): Promise<LinkResult> =>
  linkOrUnlink(projectId, episode, beatNodeId, sceneNodeId, unlinkBeatScene)
