'use server'

import type { TextExportResult } from '../workspace/export'
import { openEpisode } from '../script/gate'
import { outlineExport } from './server'

import { OutlineNodeSchema } from '@folio/contracts'
import type { DocumentRecord } from '@folio/contracts'
import {
  commitNodePlan,
  createDocument,
  parseOutlineRows,
  planNodeWrite,
  readDocumentById,
  readDocumentByKind,
  readNodeRows,
  snapshotVersion,
} from '@folio/db'
import type { DocumentId, NodeId, OutlineNode } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../auth/roles'
import { isRefusal, openEpisodeWith } from '../script/gate'
import { nodeDigest } from '../script/server'
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
 * ## The first save creates the document
 *
 * There is no "Start the outline" button (removed 2026-09-13 on the user's
 * instruction): the empty state is the editor over one blank Body block,
 * and the writer just types. So the first save arrives with
 * `documentId: null`, and this creates the `kind = 'outline'` document row
 * before planning the write against no rows - or finds one another tab
 * created in the meantime and plans against its rows. The result carries
 * the document's id and stamps so the workspace saves into it from then on.
 * No `revalidatePath`: the workspace writes the nav's row itself, and a
 * layout refresh mid-typing would hand the editor back its own document.
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
  /** `null` on the first save of an outline that does not exist yet. */
  documentId: z.string().uuid().nullable(),
  baseUpdatedAt: z.string(),
  nodes: z.array(OutlineNodeSchema).max(5_000),
  retirements: z.array(RetirementSchema),
  snapshot: z.boolean(),
  /**
   * The `nodeDigest` of the stored list this save was planned against. Absent
   * on every save the editor makes, and then nothing changes; present and
   * disagreeing, and nothing is written (ADR 0003 **D10**). The Script route's
   * field, the same function, for the same reason.
   */
  expectedDigest: z.string().min(1).optional(),
})

export type SaveOutlineInput = z.input<typeof SaveOutlineInputSchema>

const invalid = (message: string): SaveOutlineResult => ({
  status: 'invalid',
  message: `The outline did not read as a block list (${message}).`,
})

export const saveOutline = async (raw: SaveOutlineInput): Promise<SaveOutlineResult> => {
  const parsed = SaveOutlineInputSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return invalid(issue === undefined ? 'shape' : `${issue.path.join('.')}: ${issue.message}`)
  }
  const input = parsed.data
  const documentId = input.documentId === null ? null : (input.documentId as DocumentId)

  const gate = await openEpisodeWith(input.projectId, input.episode, async (scope) => {
    if (documentId === null) return { document: null, rows: [] }
    const [document, rows] = await Promise.all([readDocumentById(scope, documentId), readNodeRows(scope, documentId)])
    return { document, rows }
  }, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  const { scope, episode } = gate
  let { document, rows } = gate.extra

  if (documentId === null) {
    // The first save: the document another tab may have started, or a new one.
    const existing = await readDocumentByKind(scope, episode.id, 'outline')
    if (existing !== null) {
      document = existing
      rows = await readNodeRows(scope, existing.id)
    } else {
      document = await createDocument(scope, episode.id, 'outline', episode.title)
      rows = []
    }
  }

  if (document === null || document.episodeId !== episode.id || document.kind !== 'outline') {
    return { status: 'refused', message: 'That outline no longer exists. Reload to continue.' }
  }
  if (!parseOutlineRows(rows).ok) {
    return { status: 'refused', message: 'The stored outline would not read. Reload to continue.' }
  }
  const target: DocumentRecord = document

  const next: readonly OutlineNode[] = input.nodes
  const seen = new Set<string>()
  for (const node of next) {
    if (seen.has(node.id)) return invalid(`block ${node.id} appears twice`)
    seen.add(node.id)
  }

  // A first save has no base stamp to disagree with.
  const conflict =
    documentId === null || target.updatedAt === input.baseUpdatedAt
      ? null
      : { expected: input.baseUpdatedAt, found: target.updatedAt }

  // The compare-and-swap. The stored list is digested as it reads, not as the
  // rows arrived, so the comparison is over the same shape the caller hashed.
  if (input.expectedDigest !== undefined) {
    const storedNodes = parseOutlineRows(rows)
    const digest = storedNodes.ok ? nodeDigest(storedNodes.value.map((entry) => entry.node)) : null
    if (digest !== input.expectedDigest) {
      return { status: 'stale', conflict: conflict ?? { expected: input.baseUpdatedAt, found: target.updatedAt } }
    }
  }

  const plan = planNodeWrite(rows, next)
  const mergedInto = new Map(input.retirements.map((entry) => [entry.nodeId, entry.mergedInto]))
  const tombstones = plan.deletes.map((nodeId) => {
    const survivor = mergedInto.get(nodeId as string) ?? null
    return { nodeId, mergedInto: survivor === null ? null : (survivor as NodeId) }
  })

  const [written, snapshot] = await Promise.all([
    commitNodePlan(scope, target.id, 'outline', plan, tombstones),
    input.snapshot
      ? snapshotVersion(scope, target.id, 'manual', next, next.length).then(() => true)
      : Promise.resolve(false),
  ])
  if ('unusable' in written) return { status: 'ids-unusable', ids: written.unusable }

  return {
    status: 'saved',
    documentId: target.id,
    createdAt: target.createdAt,
    updatedAt: written.updatedAt,
    conflict,
    snapshotTaken: snapshot,
    acts: next.filter((node) => node.type === 'h1').length,
  }
}

// ---------------------------------------------------------------------------
// Export (roadmap task 2.4)
// ---------------------------------------------------------------------------

/** The episode's outline as Markdown, for the requesting user (`ROLE.export`, ADR 0003 D16). */
export const exportOutlineMarkdown = async (projectId: string, episode: string): Promise<TextExportResult> => {
  const gate = await openEpisode(projectId, episode, ROLE.export)
  if (isRefusal(gate)) return gate
  return outlineExport(gate.scope, gate.episode)
}
