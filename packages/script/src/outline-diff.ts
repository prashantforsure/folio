import type { NodeId } from './ids'
import type { InlineContent } from './inline'
import type { MentionLabel } from './measure'
import type { OutlineNode, OutlineNodeType } from './outline'

/**
 * Two outline drafts compared block by block - roadmap task 3.4.
 *
 * `diffScreenplays` is the script's: it wraps each node into sheet lines and
 * refuses anything that is not a screenplay node, which is right for a
 * comparison of paper. The outline is not paper - a beat is a line, an act
 * heading is a line - so its diff is one line per block, joined by node id the
 * same way, in the same entry shape, so one component draws both.
 *
 * An entry is `same`, `added`, `deleted` or `changed` (same id, other type or
 * text). A block present in both drafts but out of order - off the longest
 * common run of ids - is `moved`: a deletion where it was and an addition
 * where it went, both flagged, as the script's diff does it. `section` is the
 * act: the number of `h1` blocks at or before the entry in the head, 0 before
 * the first.
 */

export type OutlineDiffKind = 'same' | 'added' | 'deleted' | 'changed'

export type OutlineDiffEntry = {
  readonly id: NodeId
  readonly kind: OutlineDiffKind
  readonly type: OutlineNodeType
  readonly typeBefore: OutlineNodeType | null
  readonly lines: readonly { readonly kind: OutlineDiffKind; readonly text: string }[]
  readonly moved: boolean
  readonly section: number
}

export type OutlineDiff = {
  readonly entries: readonly OutlineDiffEntry[]
  readonly added: number
  readonly deleted: number
  readonly changed: number
}

const textOf = (content: InlineContent, labels: ReadonlyMap<string, string>): string =>
  content.map((run) => (run.kind === 'text' ? run.text : `@${labels.get(`${run.target.entity}:${run.target.id}`) ?? run.target.entity}`)).join('')

const blockText = (node: OutlineNode, labels: ReadonlyMap<string, string>): string => (node.type === 'rule' ? '———' : textOf(node.content, labels))

/** The longest common subsequence of two id lists, as a set of the ids on it. */
const commonRun = (a: readonly NodeId[], b: readonly NodeId[]): ReadonlySet<NodeId> => {
  const rows = a.length
  const cols = b.length
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      const row = table[i]
      const below = table[i + 1]
      if (row === undefined || below === undefined) continue
      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const kept = new Set<NodeId>()
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    const left = a[i]
    if (left !== undefined && left === b[j]) {
      kept.add(left)
      i += 1
      j += 1
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) i += 1
    else j += 1
  }
  return kept
}

export const diffOutlines = (base: readonly OutlineNode[], head: readonly OutlineNode[], mentionLabels: readonly MentionLabel[] = []): OutlineDiff => {
  const labels = new Map(mentionLabels.map((label) => [`${label.entity}:${label.id}`, label.label]))
  const baseById = new Map(base.map((node) => [node.id, node]))
  const headById = new Map(head.map((node) => [node.id, node]))
  const kept = commonRun(
    base.map((node) => node.id),
    head.map((node) => node.id),
  )

  const entries: OutlineDiffEntry[] = []
  let section = 0
  let b = 0
  const drainDeletions = (): void => {
    // Base blocks up to the next kept one: gone, or moved away from here.
    for (;;) {
      const node = base[b]
      if (node === undefined || kept.has(node.id)) return
      b += 1
      const moved = headById.has(node.id)
      entries.push({ id: node.id, kind: 'deleted', type: node.type, typeBefore: null, lines: [{ kind: 'deleted', text: blockText(node, labels) }], moved, section })
    }
  }

  for (const node of head) {
    // What left the base before this block belongs to the act it left from.
    if (kept.has(node.id)) drainDeletions()
    if (node.type === 'h1') section += 1
    if (kept.has(node.id)) {
      b += 1
      const was = baseById.get(node.id)
      if (was === undefined) continue
      const before = blockText(was, labels)
      const after = blockText(node, labels)
      const changed = was.type !== node.type || before !== after
      entries.push(
        changed
          ? {
              id: node.id,
              kind: 'changed',
              type: node.type,
              typeBefore: was.type === node.type ? null : was.type,
              lines: before === after ? [{ kind: 'changed', text: after }] : [{ kind: 'deleted', text: before }, { kind: 'added', text: after }],
              moved: false,
              section,
            }
          : { id: node.id, kind: 'same', type: node.type, typeBefore: null, lines: [{ kind: 'same', text: after }], moved: false, section },
      )
      continue
    }
    const moved = baseById.has(node.id)
    entries.push({ id: node.id, kind: 'added', type: node.type, typeBefore: null, lines: [{ kind: 'added', text: blockText(node, labels) }], moved, section })
  }
  drainDeletions()

  const unmoved = entries.filter((entry) => !entry.moved)
  const movedIds = new Set(entries.filter((entry) => entry.moved).map((entry) => entry.id))
  return {
    entries,
    added: unmoved.filter((entry) => entry.kind === 'added').length,
    deleted: unmoved.filter((entry) => entry.kind === 'deleted').length,
    changed: unmoved.filter((entry) => entry.kind === 'changed').length + movedIds.size,
  }
}
