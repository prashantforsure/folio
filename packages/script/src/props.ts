import { canonicalKey, confidenceRank, scoreMatch } from './alias'
import type { Confidence } from './entities'
import type { NodeId, PropId } from './ids'
import type { InlineContent } from './inline'
import type { ScreenplayNode } from './node'
import type { MentionLabelFor } from './sets'

/**
 * What the Props route reads off the script: the lines of action that
 * mention a prop the writer has already written down.
 *
 * ## A prop is authored; this is evidence, never a binding
 *
 * A prop record is the writer's, not a derivation's (`packages/db`,
 * `schema/index.ts`: AUTHORED). Nothing here mints one, nothing here
 * proposes one, and nothing here writes. `propEvidence` takes the records
 * that already exist - a *pool* of ids, names and bound aliases - and
 * answers one question about each: which lines of the page are about it.
 * The Locations route's `sets.ts` has the same standing and the same shape;
 * this file is not a copy of it, because the question is different. A
 * slugline *is* a set text and resolves to one record; prose merely
 * mentions a thing, so the answer is a list of quotations with a confidence
 * on each, and the writer reads them.
 *
 * ## Why the aliases carry it
 *
 * "Game Ball" never appears in the prose of a script. "the ball" does, and
 * so does "the deflated ball", and so does "it". So matching a record's
 * *name* against the page finds almost nothing, and the alias table is what
 * makes the reading work: `prop_aliases` is the writer saying that "the
 * ball" is the Game Ball. That is the same mechanism AGENTS.md, Entity
 * identity names for characters and sets - "Matching goes through an
 * **alias table** ... never by hashing the string" - and this file uses the
 * same scorer (`alias.ts`, `canonicalKey` / `scoreMatch`) the character and
 * slugline queues use, so a reason chip reads the same here as there.
 *
 * Unlike those two, `prop_aliases` has **no unique index per project**: two
 * props may both be "the bag", and both should collect the line. The scorer
 * is run against every pool entry independently for exactly that reason.
 *
 * ## Action only, and no regex over rendered text
 *
 * Only `action` nodes are read. A cue, a parenthetical or a line of
 * dialogue is a person speaking, not the page describing the object; a
 * transition and a subtitle are neither. `entities.ts` deliberately does
 * not regex rendered prose to *mint* records, and neither does this - the
 * pool is the writer's list, and a line that matches nothing in it is just
 * a line.
 *
 * Deterministic and pure, like every reader in this package: one forward
 * pass, document order preserved, no id minted, nothing stored.
 */

/** A record as matching sees it: its id, its name and its bound aliases. */
export type PropPool = {
  readonly id: PropId
  readonly name: string
  readonly aliases: readonly string[]
}

/** One line of action that reads as being about a prop. */
export type PropEvidence = {
  /** The action node quoted. */
  readonly nodeId: NodeId
  /** The heading it sits under, or the id of the node itself when no heading precedes it. */
  readonly sceneNodeId: NodeId
  /** The line as rendered, mentions resolved to names and whitespace collapsed. */
  readonly text: string
  readonly confidence: Confidence
}

/**
 * At most this many lines per record. A prop named in every scene of a
 * feature would otherwise hand the drawer a thousand quotations, which is
 * not evidence, it is the script. The first fifty in document order are
 * the ones a writer reads.
 */
export const PROP_EVIDENCE_LIMIT = 50

/** The keys a record matches by: its name and each bound alias, blank ones dropped. */
const keysOf = (record: PropPool): readonly string[] =>
  [...new Set([canonicalKey(record.name), ...record.aliases.map(canonicalKey)])].filter((key) => key !== '')

const plainText = (content: InlineContent, labelFor: MentionLabelFor): string =>
  content
    .map((run) => (run.kind === 'text' ? run.text : (labelFor(run.target) ?? '')))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()

/**
 * Every line of action that reads as being about each record, in document
 * order, best confidence per line.
 *
 * One forward pass holding the current heading. For each action node the
 * inline content is flattened - a mention renders as the record's name
 * through `labelFor`, exactly as `establishingLines` does it, so an
 * `@mention` of a character does not leave a hole in the quoted line - and
 * the result is scored against each pool entry's keys with the queue's own
 * scorer. `possible` and better are kept: a line containing the key's
 * tokens is a `possible`, and that is precisely the ordinary case ("the
 * ball rolls under the bench" against `THE BALL`), so a stricter floor
 * would return almost nothing.
 *
 * A record with no line has no entry; the map is not padded with empties.
 */
export const propEvidence = (
  nodes: readonly ScreenplayNode[],
  pool: readonly PropPool[],
  labelFor: MentionLabelFor,
): ReadonlyMap<PropId, readonly PropEvidence[]> => {
  const keys = pool.map(keysOf)
  const out = new Map<PropId, PropEvidence[]>()
  let heading: NodeId | null = null
  for (const node of nodes) {
    if (node.type === 'scene') {
      heading = node.id
      continue
    }
    if (node.type !== 'action') continue
    const text = plainText(node.content, labelFor)
    if (text === '') continue
    const line = canonicalKey(text)
    if (line === '') continue
    pool.forEach((record, at) => {
      const found = out.get(record.id)
      if (found !== undefined && found.length >= PROP_EVIDENCE_LIMIT) return
      let best: Confidence | null = null
      for (const key of keys[at] ?? []) {
        const score = scoreMatch(line, key)
        if (score === null) continue
        if (best === null || confidenceRank(score.confidence) < confidenceRank(best)) best = score.confidence
      }
      if (best === null) return
      const entry: PropEvidence = { nodeId: node.id, sceneNodeId: heading ?? node.id, text, confidence: best }
      if (found === undefined) out.set(record.id, [entry])
      else found.push(entry)
    })
  }
  return out
}

/**
 * How many lines each record has, records with none included - the count a
 * card and a list row print. Separate from `propEvidence` because every
 * view needs the number and only the drawer needs the quotations.
 */
export const propEvidenceCounts = (
  evidence: ReadonlyMap<PropId, readonly PropEvidence[]>,
  pool: readonly PropPool[],
): ReadonlyMap<PropId, number> =>
  new Map(pool.map((record) => [record.id, evidence.get(record.id)?.length ?? 0]))

/**
 * Every scene a record is evidenced in, in document order, duplicates
 * dropped - what a card's `N scenes` counts and what the drawer groups by.
 */
export const propScenes = (lines: readonly PropEvidence[]): readonly NodeId[] => [
  ...new Set(lines.map((line) => line.sceneNodeId)),
]
