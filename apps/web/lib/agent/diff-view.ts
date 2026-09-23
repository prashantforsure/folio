/**
 * A proposal's document change as the card draws it: hunks (roadmap task 3.3,
 * AGENTS.md "rendered as hunks against current node state").
 *
 * The comparison itself is `@folio/script`'s - `diffScreenplays` for the
 * script, `diffOutlines` for the outline - one entry per node, joined by node
 * id, each with its sheet lines marked same / added / deleted / changed. This
 * file only groups those entries into hunks: every run of changed entries,
 * with `context` unchanged entries either side, runs that touch merged. Pure
 * and serialisable, so the server builds it and the panel draws it.
 */

export type DiffViewKind = 'same' | 'added' | 'deleted' | 'changed'

export type DiffViewLine = { readonly kind: DiffViewKind; readonly text: string }

export type DiffViewEntry = {
  readonly id: string
  readonly kind: DiffViewKind
  /** The node's type as the reader sees it: `scene`, `dialogue`, `beat`... */
  readonly type: string
  /** Set when the node changed type: "was Action". */
  readonly typeBefore: string | null
  readonly lines: readonly DiffViewLine[]
  readonly moved: boolean
}

export type DiffHunk = {
  /** The 1-based scene (the script) or act (the outline) the hunk starts in; 0 before the first. */
  readonly section: number
  readonly entries: readonly DiffViewEntry[]
}

export type DiffView = {
  readonly document: 'screenplay' | 'outline'
  readonly hunks: readonly DiffHunk[]
  /** By node: how many were added, deleted, changed. A moved node counts once, as changed. */
  readonly added: number
  readonly deleted: number
  readonly changed: number
}

/** The shape both pure diffs produce per node. */
export type DiffSourceEntry = DiffViewEntry & { readonly section: number }

/** Group a diff's entries into hunks with `context` unchanged entries either side. */
export const diffViewOf = (document: DiffView['document'], entries: readonly DiffSourceEntry[], context = 1): DiffView => {
  const changedAt = entries.flatMap((entry, index) => (entry.kind === 'same' ? [] : [index]))
  const ranges: { start: number; end: number }[] = []
  for (const index of changedAt) {
    const start = Math.max(0, index - context)
    const end = Math.min(entries.length - 1, index + context)
    const last = ranges.at(-1)
    if (last !== undefined && start <= last.end + 1) last.end = Math.max(last.end, end)
    else ranges.push({ start, end })
  }
  const hunks: DiffHunk[] = ranges.map(({ start, end }) => {
    const slice = entries.slice(start, end + 1)
    const firstChange = slice.find((entry) => entry.kind !== 'same') ?? slice[0]
    return {
      section: firstChange?.section ?? 0,
      entries: slice.map(({ section: _section, ...entry }) => entry),
    }
  })
  // A moved node appears twice (deleted where it was, added where it went); count it once, as changed.
  const movedIds = new Set(entries.filter((entry) => entry.moved).map((entry) => entry.id))
  const unmoved = entries.filter((entry) => !entry.moved)
  return {
    document,
    hunks,
    added: unmoved.filter((entry) => entry.kind === 'added').length,
    deleted: unmoved.filter((entry) => entry.kind === 'deleted').length,
    changed: unmoved.filter((entry) => entry.kind === 'changed').length + movedIds.size,
  }
}

/** One record change as the card draws it: a field, its value before, its value after. */
export type RecordChange = {
  readonly field: string
  readonly before: string | null
  readonly after: string | null
}
