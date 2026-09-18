import type { InlineContent, LocationId, NodeId } from '@folio/script'

/**
 * What the Locations route's server actions hand back. Kept out of
 * `actions.ts` because a `'use server'` module may export only async
 * functions (AGENTS.md, Conventions > Errors: a discriminated result, never
 * a throw across the boundary).
 */

export type Failure =
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type CreateResult = { readonly status: 'created'; readonly id: LocationId } | Failure

export type SavedResult = { readonly status: 'saved' } | Failure



export type BindResult = { readonly status: 'bound' } | Failure

export type MergeResult = { readonly status: 'merged'; readonly into: LocationId } | Failure

export type DeleteResult = { readonly status: 'deleted' } | Failure

/** After a queue decision: how many slugline rows still carry a proposal. The badge. */
export type ResolveResult = { readonly status: 'resolved'; readonly pending: number } | Failure

export type DeriveResult = { readonly status: 'derived'; readonly locations: number } | Failure

/** After an upload: the photo's public URL, so the card can show it before the page re-reads. */
export type PhotoResult = { readonly status: 'saved'; readonly url: string | null } | Failure

/** One heading a rename rewrote: what it read before and after, so an undo can put it back only if nothing changed it since. */
export type HeadingRestore = {
  readonly id: NodeId
  readonly before: InlineContent
  readonly after: InlineContent
}

/**
 * What a rename *would* do, before it does: the headings per episode, the
 * bound set texts that stay as they are (a rename rewrites the headings
 * whose set is the name and leaves every other alias bound), and whether
 * the new set text is already somebody's. A pure read; nothing is written.
 */
export type RenamePreview =
  | {
      readonly status: 'preview'
      readonly to: string
      readonly headings: number
      readonly episodes: readonly { readonly ordinal: number; readonly headings: number }[]
      readonly stays: readonly string[]
      readonly taken: { readonly by: LocationId; readonly name: string } | null
    }
  | Failure

/**
 * The rename, done: the diff and what it takes to undo it. `taken` is not a
 * failure: the new set text is another record's, and the drawer offers the
 * merge the refusal used to name in prose.
 */
export type RenameDone =
  | {
      readonly status: 'renamed'
      readonly headings: number
      readonly episodes: number
      readonly undo: RenameUndo
    }
  | { readonly status: 'taken'; readonly by: LocationId; readonly name: string; readonly slugline: string }
  | Failure

/** Everything `undoRename` needs: the record's names either way and every heading's two readings. */
export type RenameUndo = {
  readonly locationId: LocationId
  readonly previousName: string
  readonly name: string
  readonly restores: readonly HeadingRestore[]
}

/** After `undoRename`: how many headings went back, and how many had changed since and were left. */
export type UndoRenameResult = { readonly status: 'undone'; readonly headings: number; readonly skipped: number } | Failure

/** After a move: which record the set text left, if any. */
export type MoveResult = { readonly status: 'moved'; readonly from: LocationId | null } | Failure
