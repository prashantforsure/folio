import { keyTokens } from './alias'
import type { Introduction } from './entities'
import type { NodeId } from './ids'
import type { InlineContent } from './inline'
import type { ScreenplayNode } from './node'

/**
 * Where the action introduces a character.
 *
 * A screenplay names a character in action before they speak - `MEERA
 * PAWAR (38), rain-soaked, counts the buckets again.` - and that line is
 * the closest thing the page has to a description. This finds it: the
 * first **action** node naming the record by one of its keys, and how many
 * action nodes name them at all (`namedIn`).
 *
 * ## Evidence, never a binding
 *
 * Nothing resolves through this. A match here does not bind a spelling,
 * does not mint a record and does not feed the resolve queue; it is a
 * pointer the Characters route quotes and the writer can take into the
 * description with `Use this`. Open decision 3 (what counts as a mention)
 * is untouched: `@mentions` are still the mention mechanism.
 *
 * ## The rules
 *
 *   - **Action nodes only.** A Fountain import types a CAPS intro line as a
 *     cue when it stands alone, and that cue lands in the queue as a cue -
 *     never here. So a script with the intro on its own line shows the
 *     queue row, not an introduction, and the drawer says so.
 *   - **Whole tokens, in order.** `MEERA` matches `MEERA'S bag` (the
 *     apostrophe is not a letter) and not `MEERAS`; `MEERA PAWAR` matches
 *     `MEERA PAWAR (38)` and not `MEERA and PAWAR`. Case is the page's: the
 *     key is uppercase, the text is tested as written, so an intro in caps
 *     matches for free and a lower-case `meera` in action does not - a
 *     name in caps is the convention this is reading. Scripts with no case
 *     (Devanagari) match as they are.
 *   - **Earliest match wins; the longest key on a tie**, so `MEERA PAWAR
 *     (38)` credits the two-token key and the age is read after it.
 *   - **No special cases.** `MAN`, `DAY` or `MILL` bound as a name will
 *     match an action line that uses the word; that is a false positive
 *     the tests name and accept, because the cost is a wrong quote the
 *     writer can see, never a wrong binding.
 *
 * Deterministic and pure, like every reader in this package.
 */

export type IntroductionSubject = {
  readonly id: string
  /** Canonical keys (`canonicalKey`) the record answers to: its name and bound spellings. */
  readonly keys: readonly string[]
}

export type Introduced = {
  readonly introducedAt: Introduction | null
  /** Action nodes naming the record, anywhere in the script. */
  readonly namedIn: number
}

const plainText = (content: InlineContent): string =>
  content
    .map((run) => (run.kind === 'text' ? run.text : ''))
    .join('')

const ESCAPE = /[.*+?^${}()|[\]\\]/gu

const patternOf = (key: string): RegExp | null => {
  const tokens = keyTokens(key)
  if (tokens.length === 0) return null
  const body = tokens.map((token) => token.replace(ESCAPE, '\\$&')).join('[^\\p{L}\\p{N}]+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'u')
}

export type NameMatch = {
  readonly key: string
  readonly index: number
  /** Where the match ends: what follows is where an age is read. */
  readonly end: number
}

/** The earliest key named in the text; the longest key on a tie; null when none is. */
export const namedInText = (text: string, keys: readonly string[]): NameMatch | null => {
  let best: NameMatch | null = null
  for (const key of keys) {
    const pattern = patternOf(key)
    if (pattern === null) continue
    const match = pattern.exec(text)
    if (match === null) continue
    const found: NameMatch = { key, index: match.index, end: match.index + match[0].length }
    if (best === null || found.index < best.index || (found.index === best.index && found.key.length > best.key.length)) {
      best = found
    }
  }
  return best
}

const AGE = /^\s*\((\d{1,3})\)/u

/** `MEERA PAWAR (38)` → 38: an age in brackets straight after the name. Null when the page gives none. */
export const ageOnThePage = (text: string, keys: readonly string[]): number | null => {
  const match = namedInText(text, keys)
  if (match === null) return null
  const age = AGE.exec(text.slice(match.end))
  const value = age?.[1]
  return value === undefined ? null : Number(value)
}

export const findIntroductions = (
  nodes: readonly ScreenplayNode[],
  subjects: readonly IntroductionSubject[],
  /** The heading nodes the scan accepted as scenes; a rejected heading ends no scene. */
  headings: ReadonlySet<NodeId>,
): ReadonlyMap<string, Introduced> => {
  const out = new Map<string, { introducedAt: Introduction | null; namedIn: number }>()
  const patterns = subjects.map((subject) => ({
    id: subject.id,
    patterns: subject.keys.flatMap((key) => {
      const pattern = patternOf(key)
      return pattern === null ? [] : [pattern]
    }),
  }))
  let scene: NodeId | null = null
  for (const node of nodes) {
    if (node.type === 'scene' && headings.has(node.id)) {
      scene = node.id
      continue
    }
    if (node.type !== 'action') continue
    const text = plainText(node.content)
    if (text.trim() === '') continue
    for (const subject of patterns) {
      if (!subject.patterns.some((pattern) => pattern.test(text))) continue
      const entry = out.get(subject.id) ?? { introducedAt: null, namedIn: 0 }
      entry.namedIn += 1
      entry.introducedAt ??= { nodeId: node.id, scene }
      out.set(subject.id, entry)
    }
  }
  return out
}
