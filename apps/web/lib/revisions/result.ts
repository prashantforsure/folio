import type { Revision, RevisionId, Timestamp } from '@folio/contracts'
import type { DiffEntry, DiffTotals, LockIssue, RevisionColour } from '@folio/script'

/**
 * What the Revisions route's server actions hand back, and the shape of a
 * comparison as the client draws it. Kept out of `actions.ts` because a
 * `'use server'` module may export only async functions (AGENTS.md,
 * Conventions > Errors: a discriminated result, never a throw across the
 * boundary).
 */

/**
 * One side of a comparison. The working document is `current`; everything
 * else is a revision, addressed by id. A version (the editor's backstop) is
 * deliberately not a draft here: the route compares drafts, and the brief is
 * explicit that "a revision is not a version".
 */
export type DraftRef = { readonly kind: 'current' } | { readonly kind: 'revision'; readonly id: RevisionId }

/** The wire spelling of a `DraftRef`: `current`, or a revision id. */
export const draftKey = (ref: DraftRef): string => (ref.kind === 'current' ? 'current' : ref.id)

/**
 * A draft as the compare bar and the history cards print it. Every field is
 * read from the revision row, or from the document row for `current`; none
 * is computed here.
 */
export type DraftHeader = {
  readonly ref: DraftRef
  readonly key: string
  /** `Draft 5`, or what the office called it. `Current` for the working document. */
  readonly name: string
  readonly colour: RevisionColour
  /** The revision's `created_at`, or the document's `updated_at` for `current`. */
  readonly at: Timestamp
  readonly locked: boolean
  readonly ordinal: number | null
}

/**
 * One page of the head draft, with the entries that landed on it.
 *
 * `label`, `locked` and `revision` come off the head's measurement record -
 * the same `numberPages` walk the Script route draws from - so a locked page
 * prints its locked number here too, and a page inserted under a lock prints
 * `4A`. `changed` is the count of lines on the page that are not `same`; it
 * is what puts an asterisk beside the page number.
 */
export type DiffPage = {
  readonly ordinal: number
  readonly label: string
  readonly locked: boolean
  readonly revision: RevisionColour
  readonly entries: readonly DiffEntry[]
  readonly changed: number
}

export type Comparison = {
  readonly base: DraftHeader
  readonly head: DraftHeader
  readonly pages: readonly DiffPage[]
  /** By line, across every page. What the compare bar prints. */
  readonly totals: DiffTotals
  readonly scenesTouched: number
  /** From the head's measurement record. Reported, never resolved. */
  readonly lockIssues: readonly LockIssue[]
}

export type CompareResult =
  | { readonly status: 'compared'; readonly comparison: Comparison }
  /** One side has no snapshot to read - a revision cut before snapshots were kept. */
  | { readonly status: 'unavailable'; readonly message: string }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type IssueResult =
  | { readonly status: 'issued'; readonly revision: Revision }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type LockResult =
  | { readonly status: 'locked'; readonly revision: Revision; readonly pages: number }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type RestoreResult =
  | {
      readonly status: 'restored'
      readonly revision: Revision
      /** The `restore` version's ordinal - the new entry in the chain. */
      readonly versionOrdinal: number
      readonly nodes: number
    }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
