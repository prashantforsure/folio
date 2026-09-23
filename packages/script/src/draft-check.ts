import { canonicalKey, scoreMatch } from './alias'
import { readCue } from './generated-text'
import type { InlineContent } from './inline'
import { text } from './inline'
import type { NodeId } from './ids'
import type { ScreenplayNode } from './node'
import { readScreenplayNode } from './read'
import { readSlugline } from './slugline'

/**
 * Holding a drafted script to the project's bound spellings - roadmap task
 * 4.5 (the story-to-script pipeline), `docs/agents/craft.md` rules 2 and 3.
 *
 * A cue that is not a bound cue spelling is a new, unresolved name on the
 * Characters route; a heading whose set is not a bound slugline spelling is a
 * new location; a mention of a record id that does not exist is a reference
 * to nothing. None of them may reach a proposal. So every drafted node is
 * checked, by the same keys derivation matches on (`canonicalKey` of the cue's
 * name, of the heading's set), and each miss is either **repaired** or
 * **rejected**:
 *
 *   - a cue or a set that keys to a bound spelling but is written otherwise
 *     (`Meera`, `MEERA  `) is rewritten to the bound spelling, its extension
 *     and the rest of the line kept;
 *   - one that is not bound but matches exactly one bound spelling as a
 *     leading run of words (`MEERA K.` for `MEERA`, `HOSPITAL` for `HOSPITAL
 *     WARD`) - `scoreMatch`'s `likely`, the tier derivation proposes on - is
 *     rewritten to it;
 *   - anything else is rejected: left as it is, and reported, for the caller
 *     to redraft or refuse;
 *   - a mention of an id that is not a record is dropped from the line, and
 *     reported.
 *
 * Pure: nodes and spellings in, nodes and a report out. The pipeline builds
 * cues and headings from the bound spellings itself, so this is the net under
 * that - and what a test holds the draft to.
 */

export type BoundSpellings = {
  /** Every bound cue spelling, as bound: `MEERA`. */
  readonly cues: readonly string[]
  /** Every bound slugline set spelling, as bound: `HOSPITAL WARD`. */
  readonly sets: readonly string[]
  /** The records a mention may name, as `character:<id>` / `location:<id>`. */
  readonly records: ReadonlySet<string>
}

export type DraftIssue = {
  readonly nodeId: NodeId
  readonly kind: 'cue' | 'heading' | 'mention'
  /** What the node said. */
  readonly found: string
  /** The bound spelling it now says; null when it was left (a cue, a heading) or dropped (a mention). */
  readonly repairedTo: string | null
}

export type DraftCheck = {
  readonly nodes: readonly ScreenplayNode[]
  readonly repaired: readonly DraftIssue[]
  readonly rejected: readonly DraftIssue[]
}

const plainText = (content: InlineContent): string => content.map((run) => (run.kind === 'text' ? run.text : '')).join('')

/** The bound spelling a name is, or can be repaired to - or null. */
export const boundSpellingFor = (name: string, bound: readonly string[]): string | null => {
  const key = canonicalKey(name)
  if (key === '') return null
  const exact = bound.find((spelling) => canonicalKey(spelling) === key)
  if (exact !== undefined) return exact
  const likely = bound.filter((spelling) => scoreMatch(key, canonicalKey(spelling))?.confidence === 'likely')
  return likely.length === 1 ? (likely[0] ?? null) : null
}

const withText = (node: ScreenplayNode, line: string): ScreenplayNode => ({ ...node, content: [text(line)] })

export const checkDraft = (nodes: readonly ScreenplayNode[], bound: BoundSpellings): DraftCheck => {
  const repaired: DraftIssue[] = []
  const rejected: DraftIssue[] = []
  const out: ScreenplayNode[] = []
  for (const original of nodes) {
    let node = original

    // Mentions first: a reference to nothing is dropped, whatever the line is.
    if (node.content.some((run) => run.kind === 'mention' && !bound.records.has(`${run.target.entity}:${run.target.id as string}`))) {
      const kept: InlineContent = node.content.filter((run) => {
        if (run.kind !== 'mention') return true
        const known = bound.records.has(`${run.target.entity}:${run.target.id as string}`)
        if (!known) {
          const issue: DraftIssue = { nodeId: node.id, kind: 'mention', found: `${run.target.entity}:${run.target.id as string}`, repairedTo: null }
          repaired.push(issue)
        }
        return known
      })
      node = { ...node, content: kept }
    }

    if (node.type === 'character') {
      const line = plainText(node.content)
      const name = readCue(line).name
      const spelling = boundSpellingFor(name, bound.cues)
      if (spelling === null) rejected.push({ nodeId: node.id, kind: 'cue', found: line.trim(), repairedTo: null })
      else if (spelling !== name) {
        const fixed = line.replace(name, spelling)
        repaired.push({ nodeId: node.id, kind: 'cue', found: line.trim(), repairedTo: fixed.trim() })
        node = withText(node, fixed)
      }
    }

    if (node.type === 'scene') {
      const line = plainText(node.content)
      const reading = readSlugline(line)
      if (!reading.ok) {
        rejected.push({ nodeId: node.id, kind: 'heading', found: line.trim(), repairedTo: null })
      } else {
        const set = reading.value.set
        const spelling = boundSpellingFor(set, bound.sets)
        if (spelling === null) rejected.push({ nodeId: node.id, kind: 'heading', found: line.trim(), repairedTo: null })
        else if (spelling !== set) {
          const fixed = line.replace(set, spelling)
          repaired.push({ nodeId: node.id, kind: 'heading', found: line.trim(), repairedTo: fixed.trim() })
          node = withText(node, fixed)
        }
      }
    }
    out.push(node)
  }
  return { nodes: out, repaired, rejected }
}

/**
 * The cues of a node list that no bound spelling claims - what the Characters
 * route would show as unresolved names. Zero is what a finished draft owes
 * (roadmap task 4.5).
 */
export const unresolvedCues = (nodes: readonly ScreenplayNode[], boundCues: readonly string[]): readonly string[] => {
  const keys = new Set(boundCues.map((spelling) => canonicalKey(spelling)))
  const found: string[] = []
  for (const node of nodes) {
    if (node.type !== 'character') continue
    const name = readCue(plainText(node.content)).name
    const key = canonicalKey(name)
    if (key !== '' && !keys.has(key) && !found.includes(name)) found.push(name)
  }
  return found
}

/**
 * A node list exactly as a stored copy of it reads back: every node rebuilt by
 * the reader the database's rows go through (`readScreenplayNode`), so its key
 * order is the reader's, not the builder's, and jsonb's own reordering of the
 * content cannot show. What a digest over "the script once this proposal is
 * applied" must be taken of, for it to equal the digest of the stored script
 * afterwards (the pipeline chains its batches on it). A node that will not
 * read is kept as it is - the save would refuse it first.
 */
export const canonicalScreenplay = (nodes: readonly ScreenplayNode[]): readonly ScreenplayNode[] =>
  nodes.map((node) => {
    const read = readScreenplayNode(JSON.parse(JSON.stringify(node)) as unknown)
    return read.ok ? read.value : node
  })
