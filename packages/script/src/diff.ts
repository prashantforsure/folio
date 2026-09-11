import type { NodeId } from './ids'
import type { LabelBook, MentionLabel, UnresolvedMention } from './measure'
import { NO_LABELS, labelBook, renderedText, wrapText } from './measure'
import type { ScreenplayNode } from './node'
import { modifiersOf } from './node'
import type { Result } from './result'
import { err, ok } from './result'
import type { ScriptFormat, SheetSpec, UnresolvedSheet } from './sheet'
import { resolveSheet } from './sheet'
import { readSlugline } from './slugline'
import type { RenderableNode } from './stream'
import { renderableNodes } from './stream'

/**
 * Comparing two drafts.
 *
 * The Revisions route puts two snapshots of a document on the sheet and marks
 * what changed between them: added lines tinted, removed lines struck,
 * changed lines noted, an asterisk in the margin against every one. This is
 * the pure function behind that, and it is here rather than in `apps/web` for
 * the reason every other computation over a node list is here - AGENTS.md,
 * Architecture: "no logic that belongs in packages/script" in the app.
 *
 * ## The join key is the node id
 *
 * A node keeps its id through every edit (ADR 0001: head-wins split, first-wins
 * merge, paste preserves), which is what makes "the same line, changed" a
 * question this function can answer at all. A node present in both drafts is
 * compared; one present only in the head was added; one present only in the
 * base was deleted. Text-similarity matching is deliberately not attempted -
 * two Action nodes that read alike are two nodes, and calling them one would
 * re-point the comparison the way AGENTS.md open decision 1 warns that
 * anchors get re-pointed. What that costs is stated below, under "moved".
 *
 * ## Lines, because the paper is lines
 *
 * A production office counts revised *lines* on revised *pages*, so a node is
 * compared as the lines it puts on the sheet, at the measure its type has on
 * that sheet. The format is therefore an input here as it is to `paginate`:
 * the same text wraps differently on A4 and on Letter, and a diff computed on
 * one is wrong on the other. `format: 'asian'` refuses for the same reason
 * `paginate` does - open decision 8 - and the refusal is the same value.
 *
 * Within a node present in both drafts, the two line lists are compared by
 * longest common subsequence. Lines in common are `same`. A run of base-only
 * lines directly followed by a run of head-only lines of the **same length**
 * is read as a replacement and reported as `changed`, one line for one; runs
 * of unequal length are reported as what they are - deletions, then
 * additions. That is the rule that makes a one-word edit to a line read as
 * one changed line rather than as a deletion and an addition, and makes a
 * speech cut from two lines to one read as two struck lines and one new one,
 * which is how a reader would mark it by hand. A type change with the text
 * intact - Action becoming Dialogue - changes every line the node has.
 *
 * ## Moved
 *
 * A node present in both drafts but in a different place is a move, and on
 * paper a move is a deletion where it was and an addition where it is - the
 * asterisks have to appear on both pages, because both pages changed. Which
 * shared nodes "moved" is decided by the longest run of shared nodes that
 * kept their relative order (the same patience walk `packages/db` uses to
 * re-key rows); every shared node outside that run is reported twice, as a
 * `deleted` entry at its base position and an `added` entry at its head
 * position, each flagged `moved` so a view can say so.
 *
 * ## Comments
 *
 * A comment node is not on the paper - AGENTS.md, The node model: "Comment
 * nodes occupy zero page space ... and they never reach an export" - so it is
 * not in the comparison either. `renderableNodes` is applied at the door, as
 * `paginate` applies it, and a draft that differs only in its comments has no
 * changed lines.
 *
 * ## What is counted
 *
 * `totals` is by line and is what the compare bar prints. `linesAdded` and
 * `linesDeleted` are the two numbers a revision row stores, and a changed
 * line counts once on each side: it is one line that left the paper and one
 * that arrived. `scenesTouched` counts scenes - a scene being what
 * `readSlugline` accepts, the same test `paginate` and `derive` apply, so
 * there is one answer to "how many scenes" here too - that contain at least
 * one entry that is not `same`. A deletion belongs to the scene it is placed
 * in, which is the scene of the nearest surviving node before it.
 */

export const DIFF_KINDS = ['same', 'added', 'deleted', 'changed'] as const

export type DiffKind = (typeof DIFF_KINDS)[number]

/** One line as it will be drawn: the head's text, or the base's for a deletion. */
export type DiffLine = {
  readonly kind: DiffKind
  readonly text: string
}

/**
 * One node's place in the comparison.
 *
 * `type` is the head's type, or the base's for a deletion. `typeBefore` is set
 * only when a node present in both drafts changed type; the view can say
 * "was Action". `scene` is the 1-based number of the scene the entry falls
 * in, or 0 before the first accepted heading.
 */
