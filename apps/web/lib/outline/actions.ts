'use server'

import { OutlineNodeSchema } from '@folio/contracts'
import {
  commitNodePlan,
  createDocument,
  mintNodeIds,
  parseOutlineRows,
  planNodeWrite,
  readDocumentById,
  readDocumentByKind,
  readNodeRows,
  replaceNodes,
  snapshotVersion,
} from '@folio/db'
import type { DocumentId, NodeId, OutlineNode } from '@folio/script'
import { text, typed } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isRefusal, openEpisode, openEpisodeWith } from '../script/gate'
import type { SimpleResult } from '../script/result'
import type { SaveOutlineResult } from './result'

/**
 * The Outline route's writes. The document is its own; nothing here reads
 * or writes a screenplay node, and nothing here paginates or derives.
 *
 * ## The whole list, every save
 *
 * The Script route sends a delta because a feature is half a megabyte. An
 * outline is a page or two of prose - tens of blocks - so the client sends
 * the list it holds, whole, and the server plans the fewest rows that turn
 * the stored list into it (`planNodeWrite`) and writes them in one
 * statement (`commitNodePlan`, with the tombstones for every id that left).
 * The rows are read beside the gate, so a save is the gate's round trip,
 * the write, and nothing after it.
 *
 * Last-write-wins with a conflict banner, as the script: the client sends
 * the `documents.updated_at` it last saw and the write still lands when the
 * row has moved on; the result names both stamps.
 *
 * ## What a save reports back
 *
 * The nav's `Outline` row prints `N acts` (the H1 count), read from this
 * document. The save returns the count from the list it just wrote so the
 * workspace can keep the row in the nav honest without a `revalidatePath`
 * over the whole layout on every keystroke.
 */

const RetirementSchema = z.object({
  nodeId: z.string().min(1),
  mergedInto: z.string().min(1).nullable(),
})

const SaveOutlineInputSchema = z.object({
  projectId: z.string(),
  episode: z.string(),
  documentId: z.string().uuid(),
  baseUpdatedAt: z.string(),
  nodes: z.array(OutlineNodeSchema).max(5_000),
  retirements: z.array(RetirementSchema),
  snapshot: z.boolean(),
})

export type SaveOutlineInput = z.input<typeof SaveOutlineInputSchema>

const invalid = (message: string): SaveOutlineResult => ({
  status: 'invalid',
  message: `The outline did not read as a block list (${message}).`,
})

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

export const saveOutline = async (raw: SaveOutlineInput): Promise<SaveOutlineResult> => {
  const parsed = SaveOutlineInputSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return invalid(issue === undefined ? 'shape' : `${issue.path.join('.')}: ${issue.message}`)
  }
  const input = parsed.data
  const documentId = input.documentId as DocumentId

  const gate = await openEpisodeWith(input.projectId, input.episode, async (scope) => {
    const [document, rows] = await Promise.all([readDocumentById(scope, documentId), readNodeRows(scope, documentId)])
    return { document, rows }
  })
  if (isRefusal(gate)) return gate
  const { scope, episode } = gate
  const { document, rows } = gate.extra

  if (document === null || document.episodeId !== episode.id || document.kind !== 'outline') {
    return { status: 'refused', message: 'That outline no longer exists. Reload to continue.' }
  }
  if (!parseOutlineRows(rows).ok) {
    return { status: 'refused', message: 'The stored outline would not read. Reload to continue.' }
  }

  const next: readonly OutlineNode[] = input.nodes
  const seen = new Set<string>()
  for (const node of next) {
    if (seen.has(node.id)) return invalid(`block ${node.id} appears twice`)
    seen.add(node.id)
  }

  const conflict =
    document.updatedAt === input.baseUpdatedAt ? null : { expected: input.baseUpdatedAt, found: document.updatedAt }

  const plan = planNodeWrite(rows, next)
  const mergedInto = new Map(input.retirements.map((entry) => [entry.nodeId, entry.mergedInto]))
  const tombstones = plan.deletes.map((nodeId) => {
    const survivor = mergedInto.get(nodeId as string) ?? null
    return { nodeId, mergedInto: survivor === null ? null : (survivor as NodeId) }
  })

  const [written, snapshot] = await Promise.all([
    commitNodePlan(scope, document.id, 'outline', plan, tombstones),
    input.snapshot
      ? snapshotVersion(scope, document.id, 'manual', next, next.length).then(() => true)
      : Promise.resolve(false),
  ])
  if ('unusable' in written) return { status: 'ids-unusable', ids: written.unusable }

  return {
    status: 'saved',
    updatedAt: written.updatedAt,
    conflict,
    snapshotTaken: snapshot,
    acts: next.filter((node) => node.type === 'h1').length,
  }
}

/**
 * Start a blank outline: the document row and one empty body block, so the
 * writer lands on the caret line the empty state promised.
 */
export const createBlankOutline = async (projectId: string, episode: string): Promise<SimpleResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

  const already = await readDocumentByKind(scope, gate.episode.id, 'outline')
  if (already !== null) return { status: 'done' }

  const document = await createDocument(scope, gate.episode.id, 'outline', gate.episode.title)
  const [id] = await mintNodeIds(scope, 1)
  if (id === undefined) return { status: 'error', message: 'No id could be minted.' }
  const nodes: readonly OutlineNode[] = [{ type: 'body', id, provenance: typed(), content: [text('')] }]
  await replaceNodes(scope, document.id, 'outline', nodes)
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'done' }
}
