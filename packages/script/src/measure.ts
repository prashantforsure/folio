import type { CharacterId, LocationId } from './ids'
import type { InlineContent, MentionTarget } from './inline'

/**
 * Turning a node's content into a number of lines.
 *
 * Monospace, so a line holds a fixed number of characters and measuring is
 * counting - no font table, no canvas, no `measureText`, and therefore no
 * font-metrics dependency (AGENTS.md: `packages/script` takes zero runtime
 * dependencies, and headless Chrome is on the "Deliberately not using" list
 * precisely because its metrics would not match the sheet).
 *
 * The wrap is greedy on whitespace, which is what a text renderer does: fill a
 * line until the next word will not fit, then break. A word longer than the
 * measure is broken hard rather than allowed to overhang, because a screenplay
 * line that overhangs its measure is not a thing the sheet can draw.
 *
 * ## Mentions
 *
 * An `@mention` carries no display label by design (`inline.ts`): the label is
 * the record's `name` at render time. So the width of a mention is not a
 * property of the node, and this module cannot know it. The caller supplies the
 * labels; a mention with no label supplied is measured as one character - the
 * same atom width `contentLength` gives it - and *reported*, so the caller can
 * see that the page count it is holding was computed without a name it needed.
 * Silently measuring it as zero would make an unresolved mention shorten the
 * page, which is exactly the class of bug this package exists to prevent.
 */

/** A label for one record, supplied by the caller at measure time. */
export type MentionLabel = {
  readonly entity: MentionTarget['entity']
  readonly id: CharacterId | LocationId
  readonly label: string
}

/** A mention that was measured without a label. Reported, never silent. */
export type UnresolvedMention = {
  readonly entity: MentionTarget['entity']
  readonly id: string
}

/** The atom width `inline.ts` gives a mention, used when no label is supplied. */
export const UNRESOLVED_MENTION_WIDTH = 1

const key = (entity: MentionTarget['entity'], id: string): string => `${entity}:${id}`

export type LabelBook = {
  readonly labelFor: (target: MentionTarget) => string | undefined
}

export const labelBook = (labels: readonly MentionLabel[]): LabelBook => {
  const byKey = new Map(labels.map((entry) => [key(entry.entity, entry.id), entry.label]))
  return { labelFor: (target) => byKey.get(key(target.entity, target.id)) }
}

/** The empty book: every mention is unresolved, and every one is reported. */
export const NO_LABELS: LabelBook = labelBook([])

export type RenderedText = {
  readonly text: string
  readonly unresolved: readonly UnresolvedMention[]
}

/**
 * The text a node puts on the sheet.
 *
 * Uppercasing is deliberately not applied. Scene headings, cues and transitions
 * are drawn uppercase (the bundle does it in CSS), but the sheet is monospace,
 * so case cannot change a width - and applying it here would put a rendering
 * decision inside the measurer for no measurable effect.
 */
export const renderedText = (content: InlineContent, labels: LabelBook): RenderedText => {
  const unresolved: UnresolvedMention[] = []
  let text = ''
  for (const run of content) {
    if (run.kind === 'text') {
      text += run.text
      continue
    }
    const label = labels.labelFor(run.target)
    if (label === undefined) {
      unresolved.push({ entity: run.target.entity, id: String(run.target.id) })
      text += 'x'.repeat(UNRESOLVED_MENTION_WIDTH)
      continue
    }
    text += label
  }
  return { text, unresolved }
}

/**
 * Break text into rendered lines at a measure.
 *
 * Total, and never empty: an empty node still occupies its line, because the
 * writer can see the caret sitting on it. A `charsPerLine` of zero or less
 * would be a broken sheet spec rather than a broken node, so it is clamped to
 * one character rather than looping.
 */
export const wrapText = (text: string, charsPerLine: number): readonly string[] => {
  const measure = Math.max(1, Math.floor(charsPerLine))
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  if (collapsed === '') return ['']

  const lines: string[] = []
  let line = ''
  for (const word of collapsed.split(' ')) {
    let rest = word
    // A word wider than the measure is broken hard, as many times as it takes.
    while (rest.length > measure) {
      if (line !== '') {
        lines.push(line)
        line = ''
      }
      lines.push(rest.slice(0, measure))
      rest = rest.slice(measure)
    }
    if (rest === '') continue
    if (line === '') {
      line = rest
      continue
    }
    if (line.length + 1 + rest.length <= measure) {
      line = `${line} ${rest}`
      continue
    }
    lines.push(line)
    line = rest
  }
  if (line !== '') lines.push(line)
  // Non-empty text always produced at least one line above: either a hard break
  // pushed one, or the trailing partial line did.
  return lines
}

/** How many lines this content occupies at this measure. Never fewer than one. */
export const lineCount = (text: string, charsPerLine: number): number =>
  wrapText(text, charsPerLine).length
