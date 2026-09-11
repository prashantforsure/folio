import type { MentionEntity } from '@folio/script'

import type { ScriptInline } from './slate-model'
import { isMentionElement } from './slate-model'

/**
 * Where the engine breaks a block's lines, expressed in the editor's own
 * offsets.
 *
 * The sheet is drawn on the engine's lines, not the browser's. `measure.ts`
 * in `@folio/script` wraps greedily on whitespace at a fixed measure and
 * breaks a word wider than the measure hard; a browser wraps on hyphens and
 * soft-hyphens too, and a single hyphenated compound wrapping differently is
 * a block one line taller than the record says, and every page frame below
 * it a line out. So the block is rendered `white-space: pre` and the line
 * ends are *decorations* computed here by the same rule as `wrapText`, on
 * the same text the engine measures (mentions rendered by their label, an
 * unresolved one by the engine's one-character placeholder).
 *
 * This is the same algorithm as `wrapText`, walked with offsets kept. It is
 * not a call to `wrapText` because that function collapses whitespace and
 * returns strings - it has to, it measures - and a decoration needs to know
 * which character of which text node a line ends on.
 */

export type LineEnd = {
  /** Index into the block's `children`. Always a text child. */
  readonly child: number
  /** Exclusive end offset within that text child. */
  readonly offset: number
}

type Mapped = {
  readonly child: number
  /** -1 for a character rendered by a mention label; it has no editor offset. */
  readonly offset: number
}

const isWhitespace = (character: string): boolean => /\s/u.test(character)

/**
 * The rendered characters of a block, each mapped back to the editor.
 */
const renderBlock = (
  children: readonly ScriptInline[],
  labelFor: (entity: MentionEntity, id: string) => string | undefined,
): { readonly text: string; readonly map: readonly Mapped[] } => {
  let text = ''
  const map: Mapped[] = []
  children.forEach((child, index) => {
    if (isMentionElement(child)) {
      const label = labelFor(child.entity, child.id) ?? 'x'
      text += label
      for (let at = 0; at < label.length; at += 1) map.push({ child: index, offset: -1 })
      return
    }
    text += child.text
    for (let at = 0; at < child.text.length; at += 1) map.push({ child: index, offset: at })
  })
  return { text, map }
}

/**
 * Every offset at which the engine ends a line short of the block's end.
 *
 * Mirrors `wrapText`: whitespace runs collapse to one space, leading and
 * trailing whitespace is ignored, words are placed greedily, and a word
 * wider than the measure is cut at the measure as often as needed. Each
 * returned entry is the editor position after which a line break is drawn.
 */
export const lineEndsOf = (
  children: readonly ScriptInline[],
  labelFor: (entity: MentionEntity, id: string) => string | undefined,
  charsPerLine: number,
): readonly LineEnd[] => {
  const measure = Math.max(1, Math.floor(charsPerLine))
  const { text, map } = renderBlock(children, labelFor)

  // Tokenise into words with their rendered start index.
  const words: { readonly start: number; readonly length: number }[] = []
  let at = 0
  while (at < text.length) {
    const character = text[at] ?? ''
    if (isWhitespace(character)) {
      at += 1
      continue
    }
    const start = at
    while (at < text.length && !isWhitespace(text[at] ?? '')) at += 1
    words.push({ start, length: at - start })
  }

  /** Rendered indices at which a new line begins. */
  const starts: number[] = []
  let lineLength = 0
  for (const word of words) {
    let start = word.start
    let rest = word.length
    while (rest > measure) {
      if (lineLength !== 0) starts.push(start)
      starts.push(start + measure)
      lineLength = 0
      start += measure
      rest -= measure
    }
    if (rest === 0) continue
    if (lineLength === 0) {
      lineLength = rest
      continue
    }
    if (lineLength + 1 + rest <= measure) {
      lineLength += 1 + rest
      continue
    }
    starts.push(start)
    lineLength = rest
  }

  // A line that would begin at the very end of the block is not a line - the
  // hard cut of a word that is an exact multiple of the measure ends there.
  // And a break that would fall after a mention's label has no editor
  // position to carry it; the mention is drawn on one line regardless.
  const ends: LineEnd[] = []
  for (const next of starts) {
    if (next >= text.length) continue
    const last = map[next - 1]
    if (last === undefined || last.offset < 0) continue
    ends.push({ child: last.child, offset: last.offset + 1 })
  }
  return ends
}

/** How many lines the block occupies: one more than the breaks, never fewer than one. */
export const lineCountOf = (ends: readonly LineEnd[]): number => ends.length + 1