export type DiffEntry = {
  readonly id: NodeId
  readonly kind: DiffKind
  readonly type: RenderableNode['type']
  readonly typeBefore: RenderableNode['type'] | null
  readonly lines: readonly DiffLine[]
  readonly moved: boolean
  readonly scene: number
}

export type DiffTotals = {
  readonly added: number
  readonly deleted: number
  readonly changed: number
  readonly same: number
}

export type ScreenplayDiff = {
  readonly format: ScriptFormat
  readonly entries: readonly DiffEntry[]
  /** By line. What the compare bar prints. */
  readonly totals: DiffTotals
  /** By node. What the history card prints beside the line counts. */
  readonly nodes: DiffTotals
  /** What a revision row stores. A changed line counts once on each side. */
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly scenesTouched: number
  readonly unresolvedMentions: readonly UnresolvedMention[]
}

export type DiffOptions = {
  readonly format: ScriptFormat
  /** Record names for `@mention` runs. A mention has no stored label. */
  readonly mentionLabels?: readonly MentionLabel[]
}

export type DiffError = UnresolvedSheet

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

type Measured = {
  readonly node: RenderableNode
  readonly text: string
  readonly lines: readonly string[]
}

const measureAll = (
  nodes: readonly RenderableNode[],
  sheet: SheetSpec,
  labels: LabelBook,
  unresolved: UnresolvedMention[],
): readonly Measured[] =>
  nodes.map((node) => {
    const rendered = renderedText(node.content, labels)
    unresolved.push(...rendered.unresolved)
    return {
      node,
      text: rendered.text,
      lines: wrapText(rendered.text, sheet.element[node.type].charsPerLine),
    }
  })

