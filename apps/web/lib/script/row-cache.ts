import type { Timestamp } from '@folio/contracts'
import type { NodeRow, NodeWritePlan } from '@folio/db'
import { nodeToWrite } from '@folio/db'
import type { DocumentId, ScreenplayNode } from '@folio/script'

/**
 * The rows of a document as this process last wrote them, keyed by the
 * document and validated by `documents.updated_at`.
 *
 * A save needs the stored rows to plan its write against and to paginate
 * the result, and reading them is the slowest thing it does: a feature is
 * ~3,000 rows and 600 KB, transferred from a database ~400ms away on every
 * keystroke that reaches the server. But the server *wrote* those rows on
 * the previous save, from a list it held in memory, with keys it chose - so
 * it knows exactly what the table holds, as long as nobody else has written
 * since. `documents.updated_at` says whether anybody has: every write path
 * stamps it, and the save reads the document row beside its gate anyway.
 *
 * So a save asks the cache first. A hit whose stamp equals the row's stamp
 * is the table's content, by construction; anything else - a miss, a stamp
 * moved by an import, a restore, another instance - reads the rows as
 * before, and the entry is replaced after the write. The cache can never
 * serve a stale list: the stamp it is validated against is the database's,
 * read in the same request, never the client's claim.
 *
 * Bounded, most-recently-saved first, one process. A second instance keeps
 * its own and misses whenever the other wrote - correct, and slower.
 */

type Entry = {
  readonly updatedAt: Timestamp
  readonly rows: readonly NodeRow[]
}

const MAX_DOCUMENTS = 64

const entries = new Map<string, Entry>()

export const cachedRows = (documentId: DocumentId): Entry | undefined => {
  const entry = entries.get(documentId as string)
  if (entry === undefined) return undefined
  // Refresh recency.
  entries.delete(documentId as string)
  entries.set(documentId as string, entry)
  return entry
}

export const rememberRows = (documentId: DocumentId, updatedAt: Timestamp, rows: readonly NodeRow[]): void => {
  entries.delete(documentId as string)
  entries.set(documentId as string, { updatedAt, rows })
  while (entries.size > MAX_DOCUMENTS) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
}

export const forgetRows = (documentId: DocumentId): void => {
  entries.delete(documentId as string)
}

/**
 * The rows the table holds after `plan` is applied to `existing` for the
 * list `next` - the same keys the plan assigned, the same columns the
 * statement wrote.
 */
export const rowsAfterWrite = (
  existing: readonly NodeRow[],
  next: readonly ScreenplayNode[],
  plan: NodeWritePlan,
  kind: NodeRow['documentKind'],
): readonly NodeRow[] => {
  const keyOf = new Map<string, string>()
  for (const row of existing) keyOf.set(row.id, row.orderKey)
  for (const write of plan.inserts) keyOf.set(write.id as string, write.orderKey as string)
  for (const write of plan.updates) keyOf.set(write.id as string, write.orderKey as string)
  return next.map((node) => {
    const key = keyOf.get(node.id as string)
    if (key === undefined) throw new Error('Folio: a written node has no order key. This is a bug in the save.')
    const write = nodeToWrite(node, key as Parameters<typeof nodeToWrite>[1])
    return {
      id: write.id as string,
      documentKind: kind,
      type: write.type,
      orderKey: write.orderKey as string,
      content: write.content,
      modifiers: [...write.modifiers],
      provenanceSource: write.provenanceSource,
      provenanceRunId: write.provenanceRunId,
    }
  })
}
