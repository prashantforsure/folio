import { canonicalKey } from './alias'
import { readCue } from './generated-text'
import type { InlineContent } from './inline'
import type { ScreenplayNode } from './node'

/**
 * Sides: one character's lines, with the headings they fall under.
 *
 * What an actor is handed - every speech of one part, in script order, with
 * enough of the page to know where each is. A pure read over the node list:
 * nothing is copied, minted or re-typed, and the nodes come back as they
 * are so the sheet can draw them exactly as the Script route does.
 *
 * The rules: a heading is kept provisionally; a cue whose canonical key is
 * one of `keys` is kept with the parentheticals and dialogue that follow it,
 * until anything else - action, another cue, a transition - ends the
 * speech; a heading with nothing kept under it is dropped; a comment is
 * never in a side. Modifiers come off the cue before the key is read, so
 * `MEERA (V.O.)` is Meera's.
 */

const plainText = (content: InlineContent): string | null => {
  let out = ''
  for (const run of content) {
    if (run.kind !== 'text') return null
    out += run.text
  }
  return out
}

export const sidesFor = (nodes: readonly ScreenplayNode[], keys: ReadonlySet<string>): readonly ScreenplayNode[] => {
  const out: ScreenplayNode[] = []
  let heading: ScreenplayNode | null = null
  let headingKept = false
  let speaking = false
  for (const node of nodes) {
    if (node.type === 'comment') continue
    if (node.type === 'scene') {
      heading = node
      headingKept = false
      speaking = false
      continue
    }
    if (node.type === 'character') {
      const raw = plainText(node.content)
      speaking = raw !== null && keys.has(canonicalKey(readCue(raw).name))
      if (!speaking) continue
      if (heading !== null && !headingKept) {
        out.push(heading)
        headingKept = true
      }
      out.push(node)
      continue
    }
    if ((node.type === 'paren' || node.type === 'dialogue') && speaking) {
      out.push(node)
      continue
    }
    speaking = false
  }
  return out
}
