import { canonicalKey } from './alias'
import { headingParts } from './fountain-syntax'
import { readCue, writeCue } from './generated-text'
import type { NodeId } from './ids'
import { text } from './inline'
import type { ScreenplayNode } from './node'
import { readSlugline } from './slugline'

/**
 * A record-level rename, as a rewrite over the node list.
 *
 * AGENTS.md, "Derivation is one-way - except": a character record rename and
 * a location record rename are the two sanctioned write-backs, each "an
 * explicit rewrite operation, returns a diff, single undo entry". These are
 * the rewrites - `renameCharacterCues` and `renameLocationHeadings`. Each is
 * a pure function over a node list, like every operation in this package, so
 * the caller can run it over every episode's nodes, see exactly which nodes
 * would change, and only then commit.
 *
 * ## What is rewritten, and what is not
 *
 * A cue whose name - modifiers taken off with `readCue`, so `MEERA (V.O.)`
 * is `MEERA` for this purpose - has the same canonical key as the record's
 * old name is rewritten to the new name's cue spelling, keeping its
 * modifiers where they were. Nothing else moves: `YOUNG MEERA` and the
 * Devanagari spelling are other rows of the alias table, bound to the same
 * record by the writer, and a rename of the record's *name* does not rewrite
 * an alias the writer chose. That is the reading of "rewrites every cue in
 * every episode" taken here: every cue that *is* the name, in every episode.
 * Flagged in the phase report rather than assumed.
 *
 * `@mentions` carry a record id and no label (`inline.ts`), so they need no
 * rewrite - the sheet reads the new name from the record on its next render.
 *
 * A cue whose content is not plain text - a mention run inside a cue - is
 * left alone. It is not a cue this function can safely spell.
 */

export type CueRewrite = {
  readonly nodes: readonly ScreenplayNode[]
  /** The cue nodes whose text changed, in document order. The diff. */
  readonly rewritten: readonly NodeId[]
}

const COLLAPSE_SPACES = /\s+/gu

/**
 * The spelling a record name takes on the page.
 *
 * Uppercased with the invariant mapping, as `canonicalKey` folds: a cue is
 * uppercase by convention in every format this product writes, and a script
 * with no case - Devanagari, Tamil - passes through unchanged. A slugline's
 * set text follows the same convention, so `setSpelling` is the same rule
 * under the name the location side reads.
 */
export const cueSpelling = (name: string): string =>
  name.trim().replace(COLLAPSE_SPACES, ' ').toUpperCase()

export const setSpelling = cueSpelling

const plainText = (node: ScreenplayNode): string | null => {
  let out = ''
  for (const run of node.content) {
    if (run.kind !== 'text') return null
    out += run.text
  }
  return out
}

export const renameCharacterCues = (
  nodes: readonly ScreenplayNode[],
  from: string,
  to: string,
): CueRewrite => {
  const fromKey = canonicalKey(from)
  const spelling = cueSpelling(to)
  if (fromKey === '' || canonicalKey(spelling) === '') return { nodes, rewritten: [] }

  const rewritten: NodeId[] = []
  const out = nodes.map((node): ScreenplayNode => {
    if (node.type !== 'character') return node
    const raw = plainText(node)
    if (raw === null) return node
    const reading = readCue(raw)
    if (canonicalKey(reading.name) !== fromKey) return node
    const next = writeCue(spelling, reading.modifiers)
    if (next === raw.trim()) return node
    rewritten.push(node.id)
    return { ...node, content: [text(next)] }
  })
  return { nodes: rewritten.length === 0 ? nodes : out, rewritten }
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * The location rename. AGENTS.md, Entity identity: "Renaming a location
 * rewrites every scene heading that uses it - a write back into the
 * document, so it is an explicit operation with an undo entry."
 *
 * ## What is rewritten, and what is not
 *
 * A Scene node whose heading reads (`readSlugline`) as a set with the same
 * canonical key as the record's old name has its set text replaced by the
 * new name's spelling. The prefix stays as authored - `INT.`, `EXT`, `I/E.` -
 * and the time of day, when the reading took one off, comes back after a
 * ` - `. So `INT. CHAWL CORRIDOR - NIGHT` renamed to `Kamathi Chawl` reads
 * `INT. KAMATHI CHAWL - NIGHT`. The heading is rebuilt rather than patched
 * in place because the reading already normalised the separators (an en
 * dash, a double hyphen) to reach the set, and the rebuilt form is the one
 * every other heading this product writes takes.
 *
 * The same reading of "every heading that uses it" as the character side's
 * "every cue": every heading whose set *is* the name. A set the writer bound
 * as an alias - `THE CHAWL` on the Kamathi Chawl record - is a row they
 * chose, and stays. And a sub-set's own heading (`KAMATHI CHAWL - CORRIDOR`)
 * is that sub-set's name, not this record's: renaming the parent does not
 * rewrite it. Both flagged in the phase report; the other reading rewrites
 * the head segment of every descendant too.
 *
 * A heading that does not read - rejected by `classifyHeading`, or carrying
 * a mention run - is left alone, as a cue with a mention run is.
 */
export type HeadingRewrite = {
  readonly nodes: readonly ScreenplayNode[]
  /** The Scene nodes whose text changed, in document order. The diff. */
  readonly rewritten: readonly NodeId[]
}

export const renameLocationHeadings = (
  nodes: readonly ScreenplayNode[],
  from: string,
  to: string,
): HeadingRewrite => {
  const fromKey = canonicalKey(from)
  const spelling = setSpelling(to)
  if (fromKey === '' || canonicalKey(spelling) === '') return { nodes, rewritten: [] }

  const rewritten: NodeId[] = []
  const out = nodes.map((node): ScreenplayNode => {
    if (node.type !== 'scene') return node
    const raw = plainText(node)
    if (raw === null) return node
    const reading = readSlugline(raw)
    if (!reading.ok || canonicalKey(reading.value.set) !== fromKey) return node
    const trimmed = raw.trim()
    const parts = headingParts(trimmed)
    if (parts === null) return node
    // `headingParts` matches the word (`INT`), not its dot; keep the dot the
    // writer typed so `INT.` stays `INT.` and `INT` stays `INT`.
    const dot = trimmed.charAt(parts.prefix.length) === '.' ? '.' : ''
    const time = reading.value.timeOfDay
    const next = `${parts.prefix}${dot} ${spelling}${time === null ? '' : ` - ${time}`}`
    if (next === trimmed) return node
    rewritten.push(node.id)
    return { ...node, content: [text(next)] }
  })
  return { nodes: rewritten.length === 0 ? nodes : out, rewritten }
}
