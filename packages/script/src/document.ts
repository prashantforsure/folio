import type { DocumentId } from './ids'
import type { ScreenplayNode } from './node'
import type { OutlineNode } from './outline'

/**
 * Two document kinds, one table, different block sets.
 *
 * The tag is what keeps them apart: there is no type at which an `OutlineNode`
 * and a `ScreenplayNode` are interchangeable, so an H2 cannot reach a
 * screenplay through a shared `nodes` field.
 *
 * A document carries its id, its kind and its ordered node list and nothing
 * else. Project, episode, title, draft and revision are schema (`packages/db`),
 * not model.
 */
export const DOCUMENT_KINDS = ['screenplay', 'outline'] as const

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const isDocumentKind = (value: string): value is DocumentKind =>
  (DOCUMENT_KINDS as readonly string[]).includes(value)

export type ScreenplayDocument = {
  readonly kind: 'screenplay'
  readonly id: DocumentId
  /** Ordered. AGENTS.md: "A script is an **ordered list of typed nodes**." */
  readonly nodes: readonly ScreenplayNode[]
}

export type OutlineDocument = {
  readonly kind: 'outline'
  readonly id: DocumentId
  readonly nodes: readonly OutlineNode[]
}

export type FolioDocument = ScreenplayDocument | OutlineDocument
