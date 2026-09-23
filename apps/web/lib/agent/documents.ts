import { readDocumentById, readOutlineNodes, readScreenplayNodes } from '@folio/db'
import type { ProjectScope } from '@folio/db'
import type { DocumentId, OutlineNode, ScreenplayNode } from '@folio/script'

import { nodeDigest } from '../script/server'

/**
 * A document as an agent operation sees it: its stored node list and that
 * list's digest - the same `nodeDigest` over the same parsed list the save's
 * compare-and-swap computes (`saveScript`, `saveOutline`), so a digest taken
 * here and one checked there agree byte for byte (ADR 0003 **D10**).
 */
export type DocumentState =
  | {
      readonly kind: 'screenplay'
      readonly documentId: DocumentId
      readonly episodeId: string
      readonly updatedAt: string
      readonly nodes: readonly ScreenplayNode[]
      readonly digest: string
    }
  | {
      readonly kind: 'outline'
      readonly documentId: DocumentId
      readonly episodeId: string
      readonly updatedAt: string
      readonly nodes: readonly OutlineNode[]
      readonly digest: string
    }

/** Read one document's state, or null when it is gone or will not read. */
export const readDocumentState = async (scope: ProjectScope, documentId: DocumentId): Promise<DocumentState | null> => {
  const document = await readDocumentById(scope, documentId)
  if (document === null) return null
  if (document.kind === 'screenplay') {
    const read = await readScreenplayNodes(scope, document.id)
    if (!read.ok) return null
    const nodes = read.value.map((entry) => entry.node)
    return { kind: 'screenplay', documentId: document.id, episodeId: document.episodeId, updatedAt: document.updatedAt, nodes, digest: nodeDigest(nodes) }
  }
  if (document.kind === 'outline') {
    const read = await readOutlineNodes(scope, document.id)
    if (!read.ok) return null
    const nodes = read.value.map((entry) => entry.node)
    return { kind: 'outline', documentId: document.id, episodeId: document.episodeId, updatedAt: document.updatedAt, nodes, digest: nodeDigest(nodes) }
  }
  return null
}
