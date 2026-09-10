import type { NodeId } from './ids'
import type { InlineContent } from './inline'
import type { NoPagination } from './node'
import type { Provenance } from './provenance'

/**
 * The Outline document kind.
 *
 * AGENTS.md, The node model: "The Outline is a **different document kind in
 * the same table** with a different, tiny, closed block set (Body, H1, H2, H3,
 * Quote, Rule, numbered beats). Do not widen the screenplay schema to hold an
 * `H2`."
 *
 * So: two unions, one storage table (`document.ts` is the tagged pair), and no
 * shared block type between them. `ScreenplayNode` and `OutlineNode` have no
 * member in common - not even `body`/`action`, which are superficially the same
 * shape. Sharing one would be the first step back toward one widened union.
 *
 * Outline blocks carry the same `NoPagination` ban as screenplay nodes. The
 * outline is not paginated today, but the reason for the ban - a stored
 * position is a second authority on where something sits - is identical.
 */

const OUTLINE_NODE_TYPE_SET = {
  body: true,
  h1: true,
  h2: true,
  h3: true,
  quote: true,
  rule: true,
  beat: true,
} as const

export type OutlineNodeType = keyof typeof OUTLINE_NODE_TYPE_SET

export const OUTLINE_NODE_TYPES = Object.keys(
  OUTLINE_NODE_TYPE_SET,
) as readonly OutlineNodeType[]

export const isOutlineNodeType = (value: string): value is OutlineNodeType =>
  Object.prototype.hasOwnProperty.call(OUTLINE_NODE_TYPE_SET, value)

type OutlineBase = NoPagination & {
  readonly id: NodeId
  readonly provenance: Provenance
}

export type BodyNode = OutlineBase & {
  readonly type: 'body'
  readonly content: InlineContent
}

/**
 * Three heading tags rather than one `heading` block with `level: 1 | 2 | 3`.
 *
 * The brief names H1, H2 and H3 as three of the seven blocks, and a closed set
 * of tags is the shape AGENTS.md, Development philosophy 6 asks for. The
 * level-carrying alternative is more compact and would make "demote this
 * heading" a field edit rather than a type change; it is noted in the report as
 * the one place this block set could reasonably be drawn differently.
 */
export type H1Node = OutlineBase & {
  readonly type: 'h1'
  readonly content: InlineContent
}

export type H2Node = OutlineBase & {
  readonly type: 'h2'
  readonly content: InlineContent
}

export type H3Node = OutlineBase & {
  readonly type: 'h3'
  readonly content: InlineContent
}

export type QuoteNode = OutlineBase & {
  readonly type: 'quote'
  readonly content: InlineContent
}

/**
 * A horizontal rule. Carries no content at all - not an empty `InlineContent`,
 * no field. The union is what makes that expressible.
 */
export type RuleNode = OutlineBase & {
  readonly type: 'rule'
}

/**
 * A numbered beat.
 *
 * The number is **not** stored. It is the block's ordinal among the beats of
 * its document, computed at render, for the same reason a node has no `page`:
 * a stored ordinal is a second authority that drifts the moment a beat is
 * inserted, deleted or reordered. AGENTS.md, Development philosophy 1.
 */
export type BeatNode = OutlineBase & {
  readonly type: 'beat'
  readonly content: InlineContent
}

export type OutlineNode =
  | BodyNode
  | H1Node
  | H2Node
  | H3Node
  | QuoteNode
  | RuleNode
  | BeatNode

/** Same completeness proof as the screenplay union. See `node.ts`. */
export const OUTLINE_NODE_TYPE_COVERAGE: Record<OutlineNode['type'], OutlineNodeType> = {
  body: 'body',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  quote: 'quote',
  rule: 'rule',
  beat: 'beat',
}
