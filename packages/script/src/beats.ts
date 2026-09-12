import type { NodeId } from './ids'
import type { InlineContent } from './inline'
import type { LabelBook } from './measure'
import { renderedText } from './measure'
import type { BeatNode, H1Node, H2Node, H3Node, OutlineNode } from './outline'

/**
 * Beats, read off the outline.
 *
 * AGENTS.md, The node model, gives the Outline "numbered beats" as one of its
 * seven blocks, and `outline.ts` rules that a beat's number "is **not**
 * stored. It is the block's ordinal among the beats of its document, computed
 * at render". This file is that computation, plus the other pure reads the
 * Outline route makes over its own list: the document map of headings and the
 * word count.
 *
 * ## The headline convention
 *
 * The outline bundle draws a beat as a bold lead and a run of text -
 * `**Opening Image:** empty pitch, Ade training alone...`. The lead runs to
 * the **first colon**: everything before it is the beat's name, everything
 * after it (trimmed) is its line. A block with no colon is a name with no
 * line. The editor decorates the same range (`outline-editor.tsx`); nothing
 * about the split is stored, for the same reason the number is not: a second
 * copy of the name would drift from the block the writer is editing.
 *
 * There was a Beats route that rendered these blocks as a sheet with timing
 * and scene links hung off them; it was removed (`docs/build-decisions.md`,
 * "Beats route removed"). The outline's beat blocks are unchanged by that.
 *
 * ## Mentions
 *
 * Block text is rendered through a `LabelBook`, as the sheet renders it: a
 * mention is its record's current name, or the atom `x` when no label was
 * supplied. Nothing here resolves anything; that is derivation's.
 */

export type BeatHeadline = {
  readonly name: string
  readonly line: string
}

/** The character the name ends at. */
export const BEAT_HEADLINE_SEPARATOR = ':'

/** Name before the first colon, line after it; no colon, no line. Both trimmed. */
export const readBeatHeadline = (text: string): BeatHeadline => {
  const at = text.indexOf(BEAT_HEADLINE_SEPARATOR)
  if (at === -1) return { name: text.trim(), line: '' }
  return { name: text.slice(0, at).trim(), line: text.slice(at + 1).trim() }
}

// ---------------------------------------------------------------------------
// Reading an outline
// ---------------------------------------------------------------------------

/** A block's text on the sheet: text runs as written, mentions by label. */
export const outlineNodeText = (node: OutlineNode, labels: LabelBook): string =>
  node.type === 'rule' ? '' : renderedText(node.content, labels).text

export const outlineContentText = (content: InlineContent, labels: LabelBook): string =>
  renderedText(content, labels).text

export type OutlineBeat = {
  readonly id: NodeId
  /** 1-based, among the outline's beat blocks in document order. Never stored. */
  readonly ordinal: number
  readonly node: BeatNode
}

/** Every beat block, numbered in document order. */
export const outlineBeats = (nodes: readonly OutlineNode[]): readonly OutlineBeat[] => {
  const out: OutlineBeat[] = []
  for (const node of nodes) {
    if (node.type !== 'beat') continue
    out.push({ id: node.id, ordinal: out.length + 1, node })
  }
  return out
}

export type HeadingLevel = 1 | 2 | 3

export type OutlineHeading = {
  readonly id: NodeId
  readonly level: HeadingLevel
  readonly text: string
}

const HEADING_LEVEL: Readonly<Record<(H1Node | H2Node | H3Node)['type'], HeadingLevel>> = {
  h1: 1,
  h2: 2,
  h3: 3,
}

/** The document map: every heading, in order, with its level. */
export const outlineHeadings = (
  nodes: readonly OutlineNode[],
  labels: LabelBook,
): readonly OutlineHeading[] =>
  nodes.flatMap((node) =>
    node.type === 'h1' || node.type === 'h2' || node.type === 'h3'
      ? [{ id: node.id, level: HEADING_LEVEL[node.type], text: renderedText(node.content, labels).text }]
      : [],
  )

/** Words across every block that carries text. A rule has none. */
export const outlineWordCount = (nodes: readonly OutlineNode[], labels: LabelBook): number =>
  nodes.reduce((total, node) => {
    const text = outlineNodeText(node, labels).trim()
    return total + (text === '' ? 0 : text.split(/\s+/u).length)
  }, 0)
