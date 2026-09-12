import type { CharacterId, InlineContent, InlineRun, LabelBook, LocationId, MentionLabel, MentionTarget } from '@folio/script'
import { mention, normaliseContent, text } from '@folio/script'

/**
 * A shot description, between the editor and the row. Pure; tested in
 * `tests/storyboard-mentions.test.ts`.
 *
 * The row holds inline content, so an `@mention` is a record id and a
 * rename does not touch it (`@folio/script`, `inline.ts`). The editor is a
 * plain text field, because a description is one or two sentences and a
 * Slate instance per shot is more editor than the text needs. So there is a
 * codec:
 *
 *   `contentToText`   a mention prints as `@Name` from the label book, an
 *                     unlabelled one as `@?` - the same rendering the
 *                     Scenes excerpt uses (`lib/scenes/excerpt.ts`).
 *   `textToContent`   `@Name` becomes a mention when `Name` is a label in
 *                     the book, matched longest-first and case-insensitively
 *                     so `@meera` and `@Meera Pawar` both resolve; anything
 *                     else stays text. **It never creates a record**: an
 *                     `@Stranger` nobody has written down is text, and the
 *                     writer creates the person on the Characters route or
 *                     with the Script editor's mention picker.
 *
 * Round trip: `textToContent(contentToText(c))` is `c` for any content whose
 * mentions are all labelled and whose text carries no stray `@Name` that
 * happens to be a label. The second condition is why the codec prefers
 * losing a mention to inventing one.
 */

export const contentToText = (content: InlineContent, labels: LabelBook): string =>
  content.map((run) => (run.kind === 'text' ? run.text : `@${labels.labelFor(run.target) ?? '?'}`)).join('')

/** A label as the parser matches it: longest first, so `Meera Pawar` beats `Meera`. */
const byLengthDesc = (a: MentionLabel, b: MentionLabel): number =>
  b.label.length - a.label.length || a.label.localeCompare(b.label)

/** What may follow a mention: the end, whitespace, or punctuation - never a letter, so `@Meeras` is not `@Meera` + `s`. */
const endsToken = (value: string, at: number): boolean => at >= value.length || !/[\p{L}\p{N}]/u.test(value[at] ?? '')

/** A label's target, narrowed by its entity. */
const targetOf = (label: MentionLabel): MentionTarget =>
  label.entity === 'character'
    ? { entity: 'character', id: label.id as CharacterId }
    : { entity: 'location', id: label.id as LocationId }

export const textToContent = (value: string, labels: readonly MentionLabel[]): InlineContent => {
  const candidates = [...labels].filter((label) => label.label.trim() !== '').sort(byLengthDesc)
  const runs: InlineRun[] = []
  let buffer = ''
  let index = 0
  while (index < value.length) {
    if (value[index] === '@') {
      const rest = value.slice(index + 1)
      const hit = candidates.find(
        (label) =>
          rest.slice(0, label.label.length).toLowerCase() === label.label.toLowerCase() &&
          endsToken(value, index + 1 + label.label.length),
      )
      if (hit !== undefined) {
        if (buffer !== '') runs.push(text(buffer))
        buffer = ''
        runs.push(mention(targetOf(hit)))
        index += 1 + hit.label.length
        continue
      }
    }
    buffer += value[index]
    index += 1
  }
  if (buffer !== '') runs.push(text(buffer))
  return normaliseContent(runs)
}
