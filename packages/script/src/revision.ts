import type { NodeId } from './ids'
import type { Result } from './result'
import { err, ok } from './result'

/**
 * Locked pages and the revision colours.
 *
 * AGENTS.md, Pagination and the sheet: "**Locked pages must not renumber.**
 * That is the entire point of the colour system." AGENTS.md, When to ask first
 * puts "Change the revision colour sequence or locked-page renumbering
 * behaviour" behind an explicit decision, so what is here is the behaviour as
 * written, and the places where "as written" ran out are reported as issues
 * rather than settled quietly. See the report and `docs/build-decisions.md`.
 *
 * ## Why the colours live in this package
 *
 * AGENTS.md, UI fidelity: "Revision colours (White -> Blue -> Pink -> Yellow ->
 * Green) are industry artefacts, not palette tokens, and must survive a theme
 * switch intact." A production office reads a colour off a physical page; it is
 * a property of the revision, the same way a page number is a property of the
 * measurement. So it is data here, next to the pagination that produces it, and
 * it must never be re-expressed as a `--revision-blue` custom property in
 * `packages/ui` - the moment it is a token it can be themed, and a themed
 * salmon page is a wrong page.
 *
 * ## Why a lock is anchored to a node id
 *
 * A lock has to survive the edit that made repagination necessary. Storing
 * "page 12" alone survives nothing: after an insert upstream, "page 12" is
 * different paper. So a lock carries the node the page opened on, and
 * repagination asks where that node landed. This is the measurement record
 * keying off node ids, and it inherits everything AGENTS.md open decision 1 has
 * not settled about which id survives an edit - see the report.
 */

// ---------------------------------------------------------------------------
// The colours
// ---------------------------------------------------------------------------

/** AGENTS.md, UI fidelity, verbatim and in order. */
export const REVISION_COLOURS = ['white', 'blue', 'pink', 'yellow', 'green'] as const

export type RevisionColour = (typeof REVISION_COLOURS)[number]

export const isRevisionColour = (value: string): value is RevisionColour =>
  (REVISION_COLOURS as readonly string[]).includes(value)

/** An unrevised page is white. The first colour, not a separate state. */
export const FIRST_REVISION_COLOUR: RevisionColour = 'white'

export type RevisionSequenceExhausted = {
  readonly kind: 'revision-sequence-exhausted'
  readonly after: RevisionColour
  readonly detail: string
}

/**
 * The next colour, or a refusal at the end of the sequence.
 *
 * The industry sequence does not stop at green - the next runs are goldenrod,
 * buff, salmon, cherry, and after those it starts again as double white. This
 * package will not add them. AGENTS.md names five and says changing the
 * sequence needs an explicit decision, so a sixth invented here would be a
 * product decision taken in a commit. A production tracking a sixth revision is
 * a real thing that will happen; it needs a ruling, not a default.
 */
export const nextRevisionColour = (
  colour: RevisionColour,
): Result<RevisionColour, RevisionSequenceExhausted> => {
  const next = REVISION_COLOURS[REVISION_COLOURS.indexOf(colour) + 1]
  if (next === undefined) {
    return err({
      kind: 'revision-sequence-exhausted',
      after: colour,
      detail:
        'AGENTS.md names five revision colours, White to Green, and puts changing the sequence behind an explicit decision. What follows Green is unruled.',
    })
  }
  return ok(next)
}

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

/**
 * One page whose number is frozen.
 *
 * `label` is the number as printed - "12", or "12A" for a page that was itself
 * inserted under an earlier lock. `anchor` is the node the page opened on when
 * the lock was taken.
 */
export type LockedPage = {
  readonly label: string
  readonly anchor: NodeId
  readonly revision: RevisionColour
}

/**
 * Something about the locks that the rule as written does not cover.
 *
 * Reported on the measurement record, never thrown and never quietly repaired.
 * Every one of these is a case where a human has to say what should happen.
 */
export type LockIssue =
  /** The anchor node is no longer in the script. The lock cannot be placed. */
  | { readonly kind: 'anchor-missing'; readonly label: string; readonly anchor: NodeId }
  /** Two locks landed on one physical page. The earlier one keeps it. */
  | {
      readonly kind: 'locks-collide'
      readonly ordinal: number
      readonly kept: string
      readonly dropped: string
    }
  /** Two pages ended up printing the same number. */
  | { readonly kind: 'label-collision'; readonly label: string; readonly ordinals: readonly number[] }
  /** Numbering had to continue past a locked label that is not a plain number. */
  | { readonly kind: 'label-not-numeric'; readonly label: string; readonly detail: string }

export type NumberedPage = {
  readonly ordinal: number
  readonly label: string
  readonly locked: boolean
  readonly revision: RevisionColour
}

