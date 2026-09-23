import { OutlineNodeSchema } from '@folio/contracts'
import type { DocumentRecord } from '@folio/contracts'
import { commitNodePlan, createDocument, parseOutlineRows, planNodeWrite, readDocumentById, readDocumentByKind, readNodeRows, snapshotVersion } from '@folio/db'
import type { ProjectScope } from '@folio/db'
import type { DocumentId, NodeId, OutlineNode } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../auth/roles'
import type { EpisodeGate } from '../script/actor-gate'
import { roleRefusal } from '../script/actor-gate'
import { nodeDigest } from '../script/server'
import type { SaveOutlineResult } from './result'

/**
 * The Outline route's save as a **core function** - roadmap task 4.2.
 *
 * It takes an episode gate already opened and the raw input the action takes,
 * checks the role itself, and does everything the action did after its gate;
 * `actions.ts`'s header is the account of the save (the whole list, every
 * save; the first save creates the document; what it reports back). The
 * agent's tools and the worker call it with a gate of their own.
 */

const RetirementSchema = z.object({
  nodeId: z.string().min(1),
  mergedInto: z.string().min(1).nullable(),
})

export const SaveOutlineInputSchema = z.object({
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

type ParsedOutlineSave = z.infer<typeof SaveOutlineInputSchema>

const invalid = (message: string): SaveOutlineResult => ({
  status: 'invalid',
  message: `The outline did not read as a block list (${message}).`,
})

export const parseOutlineSave = (raw: unknown): { readonly ok: true; readonly input: ParsedOutlineSave } | { readonly ok: false; readonly result: SaveOutlineResult } => {
  const parsed = SaveOutlineInputSchema.safeParse(raw)
  if (parsed.success) return { ok: true, input: parsed.data }
  const issue = parsed.error.issues[0]
  return { ok: false, result: invalid(issue === undefined ? 'shape' : `${issue.path.join('.')}: ${issue.message}`) }
}

export type OutlineReads = { readonly document: DocumentRecord | null; readonly rows: Awaited<ReturnType<typeof readNodeRows>> }

/** The save's reads, as one function of the scope - the action runs it beside the cookie gate. */
export const outlineReadsFor =
  (documentId: DocumentId | null) =>
  async (scope: ProjectScope): Promise<OutlineReads> => {
    if (documentId === null) return { document: null, rows: [] }
    const [document, rows] = await Promise.all([readDocumentById(scope, documentId), readNodeRows(scope, documentId)])
    return { document, rows }
  }

export const saveOutlineWith = async (gate: EpisodeGate, raw: unknown, prepared?: OutlineReads): Promise<SaveOutlineResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const parsed = parseOutlineSave(raw)
  if (!parsed.ok) return parsed.result
  const input = parsed.input
  const documentId = input.documentId === null ? null : (input.documentId as DocumentId)
  const { scope, episode } = gate
  let { document, rows } = prepared ?? (await outlineReadsFor(documentId)(scope))

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