const sameModifiers = (a: RenderableNode, b: RenderableNode): boolean => {
  const left = modifiersOf(a)
  const right = modifiersOf(b)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Longest common subsequence of two line lists, as index pairs in order. */
const commonLines = (
  base: readonly string[],
  head: readonly string[],
): readonly (readonly [number, number])[] => {
  const rows = base.length
  const cols = head.length
  // table[i][j] = LCS length of base[i..] and head[j..]
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  )
  for (let i = rows - 1; i >= 0; i -= 1) {
    const row = table[i]
    const next = table[i + 1]
    if (row === undefined || next === undefined) continue
    for (let j = cols - 1; j >= 0; j -= 1) {
      row[j] =
        base[i] === head[j]
          ? (next[j + 1] ?? 0) + 1
          : Math.max(next[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const pairs: (readonly [number, number])[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (base[i] === head[j]) {
      pairs.push([i, j])
      i += 1
      j += 1
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      i += 1
    } else {
      j += 1
    }
  }
  return pairs
}

/**
 * One replacement hunk: `deleted` base lines against `added` head lines.
 * Equal runs pair off as `changed`; anything else is struck then tinted.
 */
const hunk = (deleted: readonly string[], added: readonly string[]): DiffLine[] => {
  if (deleted.length === added.length) {
    return added.map((text) => ({ kind: 'changed', text }))
  }
  return [
    ...deleted.map((text): DiffLine => ({ kind: 'deleted', text })),
    ...added.map((text): DiffLine => ({ kind: 'added', text })),
  ]
}

/** Line-level comparison of one node present in both drafts. */
const compareLines = (base: readonly string[], head: readonly string[]): readonly DiffLine[] => {
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  for (const [bi, hi] of commonLines(base, head)) {
    out.push(...hunk(base.slice(i, bi), head.slice(j, hi)))
    out.push({ kind: 'same', text: head[hi] ?? '' })
    i = bi + 1
    j = hi + 1
  }
  out.push(...hunk(base.slice(i), head.slice(j)))
  return out
}

const allLines = (kind: DiffKind, lines: readonly string[]): readonly DiffLine[] =>
  lines.map((text) => ({ kind, text }))

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

/**
 * The longest run of shared nodes that kept their base order, as a set of
 * head indexes. Patience sorting over base positions in head order.
 */
const stayedInOrder = (basePositions: readonly (number | null)[]): ReadonlySet<number> => {
  const tails: number[] = []
  const previous = new Array<number>(basePositions.length).fill(-1)
  const positionAt = (index: number): number => basePositions[index] ?? -1
  basePositions.forEach((position, index) => {
    if (position === null) return
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      const at = tails[mid]
      if (at !== undefined && positionAt(at) < position) low = mid + 1
      else high = mid
    }
    const before = tails[low - 1]
    previous[index] = low > 0 && before !== undefined ? before : -1
    tails[low] = index
  })
  const kept = new Set<number>()
  let cursor = tails[tails.length - 1] ?? -1
  while (cursor !== -1) {
    kept.add(cursor)
    cursor = previous[cursor] ?? -1
  }
  return kept
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

const opensScene = (node: RenderableNode, text: string): boolean =>
  node.type === 'scene' && readSlugline(text).ok

const EMPTY_TOTALS: DiffTotals = { added: 0, deleted: 0, changed: 0, same: 0 }

const tally = (totals: DiffTotals, kind: DiffKind, by = 1): DiffTotals => ({
  ...totals,
  [kind]: totals[kind] + by,
})

export const diffScreenplays = (
  base: readonly ScreenplayNode[],
  head: readonly ScreenplayNode[],
  options: DiffOptions,
): Result<ScreenplayDiff, DiffError> => {
  const sheet = resolveSheet(options.format)
  if (!sheet.ok) return err(sheet.error)

  const labels = options.mentionLabels === undefined ? NO_LABELS : labelBook(options.mentionLabels)
  const unresolved: UnresolvedMention[] = []
  const baseMeasured = measureAll(renderableNodes(base), sheet.value, labels, unresolved)
  const headMeasured = measureAll(renderableNodes(head), sheet.value, labels, unresolved)

  const baseIndex = new Map<string, number>()
  baseMeasured.forEach((entry, index) => baseIndex.set(String(entry.node.id), index))
  const headIndex = new Map<string, number>()
  headMeasured.forEach((entry, index) => headIndex.set(String(entry.node.id), index))

  // Which shared nodes stayed put. The rest moved and are reported twice.
  const kept = stayedInOrder(
    headMeasured.map((entry) => baseIndex.get(String(entry.node.id)) ?? null),
  )
  const moved = new Set<string>()
  headMeasured.forEach((entry, index) => {
    const id = String(entry.node.id)
    if (baseIndex.has(id) && !kept.has(index)) moved.add(id)
  })

  // Where each deletion goes: after the last base node before it that is
  // still in the head, in place. -1 is before the first head node.
  const deletedAfter = new Map<number, Measured[]>()
  let lastSurvivor = -1
  for (const entry of baseMeasured) {
    const id = String(entry.node.id)
    const at = headIndex.get(id)
    if (at !== undefined && !moved.has(id)) {
      lastSurvivor = at
      continue
    }
    const bucket = deletedAfter.get(lastSurvivor) ?? []
    bucket.push(entry)
    deletedAfter.set(lastSurvivor, bucket)
  }

  const entries: DiffEntry[] = []
  let totals = EMPTY_TOTALS
  let nodes = EMPTY_TOTALS
  let scene = 0
  const touched = new Set<number>()

  const emit = (entry: DiffEntry): void => {
    entries.push(entry)
    nodes = tally(nodes, entry.kind)
    for (const line of entry.lines) totals = tally(totals, line.kind)
    if (entry.kind !== 'same') touched.add(entry.scene)
  }

  const emitDeleted = (entry: Measured): void => {
    emit({
      id: entry.node.id,
      kind: 'deleted',
      type: entry.node.type,
      typeBefore: null,
      lines: allLines('deleted', entry.lines),
      moved: moved.has(String(entry.node.id)),
      scene,
    })
  }

  for (const entry of deletedAfter.get(-1) ?? []) emitDeleted(entry)

  headMeasured.forEach((entry, index) => {
    const id = String(entry.node.id)
    if (opensScene(entry.node, entry.text)) scene += 1
    const from = baseIndex.get(id)
    const before = from === undefined ? undefined : baseMeasured[from]

    if (before === undefined || moved.has(id)) {
      emit({
        id: entry.node.id,
        kind: 'added',
        type: entry.node.type,
        typeBefore: null,
        lines: allLines('added', entry.lines),
        moved: moved.has(id),
        scene,
      })
    } else {
      const typeChanged = before.node.type !== entry.node.type
      // Compared as lines, not as raw text: an edit that changes no line on
      // the paper - a doubled space - is not a change to the paper.
      const textChanged = before.lines.join('\n') !== entry.lines.join('\n')
      const modifiersChanged = !sameModifiers(before.node, entry.node)
      if (!typeChanged && !textChanged && !modifiersChanged) {
        emit({
          id: entry.node.id,
          kind: 'same',
          type: entry.node.type,
          typeBefore: null,
          lines: allLines('same', entry.lines),
          moved: false,
          scene,
        })
      } else {
        emit({
          id: entry.node.id,
          kind: 'changed',
          type: entry.node.type,
          typeBefore: typeChanged ? before.node.type : null,
          lines:
            typeChanged || modifiersChanged
              ? allLines('changed', entry.lines)
              : compareLines(before.lines, entry.lines),
          moved: false,
          scene,
        })
      }
    }

    for (const gone of deletedAfter.get(index) ?? []) emitDeleted(gone)
  })

  return ok({
    format: options.format,
    entries,
    totals,
    nodes,
    linesAdded: totals.added + totals.changed,
    linesDeleted: totals.deleted + totals.changed,
    scenesTouched: touched.size,
    unresolvedMentions: unresolved,
  })
}