export type PageNumbering = {
  readonly pages: readonly NumberedPage[]
  readonly issues: readonly LockIssue[]
}

/** A, B, ... Z, AA, AB. 1-based: the first inserted page after a lock is A. */
export const suffixLetters = (position: number): string => {
  let n = position
  let out = ''
  while (n > 0) {
    const remainder = (n - 1) % 26
    out = String.fromCharCode(65 + remainder) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

const PLAIN_NUMBER = /^\d+$/u

/**
 * Assign a printed number to every physical page.
 *
 * The rule, and where each half of it comes from:
 *
 *   - A locked page prints its locked label. AGENTS.md, verbatim: locked pages
 *     must not renumber. This is the only part of the rule that is written
 *     down, and it is absolute - it wins over sequence, over collision, over
 *     everything below.
 *   - A page inserted *between* two locked pages takes the preceding locked
 *     label plus A, B, C. That is the A-page convention the colour system
 *     exists to serve: it is the only way to add paper without moving the
 *     number on the paper after it.
 *   - A page after the *last* locked page continues the sequence normally,
 *     because there is no later number to protect. This is a judgement call and
 *     it is flagged: it is the difference between a script that grows to
 *     "105, 106" and one that grows to "104A, 104B", and both are defensible.
 *   - A page before the *first* locked page numbers from 1. If that collides
 *     with a locked label, the collision is reported rather than resolved -
 *     resolving it would mean renumbering a locked page.
 *
 * `pages` is the physical run, each carrying the ids that appear on it, first
 * first. Nothing here measures anything; it is numbering only.
 */
export const numberPages = (
  pages: readonly { readonly nodes: readonly NodeId[] }[],
  locks: readonly LockedPage[],
  currentRevision: RevisionColour,
): PageNumbering => {
  const issues: LockIssue[] = []

  // Where each lock's anchor landed. First page the id appears on wins, so a
  // node split across a break locks the page it started on.
  const pageOfNode = new Map<string, number>()
  pages.forEach((page, index) => {
    for (const id of page.nodes) {
      if (!pageOfNode.has(String(id))) pageOfNode.set(String(id), index)
    }
  })

  const lockAt = new Map<number, LockedPage>()
  for (const lock of locks) {
    const index = pageOfNode.get(String(lock.anchor))
    if (index === undefined) {
      issues.push({ kind: 'anchor-missing', label: lock.label, anchor: lock.anchor })
      continue
    }
    const held = lockAt.get(index)
    if (held !== undefined) {
      issues.push({
        kind: 'locks-collide',
        ordinal: index + 1,
        kept: held.label,
        dropped: lock.label,
      })
      continue
    }
    lockAt.set(index, lock)
  }

  const lastLockedIndex = pages.reduce(
    (last, _page, index) => (lockAt.has(index) ? index : last),
    -1,
  )

  const labels: string[] = []
  const numbered: NumberedPage[] = []
  let previousLocked: LockedPage | undefined
  let sinceLock = 0
  let sequential = 0

  pages.forEach((_page, index) => {
    const lock = lockAt.get(index)
    if (lock !== undefined) {
      previousLocked = lock
      sinceLock = 0
      if (PLAIN_NUMBER.test(lock.label)) sequential = Number(lock.label)
      labels.push(lock.label)
      numbered.push({
        ordinal: index + 1,
        label: lock.label,
        locked: true,
        revision: lock.revision,
      })
      return
    }

    let label: string
    if (previousLocked === undefined) {
      // Before the first lock: plain ordinals.
      sequential = index + 1
      label = String(sequential)
    } else if (index < lastLockedIndex) {
      // Between locks: an A-page, so that nothing after it moves.
      sinceLock += 1
      label = `${previousLocked.label}${suffixLetters(sinceLock)}`
    } else if (PLAIN_NUMBER.test(previousLocked.label)) {
      // Past the last lock: nothing left to protect, carry on counting.
      sequential += 1
      label = String(sequential)
    } else {
      sinceLock += 1
      label = `${previousLocked.label}${suffixLetters(sinceLock)}`
      issues.push({
        kind: 'label-not-numeric',
        label: previousLocked.label,
        detail:
          'Numbering continued past the last lock, whose label is not a plain number, so the pages after it took A-page suffixes instead of the next number.',
      })
    }
    labels.push(label)
    numbered.push({ ordinal: index + 1, label, locked: false, revision: currentRevision })
  })

  const seen = new Map<string, number[]>()
  labels.forEach((label, index) => {
    const at = seen.get(label) ?? []
    at.push(index + 1)
    seen.set(label, at)
  })
  for (const [label, ordinals] of seen) {
    if (ordinals.length > 1) issues.push({ kind: 'label-collision', label, ordinals })
  }

  return { pages: numbered, issues }
}
