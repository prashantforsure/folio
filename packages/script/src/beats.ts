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
 * at render". `@folio/contracts`' `EpisodeNavMeta` counts the nav's Beats row
 * from the same blocks: "the outline's numbered beats are the only beats that
 * exist."
 *
 * So the Beats route has no beat of its own to invent. **A beat is an outline
 * `beat` block.** What the route adds - a duration, a minute position on the
 * episode timeline, a spot on the unplaced canvas, the scenes that deliver it
 * - is authored data hanging off that block by its node id, in `packages/db`,
 * the way a synopsis hangs off a scene heading. This file is the pure half:
 * which blocks are beats, in what order, and how a block's one line of prose
 * splits into the *name* the beat sheet sets in serif and the *one-line*
 * under it.
 *
 * ## The headline convention
 *
 * The outline bundle draws a beat as a bold lead and a run of text -
 * `**Opening Image:** empty pitch, Ade training alone...` - and the beats
 * bundle draws the same beat as a name, `Opening Image`, over a line, `Empty
 * pitch, Ade training alone...`. One block, two renderings. The split is on
 * the **first colon**: everything before it is the name, everything after it
 * (trimmed) is the line. A block with no colon is a name with no line. A name
 * therefore cannot contain a colon; a line can contain any number.
 *
 * That is a convention over authored text, not a stored field, for the same
 * reason the number is not stored: a second copy of the name would drift
 * from the block the writer is editing. `writeBeatHeadline` is its inverse,
 * and `readBeatHeadline(writeBeatHeadline(h))` is an identity for every
 * trimmed name without a colon - the property test says so.
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

/**
 * The block text for a headline: `Name: line`, or `Name` alone when the
 * line is empty, or the line alone when the name is. A colon in the name
 * would split wrongly on the way back and is replaced with a dash rather
 * than refused - the writer typed it into a name field, not a block.
 */
export const writeBeatHeadline = (headline: BeatHeadline): string => {
  const name = headline.name.trim().replaceAll(BEAT_HEADLINE_SEPARATOR, ' -')
  const line = headline.line.trim()
  if (name === '') return line
  if (line === '') return name
  return `${name}${BEAT_HEADLINE_SEPARATOR} ${line}`
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
